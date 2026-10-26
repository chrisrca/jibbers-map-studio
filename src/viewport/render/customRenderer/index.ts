// Custom objects ( imported maps' own meshes, e.g. Melon's MLNZ pieces ) drawn with their real geometry, textures
// and material settings. Assets come from the Rust-side cache ( src-tauri/src/project/assets.rs ).

import * as THREE from "three/webgpu";
import { toThree, unityEulerToQuat } from "../../../core/coords";
import { type AssetIndex, ipc, joinPath } from "../../../core/ipc";
import { type CustomMaterial, type CustomObjectEntry, arr3 } from "../../../core/types";
import { type Selection, type Shading, useEditor } from "../../../map/store";
import type { ModelData } from "../../../model/build";
import type { SourceMesh } from "../../../model/importMesh";
import { builtOf, isModel, lodPreview, meshKey } from "../../../model/objects";
import { toPiece } from "../../../pieces/rail";
import type { BakeImage } from "../../../texture/bake";
import { onPieceTexture } from "../../../texture/meshPaint";
import { disposeGuide } from "../../tools/grindGuide";
import { withLamps } from "../lamps";
import { type GpuAccess } from "../terrainRenderer";
import { buildGeometry, worldSurface } from "./geometry";
import { GrindGuides } from "./guides";
import { PieceMaterials } from "./materials";
import { PiecePaint } from "./paint";
import { hidden, lookMaterial, wireLines } from "./shading";

export { buildGeometry } from "./geometry";

export type MaterialData = CustomMaterial;

export class CustomObjectsRenderer {
  // its parts, each in a file of its own beside this one
  readonly materials = new PieceMaterials( this ); // pieces' materials
  readonly paint     = new PiecePaint( this );     // painted pieces' textures
  readonly guides    = new GrindGuides( this );    // jibs' grind guides

  readonly group = new THREE.Group();
  private dir: string | null        = null;
  index: Promise<AssetIndex | null> = Promise.resolve( null );
  private geos     = new Map<string, Promise<THREE.BufferGeometry | null>>();
  private fallback = withLamps( new THREE.MeshStandardNodeMaterial( { color: 0xb0b4ba, roughness: 0.8 } ) );
  // uid → shown object, the data it was built from, and a build counter ( async builds can finish out of order );
  // `built` is the data the shown meshes are from ( the newest data may still be building )
  shown = new Map<string, { group: THREE.Group; data: CustomObjectEntry; build: number; built: CustomObjectEntry | null }>();
  private builds         = 0;
  // Resolves when the most recent sync has finished building.
  settled: Promise<void> = Promise.resolve();
  // pieces being built since none were ( counted for the loading veil ); `gen` drops builds of a project left behind
  private wave           = { total: 0, done: 0, gen: 0 };
  // the project's asset cache is ready ( it's converted on the Rust side when a project opens )
  private indexReady     = true;

  /**
   * Pieces built of how many since none were pending, and whether the project's assets are still being prepared;
   * null once everything is shown.
  **/
  get progress(): { done: number; total: number; preparing: boolean } | null {
    if ( this.indexReady && this.wave.done >= this.wave.total ) return null;
    return { done: this.wave.done, total: this.wave.total, preparing: !this.indexReady };
  }

  constructor() {
    this.group.add( this.guides.group );
    // ( one renderer for the app's life: never let go )
    onPieceTexture( ( uid, ch ) => {
      const key = `${uid}|${ch === "height" ? "normal" : ch}`;
      // a map the piece's materials don't have yet: they're made again with it
      if ( !this.paint.textures.has( key ) && ch !== "colour" ) queueMicrotask( () => this.paint.rebuild( uid ) );
      this.paint.pending.add( key );
    } );
  }

  /**
   * Points at a ( different ) project: its asset cache is ( re )built on the Rust side.
  **/
  setProject( dir: string | null ) {
    if ( dir === this.dir ) return;
    this.clear();
    this.dir    = dir;
    const index = dir
      ? ipc.prepareAssets( dir, useEditor.getState().library ).catch( ( e ) => {
          console.error( "custom assets failed", e );
          return null;
        } )
      : Promise.resolve( null );
    this.index      = index;
    this.indexReady = !dir;
    index.then( () => this.index === index && ( this.indexReady = true ) );
  }

