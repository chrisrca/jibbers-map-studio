// Terrain rendering: one mesh per tile, displaced on the GPU from a float height texture ( with a
// sample of its neighbours' all round ), lit by normals worked out per pixel from those heights ( sharp
// lighting even on coarse LODs; nothing to work out or upload but the heights when the ground
// changes ), and the chunk's snow mask for snow/rock colouring. Geometry is shared per LOD step;
// skirts hide cracks.

import * as THREE from "three/webgpu";
import { nextFrame, overBudget } from "../../../core/frameBudget";
import { useEditor } from "../../../map/store";
import { gripBlocked, layerOf, type PaintLayer } from "../../../paint/ground";
import { type Rect, Terrain, TerrainChunk } from "../../../terrain/terrain";
import { redraw } from "../../redraw";
import { GeometryCache } from "./geometry";
import { type GpuAccess, writeTextureRegion } from "./gpu";
import { gameTex, snowLook } from "./look";
import { Tile } from "./tile";

export { brushLook, snowLook } from "./look";
export { type GpuAccess, writeTextureRegion } from "./gpu";

// how long a frame may spend sending changed ground to the graphics card ( ms )
const UPLOAD_SHARE = 1.5;

// two pixel rectangles' hull
const union = ( a: Rect, b: Rect ): Rect => [Math.min( a[0], b[0] ), Math.min( a[1], b[1] ), Math.max( a[2], b[2] ), Math.max( a[3], b[3] )];

