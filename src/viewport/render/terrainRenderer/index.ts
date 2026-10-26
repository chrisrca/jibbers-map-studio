// Terrain rendering: one mesh per tile, displaced on the GPU from a float height texture ( with a
// sample of its neighbours' all round ), lit by normals worked out per pixel from those heights ( sharp
// lighting even on coarse LODs; nothing to work out or upload but the heights when the ground
// changes ), and the chunk's snow mask for snow/rock colouring. Geometry is shared per LOD step;
// skirts hide cracks.

import * as THREE from "three/webgpu";
import { useEditor } from "../../../map/store";
import { gripBlocked, layerOf } from "../../../paint/ground";
import { Terrain, TerrainChunk } from "../../../terrain/terrain";
import { redraw } from "../../redraw";
import { GeometryCache } from "./geometry";
import { type GpuAccess, writeTextureRegion } from "./gpu";
import { gameTex, snowLook } from "./look";
import { Tile } from "./tile";

export { brushLook, snowLook } from "./look";
export { type GpuAccess, writeTextureRegion } from "./gpu";

export class TerrainRenderer {
  readonly group = new THREE.Group();
  private tiles: Tile[][] = [];
  private geoms = new GeometryCache();
  private masks: THREE.Texture[] = [];
  private unsub: () => void;
  private frustum    = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  // metres of triangle edge allowed per metre of distance; lower = more detail
  detail = 0.0025;
  // repeated chunks' copies to show ( Preview Repeats ): each one's offsets from it ( Unity space ), by chunk
  private repeats = new Map<string, [number, number, number][]>();
  // each tile's ghost copies ( its own geometry and material, put where the copies are )
  private ghosts  = new Map<Tile,   THREE.Mesh[]>();

  /**
   * The tiles' shader made ahead, off the page's thread ( a tile of flat ground, compiled and kept ): the first
   * ground the map gets ( a new map's first trail point ) doesn't wait for it.
  **/
  async warmUp( renderer: THREE.WebGPURenderer, camera: THREE.Camera, scene: THREE.Scene ) {
    const res         = 65, c = new TerrainChunk( { key: "warm-up", position: [0, 0, 0], size: [64, 64, 64], res, heights: new Float32Array( res * res ) } );
    const white       = new THREE.DataTexture( new Uint8Array( [255, 255, 255, 255] ), 1, 1 );
    white.needsUpdate = true;
    const t           = new Tile( c, -1, 0, 0, white, false, null );
    t.mesh.geometry   = this.geoms.get( c.tileQuads, 1 );
    const g           = new THREE.Group();
    g.add( t.mesh );
    await renderer.compileAsync( g, camera, scene );
    // ( kept, never drawn: let go, its shader would go with it )
    this.warm = t;
  }
  private warm: Tile | null = null;

  /**
   * The chunks whose copies are shown as ghosts ( Preview Repeats ), with their offsets; none to show none.
  **/
  setRepeats( list: { key: string; offsets: [number, number, number][] }[] ) {
    this.repeats = new Map( list.map( ( r ) => [r.key, r.offsets] ) );
    for ( const ms of this.ghosts.values() ) for ( const m of ms ) this.group.remove( m );
    this.ghosts.clear();
  }

  /**
   * A tile's ghosts where its chunk's copies are ( the ones in view shown ): how many are, and the nearest one's
   * distance ( its detail goes by the nearest of it and its copies ).
  **/
  private showGhosts( t: Tile, cam: THREE.Vector3 ): { n: number; near: number } {
    const offs = this.repeats.get( t.chunk.key );
    if ( !offs ) return { n: 0, near: Infinity };
    let ms = this.ghosts.get( t );
    if ( !ms ) {
      ms = offs.map( () => {
        const m         = new THREE.Mesh( t.mesh.geometry, t.mesh.material );
        m.castShadow    = t.mesh.castShadow;
        m.receiveShadow = t.mesh.receiveShadow;
        // ( not the map's ground: nothing picks it )
        m.raycast       = () => {};
        this.group.add( m );
        return m;
      } );
      this.ghosts.set( t, ms );
    }
    let shown = 0, near = Infinity;
    offs.forEach( ( [x, y, z], k ) => {
      const m    = ms![k], box = t.box.clone().translate( new THREE.Vector3( x, y, -z ) );
      m.material = t.mesh.material;
      m.position.set( t.mesh.position.x + x, t.mesh.position.y + y, t.mesh.position.z - z );
      m.quaternion.copy( t.mesh.quaternion );
      m.scale.copy( t.mesh.scale );
      m.visible = this.frustum.intersectsBox( box );
      if ( m.visible ) { shown++; near = Math.min( near, box.distanceToPoint( cam ) ); }
    } );
    return { n: shown, near };
  }
  stats = { tiles: 0, visible: 0, triangles: 0 };