  /**
   * The project's library gained or changed entries ( an asset placed, or saved over ): convert just those. Meshes
   * are cached by their converted file, so one changed under the same key is read again.
  **/
  reloadLibrary() {
    // ( on the open map first: before its first piece the renderer may not have been told of it — the first piece
    // on a new map was placed without its mesh to hand, so an official rail got no grind rail )
    this.setProject( useEditor.getState().projectDir );
    const dir = this.dir;
    if ( !dir ) return;
    this.index = ipc.prepareAssets( dir, useEditor.getState().library ).catch( ( e ) => {
      console.error( "custom assets failed", e );
      return null;
    } );
  }

  /**
   * Brings the shown objects in line with the document; only added or changed objects are rebuilt.
  **/
  sync( objects: CustomObjectEntry[], selection: Selection[] ) {
    this.selection = selection;
    const live     = new Set( objects.map( ( o ) => o.uid ) );
    for ( const [uid, s] of this.shown ) {
      if ( !live.has( uid ) ) {
        this.group.remove( s.group );
        this.shown.delete( uid );
      }
    }
    const pending: Promise<void>[] = [];
    const gen                      = this.wave.gen;
    for ( const o of objects ) {
      const cur = this.shown.get( o.uid );
      if ( cur && cur.data === o ) continue;
      const build = ++this.builds;
      if ( cur ) { cur.data = o; cur.build = build; }
      else this.shown.set( o.uid, { group: new THREE.Group(), data: o, build, built: null } );
      this.wave.total++;
      pending.push(
        this.buildGroup( o )
          .then( ( g ) => {
            const s = this.shown.get( o.uid );
            if ( !s || s.build !== build ) return; // superseded or deleted meanwhile
            this.group.remove( s.group );
            s.group   = g;
            s.built   = o;
            g.visible = !this.only || this.only.has( o.uid );
            this.applyLook( g );
            this.group.add( g );
            this.onBuilt?.( o.uid );
            this.updateSelected( this.selection ); // the selection now, not when this build started
          } )
          .finally( () => {
            if ( gen !== this.wave.gen ) return;
            if ( ++this.wave.done >= this.wave.total ) this.wave = { total: 0, done: 0, gen };
          } ),
      );
    }
    this.updateSelected( selection );
    this.settled = Promise.all( pending ).then( () => {} );
  }

  /**
   * Meshes for click-picking; each carries `{ kind: "custom", uid }`.
  **/
  pickables(): THREE.Object3D[] {
    return [...this.shown.entries()].filter( ( [uid] ) => !this.only || this.only.has( uid ) ).flatMap( ( [, s] ) => s.group.children );
  }

  // called when a piece's meshes are ( re )built
  onBuilt?: ( uid: string ) => void;

  // The Assets workspace's shading ( null: the pieces' own materials, as on the map ).
  private look: { shading: Shading; xray: boolean; faces: boolean } | null = null;
  setLook( look: { shading: Shading; xray: boolean; faces: boolean } | null ) {
    this.look = look;
    for ( const s of this.shown.values() ) this.applyLook( s.group );
  }
  private applyLook( g: THREE.Group ) {
    const l = this.look;
    for ( const m of [...g.children] ) {
      if ( !( m instanceof THREE.Mesh ) ) continue;
      const ud = m.userData as { own?: THREE.Material | THREE.Material[]; edges?: THREE.LineSegments };
      if ( !ud.own ) ud.own = m.material;
      const wire = l?.shading === "wire" && !l.faces;
      m.material = !l || ( !l.faces && ( l.shading === "material" || l.shading === "rendered" ) ) ? ud.own : wire ? hidden() : lookMaterial( l.shading, l.xray, l.faces );
      // Wireframe draws the edges as modelled ( not the triangles' diagonals across flat faces )
      if ( wire && !ud.edges ) {
        ud.edges          = new THREE.LineSegments( new THREE.EdgesGeometry( m.geometry, 1 ), wireLines() );
        ud.edges.userData = { look: true };
        m.add( ud.edges );
      }
      if ( ud.edges ) ud.edges.visible = wire;
    }
  }

  // Only these pieces shown ( the stage's ), or all.
  private only: Set<string> | null = null;
  showOnly( uids: Set<string> | null ) {
    this.only = uids;
    for ( const [uid, s] of this.shown ) s.group.visible = !uids || uids.has( uid );
  }

  objectGroup( uid: string ) {
    return this.shown.get( uid )?.group ?? null;
  }

  get partCount() {
    return this.pickables().length;
  }

  selection: Selection[] = [];
  selected               = new Set<string>();
  /**
   * ( what's selected is outlined, as Blender does: the engine's outline pass )
  **/
  private updateSelected( selection: Selection[] ) {
    this.selected = new Set( selection.filter( ( s ) => s.kind === "custom" ).map( ( s ) => s.uid ) );
    this.guides.update();
  }