// A painted chunk's textures, as on the graphics card.
interface PaintTex {
  mask:      THREE.Texture;
  rt:        THREE.RenderTarget | null;
  rgba:      Uint8Array;
  flow:      THREE.Texture | null;
  flowRt:    THREE.RenderTarget | null;
  flowData:  Uint8Array | null;
  m:         number;
  version:   number;
  // fills under way; what changed while they were
  filling:   number;
  dirty:     Rect | "all" | null;
  flowDirty: Rect | "all" | null;
}

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

  // what makes a tile ready to draw off the frame ( the engine's renderer.compileAsync, yielding as it goes ), when
  // there is one: built on the frame it first showed, each new tile held the frame up ~10 ms ( a new chunk's dozens
  // a stutter of a second; turning to tiles not yet looked at, a hitch each )
  prepare: ( ( o: THREE.Object3D ) => Promise<unknown> ) | null = null;

  /**
   * New tiles readied ( every one, in view or not ), then shown ( unless a newer rebuild took over meanwhile ). A tile
   * at a time, the frame let through once its share is spent ( readied all at once, their many small steps kept the
   * page from drawing: a frame a tenth of a second while they lasted ).
  **/
  private async show( ts: Tile[], gen: number ) {
    for ( const t of ts ) {
      if ( this.prepare ) {
        t.mesh.geometry = this.geoms.get( t.chunk.tileQuads, 1 );
        await this.prepare( t.mesh ).catch( ( e ) => console.warn( "terrain tile", e ) );
        if ( gen !== this.generation ) return;
        if ( overBudget() ) {
          await nextFrame();
          if ( gen !== this.generation ) return;
        }
      }
      this.group.add( t.mesh );
    }
  }

  private warmGen = 0;

  /**
   * Every tile made ready again for the scene's lighting as it is now ( it changed; a shader is made for the lights
   * it's drawn with ), in the background: a stand-in of each ( its material and geometry ), in view or not.
  **/
  async rewarm() {
    if ( !this.prepare ) return;
    const gen = ++this.warmGen;
    for ( const t of this.tiles.flat() ) {
      const geo       = t.mesh.geometry.attributes.grid ? t.mesh.geometry : this.geoms.get( t.chunk.tileQuads, 1 );
      const m         = new THREE.Mesh( geo, t.mesh.material );
      m.receiveShadow = t.mesh.receiveShadow;
      m.castShadow    = t.mesh.castShadow;
      // ( made ready wherever it is: three leaves out what's off screen )
      m.frustumCulled = false;
      await this.prepare( m ).catch( () => {} );
      if ( gen !== this.warmGen ) return;
      if ( overBudget() ) await nextFrame();
      if ( gen !== this.warmGen ) return;
    }
  }

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
      for ( const [ci, tiles] of dirty )
        for ( const [ti, rect] of tiles ) {
          const t = this.tiles[ci]?.[ti];
          if ( !t ) continue;
          const was = this.uploads.get( t );
          this.uploads.set( t, was === undefined ? rect : [Math.min( was[0], rect[0] ), Math.min( was[1], rect[1] ), Math.max( was[2], rect[2] ), Math.max( was[3], rect[3] )] );
        }
      this.sendUploads( UPLOAD_SHARE );
    } );
  }

  private generation = 0;

  // tiles whose heights changed, waiting to go to the graphics card ( the part that changed )
  private uploads = new Map<Tile, Rect>();

  /**
   * The changed tiles' heights to the graphics card, for about `ms` ( at least one ): a sculpt stroke's few at once, an
   * undo of a big one's hundreds over a few frames instead of all in one.
  **/
  private sendUploads( ms: number ) {
    const t0 = performance.now();
    for ( const [t, rect] of this.uploads ) {
      this.uploads.delete( t );
      t.upload( this.terrain, rect, this.gpu );
      if ( performance.now() - t0 >= ms ) break;
    }
    if ( this.uploads.size ) redraw();
  }

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
    // ( none kept when the game's textures have just come in: see useGameSnow )
    const anew  = this.anew;
    this.anew   = false;
    const reuse = chunks.map( ( c, ci ) => {
      const o = oldRows.get( c.key );
      return !anew && o && same( o.row[0].chunk, c ) && o.markings === markings[ci] ? o : null;
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

    const kept  = new Set( reuse.filter( Boolean ).map( ( o ) => o!.row ) );
    const letGo = ( rows: Tile[][] ) => {
      for ( const row of rows ) for ( const t of row ) {
        this.group.remove( t.mesh );
        this.uploads.delete( t );
        t.dispose();
      }
    };
    // ( all made afresh: the old ones shown till the new ones are, the ground never gone meanwhile )
    const drop  = this.tiles.filter( ( row ) => !kept.has( row ) );
    if ( anew ) this.leftover.push( ...drop );
    else letGo( drop );
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
    let slice         = performance.now();
    const made: Tile[] = [];
    for ( const ci of fresh ) {
      const c = chunks[ci], row = this.tiles[ci];
      for ( let tz = 0; tz < c.tilesPerSide; tz++ )
        for ( let tx = 0; tx < c.tilesPerSide; tx++ ) {
          const t = new Tile( c, ci, tx, tz, masks[ci], !!markings[ci], flows[ci] );
          row.push( t );
          made.push( t );
          t.upload( this.terrain );
          if ( performance.now() - slice > 12 ) {
            await this.show( made.splice( 0 ), gen );
            redraw();
            await new Promise( ( r ) => requestAnimationFrame( r ) );
            if ( gen !== this.generation ) return;
            slice = performance.now();
          }
        }
    }
    await this.show( made, gen );
    if ( gen !== this.generation ) return;
    letGo( this.leftover.splice( 0 ) );
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
    // ( the lighting can settle while they're made, a map's sun and sky coming in: all of them again, as it is now )
    if ( fresh.size ) void this.rewarm();
  }

  private markingsOf: boolean[] = [];
  // every tile to be made afresh on the next rebuild, and the ones it's to replace once it's done
  private anew                = false;
  private leftover: Tile[][]  = [];

  /**
   * The game's snow and rock textures, once read from it: on every tile from now on. Tiles made before they came ( a
   * new map's first ground, at start ) are made again with them: swapped into a tile already drawn ( its shader made
   * for the plain stand-in, a texture of another kind ), it went on showing the stand-in, or the rock, in places.
  **/
  useGameSnow( snow: THREE.Texture, rock: THREE.Texture ) {
    gameTex.snow            = snow;
    gameTex.rock            = rock;
    snowLook.gameSnow.value = 1;
    if ( this.tiles.some( ( row ) => row.length ) ) {
      this.anew = true;
      void this.rebuild();
    }
    redraw();
  }

  // Live textures of painted chunks ( re-uploaded where the paint layer changes ).
  private paintTex      = new Map<string, PaintTex>();
  // the graphics device and a texture's copy on it ( set by the engine ): paint uploads just what changed
  gpu: GpuAccess | null = null;
  // makes a render target's texture on the graphics card ( set by the engine ): an empty texture to fill a band a
  // frame, where a data texture would go up whole at once ( a 4096² mask, 64 MB in one frame: the first dab's hitch )
  initTarget: ( ( rt: THREE.RenderTarget ) => void ) | null = null;

  private writeRegion( tex: THREE.Texture, data: Uint8Array, m: number, bpp: number, rect: [number, number, number, number] ) {
    return writeTextureRegion( this.gpu, tex, data, m, bpp, rect );
  }

  /**
   * A texture for a paint layer's pixels ( `bpp` 4: the mask, 1: the flow ), and its filling: a band of rows a frame,
   * when there's a graphics card to write to; otherwise a data texture, uploaded as it's drawn.
  **/
  private paintTexture( data: Uint8Array, m: number, bpp: 1 | 4, nearest: boolean ): { tex: THREE.Texture; rt: THREE.RenderTarget | null; fill: ( () => Promise<void> ) | null } {
    const filter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
    if ( !this.gpu || !this.initTarget ) {
      const tex      = new THREE.DataTexture( data, m, m, bpp === 4 ? THREE.RGBAFormat : THREE.RedFormat, THREE.UnsignedByteType );
      tex.magFilter  = tex.minFilter = filter;
      tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
      return { tex, rt: null, fill: null };
    }
    const rt                 = new THREE.RenderTarget( m, m, { depthBuffer: false, format: bpp === 4 ? THREE.RGBAFormat : THREE.RedFormat, type: THREE.UnsignedByteType, magFilter: filter, minFilter: filter, generateMipmaps: false } );
    rt.texture.colorSpace    = THREE.NoColorSpace;
    this.initTarget( rt );
    return { tex: rt.texture, rt, fill: () => this.fillRows( rt.texture, data, m, bpp ) };
  }

  /**
   * Writes a texture's pixels from `data`, a band of rows at a time, a frame's share each frame.
  **/
  private async fillRows( tex: THREE.Texture, data: Uint8Array, m: number, bpp: number ) {
    const band = Math.max( 1, Math.floor( ( 4 << 20 ) / ( m * bpp ) ) );
    for ( let y = 0; y < m; y += band ) {
      if ( overBudget() ) await nextFrame();
      this.writeRows( tex, data, m, bpp, y, Math.min( m - 1, y + band - 1 ) );
    }
  }

  private writeRows( tex: THREE.Texture, data: Uint8Array, m: number, bpp: number, y0: number, y1: number, x0 = 0, x1 = m - 1 ) {
    const gpuTex = this.gpu?.textureOf( tex );
    if ( !gpuTex ) return;
    this.gpu!.device.queue.writeTexture( { texture: gpuTex, origin: { x: x0, y: y0 } }, data, { offset: ( y0 * m + x0 ) * bpp, bytesPerRow: m * bpp }, { width: x1 - x0 + 1, height: y1 - y0 + 1 } );
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
      // ( a texture of its own, filled over a few frames: the tiles keep the mask they show, the same picture, until
      // it's full )
      if ( pt ) this.dropPaint( pt );
      const made = this.paintTexture( L.rgba, L.m, 4, false );
      pt         = { mask: made.tex, rt: made.rt, rgba: L.rgba, flow: null, flowRt: null, flowData: null, m: L.m, version: -1, filling: 0, dirty: null, flowDirty: null };
      this.paintTex.set( key, pt );
      region     = null;
      if ( made.fill ) this.filling( key, pt, made.fill, "mask" );
    }
    let flowRegion = region;
    if ( L.flow && ( !pt.flow || pt.flowData !== L.flow ) ) {
      if ( pt.flowRt ) pt.flowRt.dispose();
      // ( angles can't be blended across 0/360: nearest )
      const made  = this.paintTexture( L.flow, L.m, 1, true );
      pt.flow     = made.tex;
      pt.flowRt   = made.rt;
      pt.flowData = L.flow;
      flowRegion  = null;
      if ( made.fill ) this.filling( key, pt, made.fill, "flow" );
    }
    if ( pt.rgba !== L.rgba ) {
      // ( the layer's pixels swapped for others: all of them again )
      pt.rgba = L.rgba;
      region  = "all";
      if ( !pt.rt ) ( pt.mask.image as { data: Uint8Array } ).data = L.rgba;
    }
    pt.version = L.version;
    // ( still filling: what changed meanwhile goes up once it's full )
    if ( pt.filling ) {
      if ( region ) pt.dirty = region === "all" || pt.dirty === "all" ? "all" : pt.dirty ? union( pt.dirty, region ) : region;
      if ( flowRegion ) pt.flowDirty = flowRegion === "all" || pt.flowDirty === "all" ? "all" : pt.flowDirty ? union( pt.flowDirty, flowRegion ) : flowRegion;
      return;
    }
    this.sendPaint( pt, region, flowRegion );
    this.bindPaint( key, ci, pt, L );
  }

  /**
   * A chunk's paint texture filling: once it's full, what changed meanwhile goes up and the tiles take it.
  **/
  private filling( key: string, pt: PaintTex, fill: () => Promise<void>, what: "mask" | "flow" ) {
    pt.filling++;
    void fill().finally( () => {
      if ( this.paintTex.get( key ) !== pt || ( what === "flow" && !pt.flow ) ) return;
      if ( --pt.filling ) return;
      const L = layerOf( key ), ci = this.terrain.indexOf( key );
      this.sendPaint( pt, pt.dirty, pt.flowDirty );
      pt.dirty = pt.flowDirty = null;
      if ( L && ci >= 0 ) this.bindPaint( key, ci, pt, L );
      redraw();
    } );
  }

  /**
   * The changed part of a chunk's paint to the graphics card ( "all": every pixel; a data texture: all of it ).
  **/
  private sendPaint( pt: PaintTex, region: Rect | "all" | null, flowRegion: Rect | "all" | null ) {
    // a brush dab changes a few pixels of a mask that can be 4096 a side: only those go to the graphics card
    if ( region ) {
      if ( pt.rt ) {
        if ( region === "all" ) void this.fillRows( pt.mask, pt.rgba, pt.m, 4 );
        else this.writeRows( pt.mask, pt.rgba, pt.m, 4, region[1], region[3], region[0], region[2] );
      } else if ( region === "all" || !this.writeRegion( pt.mask, pt.rgba, pt.m, 4, region ) ) pt.mask.needsUpdate = true;
    }
    if ( flowRegion && pt.flow && pt.flowData ) {
      if ( pt.flowRt ) {
        if ( flowRegion === "all" ) void this.fillRows( pt.flow, pt.flowData, pt.m, 1 );
        else this.writeRows( pt.flow, pt.flowData, pt.m, 1, flowRegion[1], flowRegion[3], flowRegion[0], flowRegion[2] );
      } else if ( flowRegion === "all" || !this.writeRegion( pt.flow, pt.flowData, pt.m, 1, flowRegion ) ) pt.flow.needsUpdate = true;
    }
  }

  /**
   * The chunk's tiles drawn with its paint textures.
  **/
  private bindPaint( key: string, ci: number, pt: PaintTex, L: PaintLayer ) {
    if ( this.paintTex.get( key ) !== pt ) return;
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

  private dropPaint( pt: PaintTex ) {
    if ( pt.rt ) pt.rt.dispose();
    else pt.mask.dispose();
    if ( pt.flowRt ) pt.flowRt.dispose();
    else pt.flow?.dispose();
  }

  update( camera: THREE.PerspectiveCamera ) {
    if ( this.uploads.size ) this.sendUploads( UPLOAD_SHARE );
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
    this.uploads.clear();
    this.tiles = [];
    this.masks = [];
  }

  dispose() {
    this.warm?.dispose();
    this.unsub();
    this.clear();
  }
}