  constructor( private terrain: Terrain, private loadMask: ( path: string ) => Promise<THREE.Texture | null> ) {
    this.group.name = "terrain";
    this.unsub      = terrain.subscribe( ( dirty ) => {
      for ( const [ci, tiles] of dirty ) for ( const [ti, rect] of tiles ) this.tiles[ci]?.[ti]?.upload( this.terrain, rect, this.gpu );
    } );
  }

  private generation = 0;

  /**
   * Rebuild all tiles for the terrain's current chunk layout. A newer call supersedes an older one.
  **/
  async rebuild() {
    const gen         = ++this.generation;
    const white       = new THREE.DataTexture( new Uint8Array( [255, 255, 255, 255] ), 1, 1 );
    white.needsUpdate = true;
    const chunks      = this.terrain.chunks;
    const extras      = useEditor.getState().chunkExtras;
    const markings    = chunks.map( ( c ) => !!( extras[c.key] as { snowMask4Channel?: boolean } | undefined )?.snowMask4Channel );
    // chunks that are still exactly what they were ( same heights, place and mask ) keep their tiles: only new or
    // changed chunks are built and uploaded ( splitting one chunk for detail mustn't redo the whole map )
    const oldRows     = new Map<string, { row: Tile[]; mask: THREE.Texture; markings: boolean }>();
    this.tiles.forEach( ( row, ci ) => row[0] && oldRows.set( row[0].chunk.key, { row, mask: this.masks[ci], markings: this.markingsOf[ci] ?? false } ) );
    const same = ( a: TerrainChunk, b: TerrainChunk ) =>
      a.heights === b.heights && a.res === b.res && a.snowMask === b.snowMask && a.size[0] === b.size[0] && a.size[1] === b.size[1] &&
      a.position[0] === b.position[0] && a.position[1] === b.position[1] && a.position[2] === b.position[2];
    const reuse = chunks.map( ( c, ci ) => {
      const o = oldRows.get( c.key );
      return o && same( o.row[0].chunk, c ) && o.markings === markings[ci] ? o : null;
    } );
    const masks: THREE.Texture[] = [];
    for ( const [ci, c] of chunks.entries() ) masks.push( reuse[ci]?.mask ?? ( ( c.snowMask && ( await this.loadMask( c.snowMask ) ) ) || white ) );
    const flows: ( THREE.Texture | null )[] = [];
    for ( const [ci, c] of chunks.entries() ) {
      const rel                     = ( extras[c.key] as { snowMask2?: string | null } | undefined )?.snowMask2;
      let tex: THREE.Texture | null = null;
      if ( !reuse[ci] && rel ) {
        tex = await this.loadMask( rel );
        if ( tex ) {
          tex.magFilter       = tex.minFilter = THREE.NearestFilter;
          tex.generateMipmaps = false;
        }
      }
      flows.push( tex );
    }
    if ( gen !== this.generation ) return;

    const kept = new Set( reuse.filter( Boolean ).map( ( o ) => o!.row ) );
    for ( const row of this.tiles ) if ( !kept.has( row ) ) for ( const t of row ) {
      this.group.remove( t.mesh );
      t.dispose();
    }
    this.tiles      = [];
    this.masks      = masks;
    this.markingsOf = markings;
    const fresh     = new Set<number>();
    for ( const [ci, c] of chunks.entries() ) {
      const o = reuse[ci];
      if ( o ) {
        for ( const t of o.row ) {
          t.chunk = c;
          t.ci    = ci;
        }
        this.tiles.push( o.row );
        continue;
      }
      // ( its tiles made below, a few at a time )
      fresh.add( ci );
      this.tiles.push( [] );
    }
    // ( a frame drawn every dozen milliseconds of it: a few square kilometres of new ground is hundreds of tiles,
    // and the window froze until they were all done; the ground fills in as they're made )
    let slice = performance.now();
    for ( const ci of fresh ) {
      const c = chunks[ci], row = this.tiles[ci];
      for ( let tz = 0; tz < c.tilesPerSide; tz++ )
        for ( let tx = 0; tx < c.tilesPerSide; tx++ ) {
          const t = new Tile( c, ci, tx, tz, masks[ci], !!markings[ci], flows[ci] );
          row.push( t );
          this.group.add( t.mesh );
          t.upload( this.terrain );
          if ( performance.now() - slice > 12 ) {
            redraw();
            await new Promise( ( r ) => requestAnimationFrame( r ) );
            if ( gen !== this.generation ) return;
            slice = performance.now();
          }
        }
    }
    redraw();
    // painted chunks show their live paint
    for ( const ci of fresh ) if ( layerOf( chunks[ci].key ) ) this.applyPaint( chunks[ci].key );
    // kept chunks next to new ones: their border tiles' normals look across the border, so refresh those
    chunks.forEach( ( c, ci ) => {
      if ( fresh.has( ci ) ) return;
      const n = c.tilesPerSide;
      for ( const { side, c: other } of c.adjacent ) {
        if ( !fresh.has( this.terrain.indexOf( other.key ) ) ) continue;
        for ( const t of this.tiles[ci] )
          if ( ( side === 0 && t.tx === 0 ) || ( side === 1 && t.tx === n - 1 ) || ( side === 2 && t.tz === 0 ) || ( side === 3 && t.tz === n - 1 ) ) t.upload( this.terrain );
      }
    } );
    this.stats.tiles = this.tiles.reduce( ( s, r ) => s + r.length, 0 );
  }

