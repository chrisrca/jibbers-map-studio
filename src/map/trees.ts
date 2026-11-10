// The map's terrain trees as the editor keeps them: ordinary features ( the game's own trees ) and pieces ( trees
// built from the map's meshes ), one a tree, made from each chunk's tree prototypes ( Map-Tools' TreePrototypeData:
// 28 bytes a tree, its place 0..1 of the chunk ) when a project opens. Saved, they're packed back into them while
// each still stands as a terrain tree does ( upright, as wide as deep, on a chunk ); otherwise saved as it is now.

import type { V3 } from "../core/coords";
import { composeUnity, pieceMatrix, transformCustom } from "../core/transform";
import { type ChunkEntry, type CustomCollider, type CustomObjectEntry, type CustomPart, type ObjectEntry, type TreeMark, xyz } from "../core/types";

// ( a tree's bytes: position xyz 0..1, width and height scale, turn ( radians ), colour rgba )
const STRIDE = 28;

// ( the game draws its own trees at half their feature's size: objectsRenderer/looks.ts PLACEHOLDER_TO_GAME )
const GAME_TREE = 0.5;

// The Outliner collection the trees are put in when they're first brought in.
export const TREES_COLLECTION = "trees";

export type TreeProto = { object_id?: string; parts?: CustomPart[]; lod_groups?: unknown[]; colliders?: CustomCollider[]; instances?: number[] | null };

// A piece tree's kind in its own space ( a prototype's parts, colliders and LOD groups ).
export type TreeKind = { parts: CustomPart[]; colliders: CustomCollider[]; lod_groups: unknown[] };

type Box = Pick<ChunkEntry, "key" | "position" | "size">;

/**
 * Every chunk's trees as features and pieces, in the order they're packed ( the saved uids given back in it ).
**/
export function treesOf( chunks: Box[], extras: Record<string, { treePrototypes?: unknown[] }>, uid: ( i: number ) => string ): { objects: ObjectEntry[]; pieces: CustomObjectEntry[] } {
  const objects: ObjectEntry[]       = [];
  const pieces:  CustomObjectEntry[] = [];
  let k                              = 0;
  for ( const c of chunks ) {
    for ( const p of ( extras[c.key]?.treePrototypes ?? [] ) as TreeProto[] ) {
      const b = Uint8Array.from( ( p.instances ?? [] ) as ArrayLike<number> );
      const n = Math.floor( b.length / STRIDE );
      const d = new DataView( b.buffer );
      // ( the kind every tree of it is )
      const kind: TreeKind = { parts: p.parts ?? [], colliders: p.colliders ?? [], lod_groups: p.lod_groups ?? [] };
      for ( let i = 0; i < n; i++ ) {
        const f        = ( j: number ) => d.getFloat32( i * STRIDE + j * 4, true );
        const position = [c.position[0] + f( 0 ) * c.size[0], c.position[1] + f( 1 ) * c.size[1], c.position[2] + f( 2 ) * c.size[2]] as V3;
        const turn     = ( f( 5 ) * 180 ) / Math.PI;
        const tree     = { color: Array.from( b.subarray( i * STRIDE + 24, i * STRIDE + 28 ) ) as TreeMark["color"] };
        if ( p.object_id ) objects.push( { uid: uid( k++ ), id: p.object_id, position, rotation: [0, turn, 0], scale: [f( 3 ) * GAME_TREE, f( 4 ) * GAME_TREE, f( 3 ) * GAME_TREE], params: {}, tree } );
        else if ( p.parts?.length ) {
          // ( the prototype's parts are the tree's own; a piece's are where they are in the world )
          const own: CustomObjectEntry = {
            uid: uid( k++ ), surface_type: "Generic", can_stabilize: false, can_rotate: false, can_magnetize: false, intended_up_method: 0,
            disable_distance_culling: false, timed_visibility: false, visible_from_hour: 0, visible_until_hour: 24,
            position: xyz( [0, 0, 0] ), rotation: xyz( [0, 0, 0] ), scale: xyz( [1, 1, 1] ),
            ...kind, lights: [], tree: { ...tree, kind },
          };
          pieces.push( transformCustom( own, composeUnity( position, [0, turn, 0], [f( 3 ), f( 4 ), f( 3 )] ) ) );
        }
      }
    }
  }
  return { objects, pieces };
}