  /**
   * A piece's mesh vertices in its own coordinates ( xyz… ), for making its rail.
  **/
  async localVertices( o: CustomObjectEntry ): Promise<Float32Array | null> {
    const s     = this.shown.get( o.uid );
    const group = s && s.built === o && s.group.children.length ? s.group : await this.buildGroup( o );
    if ( !group.children.length ) return null;
    const w   = worldSurface( group, 80000 );
    const out = new Float32Array( w.length );
    const v   = new THREE.Vector3();
    for ( let i = 0; i < w.length; i += 3 ) {
      const p    = toPiece( o, v.set( w[i], w[i + 1], w[i + 2] ) );
      out[i]     = p[0];
      out[i + 1] = p[1];
      out[i + 2] = p[2];
    }
    return out;
  }

  /**
   * A piece's triangles in its own coordinates ( 9 numbers each ), for fitting colliders to its visible parts.
  **/
  async localTriangles( o: CustomObjectEntry ): Promise<Float32Array | null> {
    const s     = this.shown.get( o.uid );
    const group = s && s.built === o && s.group.children.length ? s.group : await this.buildGroup( o );
    if ( !group.children.length ) return null;
    group.updateMatrixWorld( true );
    const out: number[] = [];
    const v             = new THREE.Vector3();
    for ( const m of group.children ) {
      if ( !( m instanceof THREE.Mesh ) ) continue;
      const pos = m.geometry.getAttribute( "position" ), idx = m.geometry.getIndex();
      const n   = idx ? idx.count : pos.count;
      for ( let i = 0; i < n; i++ ) {
        const p = toPiece( o, v.fromBufferAttribute( pos, idx ? idx.getX( i ) : i ).applyMatrix4( m.matrix ) );
        out.push( p[0], p[1], p[2] );
      }
    }
    return new Float32Array( out );
  }

  /**
   * Uses an already-prepared asset cache ( previews of personal library entries ).
  **/
  useIndex( index: AssetIndex ) {
    this.clear();
    this.dir   = index.dir;
    this.index = Promise.resolve( index );
  }

  // modelled pieces' geometry, made from their model ( not the library ), the last one per piece
  private modelGeos = new Map<string, { model: ModelData; geo: THREE.BufferGeometry; level: number }>();
  private modelGeometry( o: CustomObjectEntry & { model: ModelData } ) {
    const had = this.modelGeos.get( o.uid ), level = Math.min( lodPreview.get( o.uid ) ?? 0, o.model.lods?.levels ?? 0 );
    if ( had?.model === o.model && had.level === level ) return had.geo;
    const b   = builtOf( o.model, level );
    const geo = buildGeometry( b.buf.slice( 0 ), b.n, true, b.submeshes );
    // ( the last one stays until the next is shown: an edit's build replaces it )
    if ( had ) setTimeout( () => had.geo.dispose(), 2000 );
    this.modelGeos.set( o.uid, { model: o.model, geo, level } );
    return geo;
  }

  // the graphics device ( set by the engine ): painted textures upload only what a dab changed
  gpu: GpuAccess | null = null;

  /**
   * A piece built again as it is ( its level of detail shown changed ).
  **/
  refresh( uid: string ) {
    this.paint.rebuild( uid );
  }

  /**
   * Builds the meshes for one object; each mesh knows its object uid and part index ( for picking ).
  **/
  async buildGroup( o: CustomObjectEntry ): Promise<THREE.Group> {
    const group = new THREE.Group();
    if ( !isModel( o ) && !( await this.index ) ) return group;
    const meshes = await Promise.all(
      o.parts
        .map( ( p, partIndex ) => ( { p, partIndex } ) )
        .filter( ( { p } ) => p.lod_index <= 0 ) // highest detail only
        .map( async ( { p, partIndex } ) => {
          const geo = isModel( o ) && p.mesh === meshKey( o.uid ) ? this.modelGeometry( o ) : await this.geometry( p.mesh );
          if ( !geo ) return null;
          let mats = await Promise.all( p.materials.map( ( m ) => this.materials.material( m ) ) );
          if ( isModel( o ) && o.model.paint ) mats = mats.map( ( m, k ) => this.paint.material( o.uid, m, p.materials[k] ) );
          const mesh = new THREE.Mesh( geo, mats.length ? mats : this.fallback );
          mesh.position.copy( toThree( arr3( p.local_position ) ) );
          mesh.quaternion.copy( unityEulerToQuat( arr3( p.local_rotation ) ) );
          mesh.scale.set( p.local_scale.x, p.local_scale.y, p.local_scale.z );
          // as the game does: parts set not to cast shadows don't; the surroundings of real maps don't take them
          // either ( the editor's terrain has skirts under its edges, which the game's doesn't, and they'd shade them )
          mesh.castShadow    = ( p as { shadow_casting_mode?: number } ).shadow_casting_mode !== 0;
          mesh.receiveShadow = !p.mesh.startsWith( "Scenery/" );
          mesh.userData      = { kind: "custom", uid: o.uid, partIndex };
          return mesh;
        } ),
    );
    for ( const m of meshes ) if ( m ) group.add( m );
    group.updateMatrixWorld( true );
    return group;
  }