  private markingsOf: boolean[] = [];

  /**
   * The game's snow and rock textures, once read from it: on every tile from now on.
  **/
  useGameSnow( snow: THREE.Texture, rock: THREE.Texture ) {
    gameTex.snow = snow;
    gameTex.rock = rock;
    for ( const row of this.tiles )
      for ( const t of row ) {
        t.snowNode.value = snow;
        t.rockNode.value = rock;
      }
    snowLook.gameSnow.value = 1;
    redraw();
  }

  // Live textures of painted chunks ( they share the paint layer's pixels; re-uploaded when it changes ).
  private paintTex      = new Map<string, { mask: THREE.DataTexture; flow: THREE.DataTexture | null; m: number; version: number }>();
  // the graphics device and a texture's copy on it ( set by the engine ): paint uploads just what changed
  gpu: GpuAccess | null = null;

  private writeRegion( tex: THREE.Texture, data: Uint8Array, m: number, bpp: number, rect: [number, number, number, number] ) {
    return writeTextureRegion( this.gpu, tex, data, m, bpp, rect );
  }
  private paintPending = new Set<string>();

  /**
   * A chunk's paint changed: its textures follow on the next frame.
  **/
  paintChanged( key: string ) {
    this.paintPending.add( key );
  }

  /**
   * Which chunks grip can't go on, again ( the Grip tool taken up: every chunk's paint loaded first ).
  **/
  refreshGrip() {
    this.tiles.forEach( ( row, ci ) => {
      const L = layerOf( this.terrain.chunks[ci]?.key ?? "" );
      for ( const t of row ?? [] ) t.gripBlocked.value = L && gripBlocked( L ) ? 1 : 0;
    } );
  }

