// Custom objects ( imported maps' own meshes, e.g. Melon's MLNZ pieces ) drawn with their real geometry, textures
// and material settings. Assets come from the Rust-side cache ( src-tauri/src/project/assets.rs ).

import { positionWorld, step, uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import { toThree, unityEulerToQuat } from "../../../core/coords";
import { type AssetIndex, ipc, joinPath } from "../../../core/ipc";
import { type CustomMaterial, type CustomObjectEntry, adjustOf, arr3, hasLook } from "../../../core/types";
import { type Selection, type Shading, useEditor } from "../../../map/store";
import type { ModelData } from "../../../model/build";
import type { SourceMesh } from "../../../model/importMesh";
import { builtOf, isModel, lodPreview, meshKey } from "../../../model/objects";
import { dirToPiece, dirToView, toPiece, toView } from "../../../pieces/rail";
import { capture, cycleAngle, moved, movingPartsOf, turned, type MovingPart } from "../../../pieces/motion";
import type { V3 } from "../../../core/coords";
import type { BakeImage } from "../../../texture/bake";
import { onPieceTexture } from "../../../texture/meshPaint";
import { colliderShell, disposeGuide, shellObject } from "../../tools/grindGuide";
import { withLamps } from "../lamps";
import { redraw, sceneEdits } from "../../redraw";
import { dropTree, treeLater } from "./pickTrees";
import { type GpuAccess } from "../terrainRenderer";
import { buildGeometry, worldSurface } from "./geometry";
import { GrindGuides } from "./guides";
import { PieceMaterials } from "./materials";
import { PiecePaint } from "./paint";
import { hidden, lookMaterial, wireLines } from "./shading";

export { buildGeometry } from "./geometry";

export type MaterialData = CustomMaterial;

/**
 * Whether piece `b` is `a` only moved, turned or sized: its parts the same but for where they are ( a part's settings
 * carried over as they are, as a move does ).
**/
function onlyPlaced( a: CustomObjectEntry, b: CustomObjectEntry ): boolean {
  if ( a.model !== b.model || a.hue !== b.hue || a.adjust !== b.adjust || a.parts.length !== b.parts.length ) return false;
  // ( a piece of colliders only is drawn as them: built again as they move )
  if ( !hasLook( a ) && a.colliders !== b.colliders ) return false;
  return a.parts.every( ( p, i ) => {
    const q = b.parts[i], keys = Object.keys( p );
    return keys.length === Object.keys( q ).length && keys.every( ( k ) => k.startsWith( "local_" ) || p[k] === q[k] );
  } );
}

// Colliders-only pieces' looks, by surface ( jib, snow, solid ): see-through, behind what's in front of them.
const colliderLooks = new Map<string, THREE.MeshBasicNodeMaterial>();
function colliderLook( surface: string ) {
  let m = colliderLooks.get( surface );
  if ( !m ) {
    const colour = surface === "Jib" ? 0x1fb6ff : surface === "Snow" ? 0xe8f4ff : 0xff9f1a;
    colliderLooks.set( surface, ( m = new THREE.MeshBasicNodeMaterial( { color: colour, transparent: true, opacity: 0.35, depthWrite: false } ) ) );
  }
  return m;
}

/**
 * A mesh's attributes as a batch needs them alike ( null: it can't be batched: morphs, interleaved data ).
**/
function layout( g: THREE.BufferGeometry ) {
  const a = Object.entries( g.attributes );
  if ( Object.keys( g.morphAttributes ).length || a.some( ( [, x] ) => ( x as THREE.InterleavedBufferAttribute ).isInterleavedBufferAttribute ) ) return null;
  return `${a.map( ( [n, x] ) => `${n}:${x.itemSize}:${x.normalized}:${( x.array as { constructor: { name: string } } ).constructor.name}` ).sort().join( "," )}|${!!g.index}`;
}

/**
 * The one material a mesh is drawn with, all of it ( a part's list of one counts, its one group the whole mesh ); null
 * when it's drawn with more.
**/
function oneMaterial( m: THREE.Mesh ): THREE.Material | null {
  if ( !Array.isArray( m.material ) ) return m.material;
  const gs = m.geometry.groups, n = m.geometry.index?.count ?? m.geometry.attributes.position.count;
  if ( gs.length > 1 || ( gs[0] && ( gs[0].start !== 0 || gs[0].count < n ) ) ) return null;
  return m.material[gs[0]?.materialIndex ?? 0] ?? null;
}

// ( how many pieces taken out are kept as they were drawn, and how many of their batches: see `parked` )
const PARKED = 5000, PARKED_BATCHES = 400;

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
  // ( pieces sharing a mesh and its materials, a map's trees above all: drawn instanced, one draw for every one of
  // them, their own meshes hidden then but still picked; not the picked ones, outlined and moved as any piece is. By
  // geometry and materials )
  private batches        = new Map<string, { im: THREE.InstancedMesh; capacity: number }>();
  private batchDue       = false;
  private batchedFor     = "";
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
    // ( its pieces stand still unless they're changed here: their matrices worked out then, not on every frame, which
    // took a busy map's thousand-odd meshes a millisecond a frame. See updateMatrices )
    this.group.matrixWorldAutoUpdate = false;
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
    const index = ipc.prepareAssets( dir, useEditor.getState().library ).catch( ( e ) => {
      console.error( "custom assets failed", e );
      return null;
    } );
    this.index  = index;
    // ( ready once the latest is: one asked for just before, by setProject, gives way to it and can't say so )
    index.then( () => this.index === index && ( this.indexReady = true ) );
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
        this.park( uid, s );
        this.batchLater();
      }
    }
    const picked = selection.filter( ( s ) => s.kind === "custom" ).map( ( s ) => s.uid ).join( "," );
    if ( picked !== this.batchedFor ) {
      this.batchedFor = picked;
      this.batchLater();
    }
    const pending: Promise<void>[] = [];
    const gen                      = this.wave.gen;
    for ( const o of objects ) {
      // ( a piece back as it went: as it was drawn then )
      const back = this.shown.has( o.uid ) ? undefined : this.parked.get( o.uid );
      if ( back && back.data === o && back.built === o ) {
        this.parked.delete( o.uid );
        this.shown.set( o.uid, back );
        back.group.visible = !this.only || this.only.has( o.uid );
        this.applyLook( back.group );
        this.group.add( back.group );
        this.batchLater();
        continue;
      }
      const cur = this.shown.get( o.uid );
      if ( cur && cur.data === o ) continue;
      // ( only moved, turned or sized, as on the gizmo: its meshes put where its parts now are, not built again )
      if ( cur?.built && cur.data === cur.built && onlyPlaced( cur.built, o ) ) {
        for ( const m of cur.group.children ) {
          const p = o.parts[( m.userData as { partIndex?: number } ).partIndex ?? -1];
          if ( !p ) continue;
          m.position.copy( toThree( arr3( p.local_position ) ) );
          m.quaternion.copy( unityEulerToQuat( arr3( p.local_rotation ) ) );
          m.scale.set( p.local_scale.x, p.local_scale.y, p.local_scale.z );
        }
        cur.group.updateMatrixWorld( true );
        cur.data  = o;
        cur.built = o;
        cur.build = ++this.builds;
        if ( !selection.some( ( s ) => s.uid === o.uid ) ) this.batchLater();
        redraw();
        continue;
      }
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
            // ( a picked piece is drawn on its own: built again as it's changed, nothing else to lay out )
            if ( !this.selected.has( o.uid ) ) this.batchLater();
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
  pickables( keep: ( uid: string ) => boolean = () => true ): THREE.Object3D[] {
    this.updateMatrices();
    return [...this.shown.entries()].filter( ( [uid] ) => ( !this.only || this.only.has( uid ) ) && keep( uid ) ).flatMap( ( [, s] ) => s.group.children );
  }

  // called when a piece's meshes are ( re )built
  onBuilt?: ( uid: string ) => void;

  // The Assets workspace's shading ( null: the pieces' own materials, as on the map ).
  private look: { shading: Shading; xray: boolean; faces: boolean } | null = null;
  setLook( look: { shading: Shading; xray: boolean; faces: boolean } | null ) {
    this.look = look;
    for ( const s of this.shown.values() ) this.applyLook( s.group );
    this.batchLater();
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

  // Pieces taken out of the map, kept as they were drawn for a while: the map's all of them while the Assets workspace
  // is open ( its own pieces in their place ), a piece deleted until it's undone. Coming back as they went, they're put
  // back as they are, not built again ( and their batches with them ): back from Assets on a busy park held the view
  // up over a second. The oldest let go past PARKED.
  private parked        = new Map<string, { group: THREE.Group; data: CustomObjectEntry; build: number; built: CustomObjectEntry | null }>();
  private parkedBatches = new Map<string, { im: THREE.InstancedMesh; capacity: number }>();
  private parkedBatched = new Map<string, { bm: THREE.BatchedMesh; sig: string; ids: Map<string, number> }>();

  private park( uid: string, s: { group: THREE.Group; data: CustomObjectEntry; build: number; built: CustomObjectEntry | null } ) {
    this.parked.delete( uid );
    this.parked.set( uid, s );
    while ( this.parked.size > PARKED ) this.parked.delete( this.parked.keys().next().value! );
  }

  // Only these pieces shown ( the stage's ), or all.
  private only: Set<string> | null = null;
  showOnly( uids: Set<string> | null ) {
    this.only = uids;
    // ( laid out again only when what's shown changed: asked on every change to the pieces, a drag laid every
    // batch out again each step )
    let changed = false;
    for ( const [uid, s] of this.shown ) {
      const on = !uids || uids.has( uid );
      if ( s.group.visible !== on ) changed = true;
      s.group.visible = on;
    }
    if ( changed ) this.batchLater();
  }

  private batchLater() {
    if ( this.batchDue ) return;
    this.batchDue = true;
    queueMicrotask( () => {
      this.batchDue = false;
      this.layoutBatches();
    } );
  }

  /**
   * Pieces' meshes drawn instanced where they're alike ( see `batches` ): one with none like it, picked, hidden, faint,
   * its moving parts going, or in the Assets workspace's shading drawn on its own.
  **/
  private layoutBatches() {
    // every mesh that can be drawn with others ( not a faint one, nor a lamp's piece: its lamps' light is kept off it by
    // which piece is drawn, which a batch can't say ), and whether it's to be drawn on its own now
    const all: { m: THREE.Mesh; own: boolean }[] = [];
    for ( const [uid, s] of this.shown ) {
      if ( !s.built ) continue;
      const own = !s.group.visible || this.look !== null || this.selected.has( uid ) || this.moving.has( uid );
      const lit = !!s.data.lights?.length;
      for ( const m of s.group.children ) {
        if ( !( m instanceof THREE.Mesh ) ) continue;
        m.visible = true;
        if ( lit || ( m.userData as { solid?: unknown } ).solid ) continue;
        all.push( { m, own } );
      }
    }
    // alike ( one mesh, the same materials ): instanced
    const by = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[]; cast: boolean; take: boolean; meshes: THREE.Mesh[]; all: { m: THREE.Mesh; own: boolean }[] }>();
    const keyOf = ( m: THREE.Mesh ) => `${m.geometry.uuid}|${( Array.isArray( m.material ) ? m.material : [m.material] ).map( ( x ) => x.uuid ).join( "," )}|${m.castShadow}|${m.receiveShadow}`;
    for ( const { m, own } of all ) {
      const key = keyOf( m );
      let g     = by.get( key );
      if ( !g ) by.set( key, ( g = { geo: m.geometry, mat: m.material, cast: m.castShadow, take: m.receiveShadow, meshes: [], all: [] } ) );
      g.all.push( { m, own } );
      if ( !own ) g.meshes.push( m );
    }
    // ( one of its kind: batched with others of its material, below, where it can be ( a few alike batched so as well
    // were no quicker than instanced ) )
    const single: { m: THREE.Mesh; own: boolean }[] = [];
    for ( const [key, g] of by )
      if ( g.all.length < 2 ) {
        by.delete( key );
        single.push( ...g.all );
      }
    for ( const [key, b] of this.batches )
      if ( !by.has( key ) ) {
        this.group.remove( b.im );
        this.batches.delete( key );
        this.parkedBatches.set( key, b );
        while ( this.parkedBatches.size > PARKED_BATCHES ) {
          const [k, old] = this.parkedBatches.entries().next().value!;
          old.im.dispose();
          this.parkedBatches.delete( k );
        }
      }
    const toGroup = this.group.matrixWorld.clone().invert(), at = new THREE.Matrix4();
    for ( const [key, g] of by ) {
      let b = this.batches.get( key );
      // ( one set aside, back again )
      if ( !b && this.parkedBatches.has( key ) ) {
        b = this.parkedBatches.get( key )!;
        this.parkedBatches.delete( key );
        this.batches.set( key, b );
        this.group.add( b.im );
      }
      if ( !b || g.meshes.length > b.capacity ) {
        if ( b ) {
          this.group.remove( b.im );
          b.im.dispose();
        }
        const capacity   = Math.max( 4, 2 ** Math.ceil( Math.log2( Math.max( 1, g.meshes.length ) ) ) );
        const im         = new THREE.InstancedMesh( g.geo, g.mat, capacity );
        im.castShadow    = g.cast;
        im.receiveShadow = g.take;
        // ( picked by each tree's own meshes, not this )
        im.raycast       = () => {};
        this.group.add( im );
        this.batches.set( key, ( b = { im, capacity } ) );
      }
      b.im.count = g.meshes.length;
      g.meshes.forEach( ( m, i ) => {
        m.visible = false;
        m.updateWorldMatrix( true, false );
        b.im.setMatrixAt( i, at.multiplyMatrices( toGroup, m.matrixWorld ) );
      } );
      b.im.instanceMatrix.needsUpdate = true;
      b.im.computeBoundingSphere();
    }
    this.layoutBatched( single, toGroup );
    redraw();
  }

  // ( pieces of their own kind with a material in common: drawn as one, a draw each but a single object to three ( its
  // cost a piece is the object's, not the draw's: a busy park's 69 such pieces were a frame's biggest part ). By
  // material and the meshes' layout; each mesh's instance there, by its mesh )
  private batched = new Map<string, { bm: THREE.BatchedMesh; sig: string; ids: Map<string, number> }>();

  /**
   * The one-of-a-kind meshes laid out in batches of their material ( see `batched` ): made again only when which meshes
   * are in one changes ( a piece picked, moved or hidden is let out of its batch, drawn on its own, not made again ).
  **/
  private layoutBatched( list: { m: THREE.Mesh; own: boolean }[], toGroup: THREE.Matrix4 ) {
    const by = new Map<string, { mat: THREE.Material; cast: boolean; take: boolean; list: { m: THREE.Mesh; own: boolean }[] }>();
    for ( const x of list ) {
      const m = x.m, mat = oneMaterial( m ), l = mat && layout( m.geometry );
      if ( !mat || !l ) continue;
      const key = `${mat.uuid}|${m.castShadow}|${m.receiveShadow}|${l}`;
      let g     = by.get( key );
      if ( !g ) by.set( key, ( g = { mat, cast: m.castShadow, take: m.receiveShadow, list: [] } ) );
      g.list.push( x );
    }
    for ( const [key, g] of by ) if ( g.list.length < 2 ) by.delete( key );
    for ( const [key, b] of this.batched )
      if ( !by.has( key ) ) {
        this.group.remove( b.bm );
        this.batched.delete( key );
        this.parkedBatched.set( key, b );
        while ( this.parkedBatched.size > PARKED_BATCHES ) {
          const [k, old] = this.parkedBatched.entries().next().value!;
          old.bm.dispose();
          this.parkedBatched.delete( k );
        }
      }
    const at = new THREE.Matrix4();
    for ( const [key, g] of by ) {
      const sig = g.list.map( ( x ) => x.m.uuid ).sort().join( "," );
      let b     = this.batched.get( key );
      // ( one set aside, back again )
      if ( !b && this.parkedBatched.get( key )?.sig === sig ) {
        b = this.parkedBatched.get( key )!;
        this.parkedBatched.delete( key );
        this.batched.set( key, b );
        this.group.add( b.bm );
      }
      if ( !b || b.sig !== sig ) {
        if ( b ) {
          this.group.remove( b.bm );
          b.bm.dispose();
        }
        // ( each mesh once, however many are drawn of it )
        const geos  = [...new Map( g.list.map( ( x ) => [x.m.geometry.uuid, x.m.geometry] ) ).values()];
        const verts = geos.reduce( ( n, x ) => n + x.attributes.position.count, 0 );
        const index = geos.reduce( ( n, x ) => n + ( x.index?.count ?? 0 ), 0 );
        const bm    = new THREE.BatchedMesh( g.list.length, verts, index, g.mat );
        bm.castShadow    = g.cast;
        bm.receiveShadow = g.take;
        // ( opaque: drawn in any order, not sorted every frame )
        bm.sortObjects   = g.mat.transparent;
        // ( picked by each piece's own meshes, not this )
        bm.raycast       = () => {};
        const ids = new Map<string, number>(), made = new Map<string, number>();
        for ( const x of g.list ) {
          let gid = made.get( x.m.geometry.uuid );
          if ( gid === undefined ) made.set( x.m.geometry.uuid, ( gid = bm.addGeometry( x.m.geometry ) ) );
          ids.set( x.m.uuid, bm.addInstance( gid ) );
        }
        this.group.add( bm );
        this.batched.set( key, ( b = { bm, sig, ids } ) );
      }
      for ( const { m, own } of g.list ) {
        const id = b.ids.get( m.uuid )!;
        b.bm.setVisibleAt( id, !own );
        if ( own ) continue;
        m.visible = false;
        m.updateWorldMatrix( true, false );
        b.bm.setMatrixAt( id, at.multiplyMatrices( toGroup, m.matrixWorld ) );
      }
      b.bm.computeBoundingBox();
      b.bm.computeBoundingSphere();
    }
  }

  private matricesAt = -1;

  /**
   * The pieces' matrices worked out again, before a frame's drawn, when anything's been put in or taken out since ( a
   * piece built, moved only: sync works its own out as it moves it ).
  **/
  updateMatrices() {
    if ( this.matricesAt === sceneEdits ) return;
    this.matricesAt = sceneEdits;
    this.group.updateMatrixWorld( true );
  }

  objectGroup( uid: string ) {
    return this.shown.get( uid )?.group ?? null;
  }

  // ( the square left out of a faint piece: Unity x from, z from, x to, z to )
  private cut = uniform( new THREE.Vector4( 0, 0, 0, 0 ) );

  /**
   * A piece drawn a little see-through, or as it is again: the surroundings while a new chunk is previewed, left out
   * over the square `cut` ( Unity x, z from and to ), where the new ground goes, so they don't come up through it.
  **/
  setFaint( uid: string, on: boolean, cut: [number, number, number, number] | null = null ) {
    this.cut.value.set( ...( cut ?? [0, 0, 0, 0] ) );
    // ( three.js z is Unity's turned round )
    const x = positionWorld.x, z = positionWorld.z.negate(), c = this.cut;
    const outside = step( c.x, x ).mul( step( x, c.z ) ).mul( step( c.y, z ) ).mul( step( z, c.w ) ).lessThan( 0.5 );
    this.shown.get( uid )?.group.traverse( ( m ) => {
      if ( !( m instanceof THREE.Mesh ) ) return;
      const ud = m.userData as { solid?: THREE.Material | THREE.Material[] };
      if ( on && !ud.solid ) {
        ud.solid    = m.material;
        const faint = ( x: THREE.Material ) => {
          const f = Object.assign( x.clone(), { transparent: true, opacity: 0.8 } );
          if ( f instanceof THREE.NodeMaterial ) f.maskNode = outside;
          return f;
        };
        m.material  = Array.isArray( m.material ) ? m.material.map( faint ) : faint( m.material );
      } else if ( !on && ud.solid ) {
        m.material = ud.solid;
        delete ud.solid;
      }
    } );
    this.batchLater();
    redraw();
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
    if ( hasLook( o ) && !isModel( o ) && !( await this.index ) ) return group;
    const meshes = await Promise.all(
      o.parts
        .map( ( p, partIndex ) => ( { p, partIndex } ) )
        .filter( ( { p } ) => p.lod_index <= 0 && !!p.mesh ) // highest detail only, and something to draw
        .map( async ( { p, partIndex } ) => {
          const geo = isModel( o ) && p.mesh === meshKey( o.uid ) ? this.modelGeometry( o ) : await this.geometry( p.mesh );
          if ( !geo ) return null;
          // ( a map's surroundings lit as the ground they meet )
          let mats = await Promise.all( p.materials.map( ( m ) => this.materials.material( m, adjustOf( o ), p.mesh.startsWith( "Scenery/" ) ) ) );
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
    // a piece of colliders only ( drawn with the Collider tool, nothing to see in the game ): its colliders, see-through,
    // to pick and move it by
    if ( !hasLook( o ) )
      for ( const c of o.colliders ) {
        if ( c.shape === "Mesh" ) continue;
        const m    = shellObject( [colliderShell( c )], colliderLook( c.surface_type ) ).children[0] as THREE.Mesh;
        m.userData = { kind: "custom", uid: o.uid, partIndex: -1 };
        group.add( m );
      }
    group.updateMatrixWorld( true );
    return group;
  }

  // pieces with moving parts, as the view shows them moving: each mesh's own copy of its geometry, where each vertex
  // rests ( the piece's space ) and its normal, which part moves it; the parts' pivots. Made again when it's rebuilt.
  private moving = new Map<string, {
    built:  CustomObjectEntry;
    group:  THREE.Group;
    // the time it was last shown at ( NaN: not yet )
    t:      number;
    parts:  MovingPart[];
    pivots: ( V3 | null )[];
    meshes: { mesh: THREE.Mesh; shared: THREE.BufferGeometry; rest: V3[]; restN: V3[] | null; part: Int32Array }[];
  }>();

  /**
   * The moving parts of piece `uid` that move nothing while the preview's on ( what they'd take an earlier part has:
   * the game moves each vertex one way ), by their place in its list.
  **/
  movesNothing( uid: string ): number[] {
    return ( this.moving.get( uid )?.pivots ?? [] ).flatMap( ( p, k ) => ( p ? [] : [k] ) );
  }

  /**
   * Pieces' moving parts where they are `t` seconds on ( null: back at rest, the preview stopped ). True when any
   * moved ( the view's drawn again ).
  **/
  animate( t: number | null ): boolean {
    let any = false;
    for ( const [uid, mv] of this.moving ) {
      const s = this.shown.get( uid );
      if ( t !== null && s && s.built === mv.built && s.group === mv.group ) continue;
      this.restore( uid );
      any = true;
    }
    if ( t === null ) return any;
    for ( const [uid, s] of this.shown ) {
      const o = s.built;
      if ( !o || !s.group.visible || !s.group.children.length || !movingPartsOf( o ).length ) continue;
      const mv = this.moving.get( uid ) ?? this.prepareMoving( uid, o, s.group );
      if ( !mv || mv.t === t ) continue;
      mv.t = t;
      for ( const { mesh, rest, restN, part } of mv.meshes ) {
        const pos    = mesh.geometry.getAttribute( "position" ) as THREE.BufferAttribute, nor = mesh.geometry.getAttribute( "normal" ) as THREE.BufferAttribute | undefined;
        const inv    = mesh.matrix.clone().invert(), nInv = new THREE.Matrix3().getNormalMatrix( inv );
        const angles = mv.parts.map( ( m, k ) => ( mv.pivots[k] ? cycleAngle( m, mv.pivots[k]!, t ) : 0 ) );
        for ( let i = 0; i < rest.length; i++ ) {
          const k = part[i];
          if ( k < 0 || !mv.pivots[k] ) continue;
          const m = mv.parts[k], w = toView( o, moved( m, mv.pivots[k]!, t, rest[i] ) ).applyMatrix4( inv );
          pos.setXYZ( i, w.x, w.y, w.z );
          if ( nor && restN && m.kind !== "bob" ) {
            const n = dirToView( o, turned( m, angles[k], [0, 0, 0], restN[i] ) ).applyMatrix3( nInv ).normalize();
            nor.setXYZ( i, n.x, n.y, n.z );
          }
        }
        pos.needsUpdate = true;
        if ( nor ) nor.needsUpdate = true;
        mesh.geometry.computeBoundingSphere();
      }
      any = true;
    }
    return any;
  }

  /**
   * A moving piece's meshes given geometry of their own, and what moves with what worked out.
  **/
  private prepareMoving( uid: string, o: CustomObjectEntry, group: THREE.Group ) {
    const meshes = group.children.filter( ( c ): c is THREE.Mesh => c instanceof THREE.Mesh );
    const v      = new THREE.Vector3();
    const input  = meshes.map( ( mesh ) => {
      const g            = mesh.geometry, pos = g.getAttribute( "position" ), nor = g.getAttribute( "normal" ), idx = g.getIndex();
      const nm           = new THREE.Matrix3().getNormalMatrix( mesh.matrix );
      const points: V3[] = [], normals: V3[] = [];
      for ( let i = 0; i < pos.count; i++ ) {
        points.push( toPiece( o, v.fromBufferAttribute( pos, i ).applyMatrix4( mesh.matrix ) ) );
        if ( nor ) normals.push( dirToPiece( o, v.fromBufferAttribute( nor, i ).applyMatrix3( nm ) ) );
      }
      return { mesh, points, normals: nor ? normals : null, tris: idx ? ( idx.array as ArrayLike<number> ) : Array.from( { length: pos.count }, ( _, i ) => i ) };
    } );
    const parts            = movingPartsOf( o );
    const { part, pivots } = capture( parts, input, [0, 0, 0] );
    const mv               = {
      built: o, group, parts, pivots, t: NaN,
      meshes: input.map( ( x, k ) => {
        const shared = x.mesh.geometry;
        x.mesh.geometry = shared.clone();
        return { mesh: x.mesh, shared, rest: x.points, restN: x.normals, part: part[k] };
      } ),
    };
    this.moving.set( uid, mv );
    this.batchLater();
    return mv;
  }

  /**
   * A moving piece's meshes back on the geometry they share, at rest.
  **/
  private restore( uid: string ) {
    const mv = this.moving.get( uid );
    if ( !mv ) return;
    for ( const { mesh, shared } of mv.meshes ) {
      if ( mesh.geometry !== shared ) mesh.geometry.dispose();
      mesh.geometry = shared;
    }
    this.moving.delete( uid );
    this.batchLater();
  }

  clear() {
    for ( const uid of [...this.moving.keys()] ) this.restore( uid );
    for ( const s of this.shown.values() ) this.group.remove( s.group );
    this.shown.clear();
    for ( const b of this.batches.values() ) {
      this.group.remove( b.im );
      b.im.dispose();
    }
    this.batches.clear();
    for ( const b of this.batched.values() ) {
      this.group.remove( b.bm );
      b.bm.dispose();
    }
    this.batched.clear();
    for ( const b of this.parkedBatches.values() ) b.im.dispose();
    for ( const b of this.parkedBatched.values() ) b.bm.dispose();
    this.parkedBatches.clear();
    this.parkedBatched.clear();
    this.parked.clear();
    this.wave = { total: 0, done: 0, gen: this.wave.gen + 1 };
    for ( const c of this.guides.cache.values() ) if ( c.obj ) { this.guides.group.remove( c.obj ); disposeGuide( c.obj ); }
    this.guides.cache.clear();
    // everything let go on the GPU ( and the decoded pictures ): a big map's pieces, or a preview's, hold gigabytes
    for ( const g of this.geos.values() ) g.then( ( x ) => ( dropTree( x ), x?.dispose() ) );
    for ( const m of this.materials.mats.values() ) m.dispose();
    for ( const t of this.materials.texs.values() ) t.dispose();
    for ( const b of this.materials.images.values() ) b.then( ( x ) => x?.close() );
    this.geos.clear();
    this.materials.images.clear();
    this.materials.mats.clear();
    this.materials.making.clear();
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
          .then( ( g ) => ( treeLater( g ), g ) )
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