/**
 * A turn's about-up part, if it's only that ( Unity degrees ): upright, or turned over on both other axes ( the same ).
**/
function yawOf( r: V3 ): number | null {
  const near = ( a: number, to: number ) => Math.abs( ( ( ( a - to ) % 360 ) + 540 ) % 360 - 180 ) < 1e-3;
  if ( near( r[0], 0 ) && near( r[2], 0 ) ) return r[1];
  if ( near( r[0], 180 ) && near( r[2], 180 ) ) return r[1] + 180;
  return null;
}

// ( a part's or collider's own settings: all but where it is, turned and sized )
const settings = ( x: object ) => {
  const { local_position: _p, local_rotation: _r, local_scale: _s, ...rest } = x as { local_position?: unknown; local_rotation?: unknown; local_scale?: unknown };
  return JSON.stringify( rest );
};
const at3 = ( x: { local_position: { x: number; y: number; z: number } } ) => [x.local_position.x, x.local_position.y, x.local_position.z];

/**
 * Whether a piece tree is still the kind it came as: its parts and colliders where that kind puts them, with the same
 * settings ( turns and sizes left out: a stretched tree's tipped colliders don't come back out of the world exactly ).
**/
function stillKind( o: CustomObjectEntry, kind: TreeKind ): boolean {
  if ( o.parts.length !== kind.parts.length || o.colliders.length !== kind.colliders.length || JSON.stringify( o.lod_groups ) !== JSON.stringify( kind.lod_groups ) ) return false;
  const placed = transformCustom( { ...o, position: xyz( [0, 0, 0] ), rotation: xyz( [0, 0, 0] ), scale: xyz( [1, 1, 1] ), ...kind }, pieceMatrix( o ) );
  const same   = ( a: CustomPart[] | CustomCollider[], b: CustomPart[] | CustomCollider[] ) =>
    a.every( ( x, i ) => settings( x ) === settings( b[i] ) && Math.hypot( ...at3( x ).map( ( v, k ) => v - at3( b[i] )[k] ) ) < 0.01 );
  return same( o.parts, placed.parts ) && same( o.colliders, placed.colliders );
}

// ( a piece that stands only as a tree does: none of a piece's own settings, which a tree prototype hasn't; a
// scattered tree's library piece it came from isn't kept )
const plainPiece = ( o: CustomObjectEntry ) =>
  o.surface_type === "Generic" && !o.can_stabilize && !o.can_rotate && !o.can_magnetize && !o.intended_up_method && !o.disable_distance_culling && !o.timed_visibility && !o.lights.length &&
  !["rail", "kitColliders", "scenery", "model", "fence"].some( ( k ) => k in o ) && ( !o.source || !!o.tree?.kind );

// ( a kind as its settings, worked out once a kind: a copied tree's is a copy of it )
const kindKeys = new WeakMap<TreeKind, string>();
const kindKey  = ( k: TreeKind ) => kindKeys.get( k ) ?? ( kindKeys.set( k, JSON.stringify( k ) ), kindKeys.get( k )! );