  private applyPaint( key: string ) {
    const L  = layerOf( key );
    const ci = this.terrain.indexOf( key );
    if ( !L || ci < 0 ) return;
    let pt     = this.paintTex.get( key );
    let region = L.pending;
    L.pending  = null;
    if ( !pt || pt.m !== L.m ) {
      region          = "all";
      const mask      = new THREE.DataTexture( L.rgba, L.m, L.m, THREE.RGBAFormat, THREE.UnsignedByteType );
      mask.magFilter  = mask.minFilter = THREE.LinearFilter;
      mask.colorSpace = THREE.NoColorSpace;
      pt              = { mask, flow: null, m: L.m, version: -1 };
      this.paintTex.set( key, pt );
    }
    let flowRegion = region;
    if ( L.flow && ( !pt.flow || pt.flow.image.data !== L.flow ) ) {
      flowRegion         = "all";
      pt.flow            = new THREE.DataTexture( L.flow, L.m, L.m, THREE.RedFormat, THREE.UnsignedByteType );
      pt.flow.magFilter  = pt.flow.minFilter = THREE.NearestFilter; // angles can't be blended across 0/360
      pt.flow.colorSpace = THREE.NoColorSpace;
    }
    if ( pt.mask.image.data !== L.rgba ) {
      ( pt.mask.image as { data: Uint8Array } ).data = L.rgba;
      region = "all";
    }
    // a brush dab changes a few pixels of a mask that can be 4096 a side: only those go to the graphics card
    if ( !region || region === "all" || !this.writeRegion( pt.mask, L.rgba, L.m, 4, region ) ) pt.mask.needsUpdate = true;
    if ( pt.flow && L.flow && ( !flowRegion || flowRegion === "all" || !this.writeRegion( pt.flow, L.flow, L.m, 1, flowRegion ) ) ) pt.flow.needsUpdate = true;
    pt.version          = L.version;
    this.masks[ci]      = pt.mask;
    this.markingsOf[ci] = L.four;
    for ( const t of this.tiles[ci] ?? [] ) {
      t.maskNode.value = pt.mask;
      t.hueNode.value  = pt.mask;
      t.setMaskSize( pt.mask );
      t.markings.value = L.four ? 1 : 0;
      if ( snowLook.showGrip.value ) t.gripBlocked.value = gripBlocked( L ) ? 1 : 0;
      if ( pt.flow ) {
        t.flowNode.value = pt.flow;
        t.hasFlow.value  = 1;
      } else t.hasFlow.value = 0;
    }
  }

  update( camera: THREE.PerspectiveCamera ) {
    if ( this.paintPending.size ) {
      for ( const k of this.paintPending ) this.applyPaint( k );
      this.paintPending.clear();
    }
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
    this.frustum.setFromProjectionMatrix( this.projScreen );
    const cam   = camera.position;
    let visible = 0, tris = 0;
    // ( ghosts of tiles that have gone, let go )
    if ( this.ghosts.size ) {
      const live = new Set( this.tiles.flat() );
      for ( const [t, ms] of this.ghosts )
        if ( !live.has( t ) ) {
          for ( const m of ms ) this.group.remove( m );
          this.ghosts.delete( t );
        }
    }
    for ( const row of this.tiles )
      for ( const t of row ) {
        const vis      = this.frustum.intersectsBox( t.box );
        t.mesh.visible = vis;
        // ( its copies: shown wherever they're in view, the tile itself or not; its detail the nearest one's )
        const g        = this.repeats.size ? this.showGhosts( t, cam ) : { n: 0, near: Infinity };
        if ( !vis && !g.n ) continue;
        if ( vis  ) visible++;
        const d       = Math.max( 1, Math.min( vis ? t.box.distanceToPoint( cam ) : Infinity, g.near ) );
        const desired = d * this.detail;
        const q       = t.chunk.tileQuads;
        let step      = 1;
        while ( step < q / 4 && t.chunk.spacing * step * 2 <= desired ) step *= 2;
        if ( step !== t.step ) {
          t.step          = step;
          t.mesh.geometry = this.geoms.get( q, step );
        }
        for ( const m of this.ghosts.get( t ) ?? [] ) m.geometry = t.mesh.geometry;
        const n = q / step;
        tris   += n * n * 2 * ( ( vis ? 1 : 0 ) + g.n );
      }
    this.stats.visible   = visible;
    this.stats.triangles = tris;
  }

  clear() {
    this.setRepeats( [...this.repeats].map( ( [key, offsets] ) => ( { key, offsets } ) ) );
    for ( const row of this.tiles ) for ( const t of row ) {
      this.group.remove( t.mesh );
      t.dispose();
    }
    this.tiles = [];
    this.masks = [];
  }

  dispose() {
    this.warm?.dispose();
    this.unsub();
    this.clear();
  }
}