  clear() {
    for ( const s of this.shown.values() ) this.group.remove( s.group );
    this.shown.clear();
    this.wave = { total: 0, done: 0, gen: this.wave.gen + 1 };
    for ( const c of this.guides.cache.values() ) if ( c.obj ) { this.guides.group.remove( c.obj ); disposeGuide( c.obj ); }
    this.guides.cache.clear();
    // everything let go on the GPU ( and the decoded pictures ): a big map's pieces, or a preview's, hold gigabytes
    for ( const g of this.geos.values() ) g.then( ( x ) => x?.dispose() );
    for ( const m of this.materials.mats.values() ) m.dispose();
    for ( const t of this.materials.texs.values() ) t.dispose();
    for ( const b of this.materials.images.values() ) b.then( ( x ) => x?.close() );
    this.geos.clear();
    this.materials.images.clear();
    this.materials.mats.clear();
    this.materials.texs.clear();
  }

  private geometry( key: string ): Promise<THREE.BufferGeometry | null> {
    // ( by the converted file, which is named after the mesh's data: a mesh saved over under the same key — an
    // asset saved over — is read again )
    return this.index.then( ( index ) => {
      const e = index?.meshes[key];
      if ( !e ) return null;
      let p = this.geos.get( e.file );
      if ( !p ) {
        p = ipc
          .readBinary( joinPath( index!.dir, e.file ) )
          .then( ( buf ) => buildGeometry( buf, e.vertexCount, e.hasNormals, e.submeshes ) )
          .catch( ( err ) => {
            console.warn( "custom mesh failed", key, err );
            return null;
          } );
        this.geos.set( e.file, p );
      }
      return p;
    } );
  }

  /**
   * A part's mesh as stored ( Unity space; normals worked out when it has none ), for making it a model.
  **/
  async sourceMesh( key: string ): Promise<SourceMesh | null> {
    const index = await this.index, e = index?.meshes[key];
    if ( !e ) return null;
    const buf = await ipc.readBinary( joinPath( index!.dir, e.file ) );
    const n   = e.vertexCount, total = e.submeshes.reduce( ( a, b ) => a + b, 0 );
    const pos = new Float32Array( buf, 0, n * 3 ).slice(), uv = new Float32Array( buf, n * 24, n * 2 ).slice();
    const idx = new Uint32Array( buf, n * 32, total ).slice();
    let nrm   = new Float32Array( buf, n * 12, n * 3 ).slice();
    if ( !e.hasNormals ) {
      nrm = new Float32Array( n * 3 );
      for ( let i = 0; i + 2 < total; i += 3 ) {
        const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
        const e1        = [0, 1, 2].map( ( k ) => pos[b * 3 + k] - pos[a * 3 + k] ), e2 = [0, 1, 2].map( ( k ) => pos[c * 3 + k] - pos[a * 3 + k] );
        const fn        = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        for ( const v of [a, b, c] ) for ( let k = 0; k < 3; k++ ) nrm[v * 3 + k] += fn[k];
      }
      for ( let v = 0; v < n; v++ ) {
        const l = Math.hypot( nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2] ) || 1;
        for ( let k = 0; k < 3; k++ ) nrm[v * 3 + k] /= l;
      }
    }
    return { pos, nrm, uv, idx, submeshes: e.submeshes };
  }

  /**
   * A texture's pixels ( RGBA, the top row first ), for baking.
  **/
  async sourcePixels( key: string ): Promise<BakeImage | null> {
    const index = await this.index, file = key ? index?.textures[key] : undefined;
    if ( !file ) return null;
    try {
      const im = await ipc.readImageRgba( joinPath( index!.dir, file ) );
      return { w: im.width, h: im.height, data: im.data };
    } catch {
      return null;
    }
  }
}
