// Blender's Object menu operators on modelled pieces: Set Origin, Mirror ( local axes ), Shade Smooth / Auto Smooth /
// Flat. A piece's mesh ( and curve, and rail ) are in its own coordinates, so moving its origin shifts them the other
// way and the piece's placement with it.

import * as THREE from "three/webgpu";
import { toThree, toUnity, type V3 } from "../core/coords";
import { pieceMatrix, transformCustom } from "../core/transform";
import type { CustomObjectEntry } from "../core/types";
import { withRail } from "../pieces/rail";
import type { ModelData } from "./build";
import { withModel } from "./objects";

type Modelled           = CustomObjectEntry & { model: ModelData };
export const isModelled = ( o: CustomObjectEntry ): o is Modelled => !!o.model;

const sub = ( p: V3, c: V3 ): V3 => [p[0] - c[0], p[1] - c[1], p[2] - c[2]];

/**
 * Everything in the piece's own coordinates moved by -c ( its mesh, curve and rail ).
**/
function shifted( o: Modelled, c: V3 ): Modelled {
  const m                = o.model;
  const model: ModelData = {
    ...m,
    mesh: { ...m.mesh, v: m.mesh.v.map( ( p ) => sub( p, c ) ) },
    ...( m.curve ? { curve: { ...m.curve, splines: m.curve.splines.map( ( s ) => ( { ...s, points: s.points.map( ( q ) => ( { ...q, p: sub( q.p, c ) } ) ) } ) ) } } : {} ),
  };
  let out = withModel( o, model ) as Modelled;
  if ( o.rail ) out = withRail( out, { ...o.rail, points: o.rail.points.map( ( p ) => sub( p, c ) ), parts: undefined } ) as Modelled;
  return out;
}

/**
 * The middle of its geometry, in its own coordinates ( the mean of its corners, as Blender's Median Center ).
**/
function middle( o: Modelled ): V3 {
  const pts = o.model.mesh.v.length ? o.model.mesh.v : ( o.model.curve?.splines.flatMap( ( s ) => s.points.map( ( q ) => q.p ) ) ?? [] );
  if ( !pts.length ) return [0, 0, 0];
  const c = pts.reduce( ( a, p ) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]] as V3, [0, 0, 0] as V3 );
  return [c[0] / pts.length, c[1] / pts.length, c[2] / pts.length];
}

/**
 * Origin to a point ( view space ): the piece stays where it is, its origin goes there.
**/
export function originTo( o: Modelled, at: THREE.Vector3 ): Modelled {
  const local = toUnity( at.clone().applyMatrix4( pieceMatrix( o ).invert() ) );
  const moved = transformCustom( o, new THREE.Matrix4().makeTranslation( ...at.clone().sub( toThree( [o.position.x, o.position.y, o.position.z] ) ).toArray() ) ) as Modelled;
  return shifted( moved, local );
}

/**
 * Origin to Geometry: the origin to the middle of the piece.
**/
export function originToGeometry( o: Modelled ): Modelled {
  return originTo( o, toThree( middle( o ) ).applyMatrix4( pieceMatrix( o ) ) );
}

/**
 * Geometry to Origin: the piece moved so its middle is where its origin is.
**/
export function geometryToOrigin( o: Modelled ): Modelled {
  return shifted( o, middle( o ) );
}

/**
 * Mirror along one of its own axes ( the game's index ), baked into it: corners flipped, faces turned back round.
**/
export function mirrorLocal( o: Modelled, axis: 0 | 1 | 2 ): Modelled {
  const flip             = ( p: V3 ): V3 => p.map( ( v, i ) => ( i === axis ? -v : v ) ) as V3;
  const m                = o.model;
  const model: ModelData = {
    ...m,
    mesh: { ...m.mesh, v: m.mesh.v.map( flip ), f: m.mesh.f.map( ( f ) => [...f].reverse() ) },
    ...( m.curve ? { curve: { ...m.curve, splines: m.curve.splines.map( ( s ) => ( { ...s, points: s.points.map( ( q ) => ( { ...q, p: flip( q.p ) } ) ) } ) ) } } : {} ),
    // ( painted: its layout is made again for the new faces )
    paint: m.paint ? { ...m.paint, topo: undefined, uv: undefined } : undefined,
  };
  let out = withModel( o, model ) as Modelled;
  if ( o.rail ) out = withRail( out, { ...o.rail, points: o.rail.points.map( flip ), up: o.rail.up ? flip( o.rail.up ) : undefined, parts: undefined } ) as Modelled;
  return out;
}

/**
 * Shade Smooth ( every face smooth, no edge kept sharp ), Auto Smooth ( smooth, edges sharper than 30° kept ), Flat.
**/
export function shade( o: Modelled, how: "smooth" | "auto" | "flat" ): Modelled {
  const m = o.model;
  return withModel( o, { ...m, mesh: { ...m.mesh, s: m.mesh.f.map( () => how !== "flat" ) }, smoothAngle: how === "smooth" ? 180 : how === "auto" ? 30 : m.smoothAngle } ) as Modelled;
}