/**
 * The features and pieces that are trees, packed back into their chunks' tree prototypes; the rest as they are ( a
 * tree no longer standing as one: an ordinary feature or piece ). The packed trees' uids in the order they're packed.
**/
export function packTrees( chunks: Box[], objects: ObjectEntry[], pieces: CustomObjectEntry[] ) {
  const protos: Record<string, TreeProto[]> = {};
  const uids:   string[]                     = [];
  // ( by chunk, then prototype: its trees )
  const by = new Map<string, { proto: TreeProto; trees: { uid: string; at: V3; w: number; h: number; turn: number; color: TreeMark["color"] }[] }>();
  const chunkOf = ( at: V3 ) => chunks.find( ( c ) => at[0] >= c.position[0] && at[0] <= c.position[0] + c.size[0] && at[2] >= c.position[2] && at[2] <= c.position[2] + c.size[2] );
  const put = ( c: Box, key: string, proto: () => TreeProto, t: { uid: string; at: V3; w: number; h: number; turn: number; color: TreeMark["color"] } ) => {
    const k = `${c.key}\n${key}`;
    let g   = by.get( k );
    if ( !g ) {
      by.set( k, ( g = { proto: proto(), trees: [] } ) );
      ( protos[c.key] ??= [] ).push( g.proto );
    }
    g.trees.push( t );
  };
  const restObjects: ObjectEntry[] = [];
  for ( const o of objects ) {
    const turn = o.tree ? yawOf( o.rotation ) : null, c = turn === null ? undefined : chunkOf( o.position );
    if ( !o.tree || turn === null || !c || Math.abs( o.scale[0] - o.scale[2] ) > 1e-4 || Object.keys( o.params ).length || o.lift ) {
      restObjects.push( o.tree ? withoutTree( o ) : o );
      continue;
    }
    put( c, `id:${o.id}`, () => ( { object_id: o.id, parts: [], lod_groups: [], colliders: [] } ), { uid: o.uid, at: o.position, w: o.scale[0] / GAME_TREE, h: o.scale[1] / GAME_TREE, turn, color: o.tree.color } );
  }
  const restPieces: CustomObjectEntry[] = [];
  for ( const o of pieces ) {
    const at   = [o.position.x, o.position.y, o.position.z] as V3;
    const turn = o.tree ? yawOf( [o.rotation.x, o.rotation.y, o.rotation.z] ) : null, c = turn === null ? undefined : chunkOf( at );
    if ( !o.tree || turn === null || !c || Math.abs( o.scale.x - o.scale.z ) > 1e-4 || !plainPiece( o ) ) {
      restPieces.push( o.tree ? withoutTree( o ) : o );
      continue;
    }
    // ( the kind it came as; changed since, its own parts and colliders out of the world, a kind of its own )
    const kind = o.tree.kind && stillKind( o, o.tree.kind ) ? o.tree.kind : null;
    const own  = kind ?? ( ( l ) => ( { parts: l.parts, colliders: l.colliders, lod_groups: l.lod_groups } ) )( transformCustom( o, pieceMatrix( o ).invert() ) );
    put( c, kind ? kindKey( kind ) : JSON.stringify( own ), () => ( { object_id: "", ...own } ), { uid: o.uid, at, w: o.scale.x, h: o.scale.y, turn, color: o.tree.color } );
  }
  // ( each prototype's trees as its instances, in chunk order )
  for ( const c of chunks )
    for ( const p of protos[c.key] ?? [] ) {
      const g = [...by.values()].find( ( x ) => x.proto === p )!;
      const b = new Uint8Array( g.trees.length * STRIDE ), d = new DataView( b.buffer );
      g.trees.forEach( ( t, i ) => {
        const o = i * STRIDE;
        [( t.at[0] - c.position[0] ) / c.size[0], ( t.at[1] - c.position[1] ) / c.size[1], ( t.at[2] - c.position[2] ) / c.size[2], t.w, t.h, ( t.turn * Math.PI ) / 180].forEach( ( v, j ) => d.setFloat32( o + j * 4, v, true ) );
        b.set( t.color, o + 24 );
        uids.push( t.uid );
      } );
      p.instances = Array.from( b );
    }
  return { protos, objects: restObjects, pieces: restPieces, uids };
}

function withoutTree<T extends { tree?: TreeMark }>( o: T ): T {
  const { tree: _t, ...rest } = o;
  return rest as T;
}
