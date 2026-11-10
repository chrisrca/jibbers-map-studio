// Separate ( P ): parts of a mesh made meshes of their own, as Blender's: the selection, each loose part, or each
// material's faces. Each part takes its faces with their materials, smoothing and UVs, its loose edges and its creases.

import { type Mesh, compact, ek } from "../mesh";
import { type Sel, linked } from "./selection";

export type SeparateKind = "selection" | "loose" | "material";

/**
 * The faces and loose edges given as a mesh of their own ( their corners only ).
**/
function part( g: Mesh, faces: number[], wires: [number, number][] ): Mesh {
  const sub: Mesh = {
    v: g.v,
    f: faces.map( ( i ) => g.f[i] ),
    m: faces.map( ( i ) => g.m[i] ?? 0 ),
    s: faces.map( ( i ) => g.s[i] ?? false ),
    w: wires,
    ...( g.u ? { u: faces.map( ( i ) => g.u![i] ?? [] ) } : {} ),
    ...( g.c ? { c: g.c } : {} ),
  };
  return compact( sub ).mesh;
}

/**
 * The mesh split as `kind` says: what stays ( `rest` ), and the parts that go off as pieces of their own ( none: nothing
 * to separate ). Loose parts and materials: the first stays.
**/
export function separate( g: Mesh, kind: SeparateKind, sel: Sel ): { rest: Mesh; parts: Mesh[] } {
  const all = g.f.map( ( _, i ) => i );
  let groups: { faces: number[]; wires: [number, number][] }[];
  if ( kind === "selection" ) {
    // the selected faces, loose edges with both ends selected, and a copy of each selected edge the faces left
    // behind still use ( as Blender's: the rest keeps it, the part has it loose )
    const faces = all.filter( ( i ) => sel.f.has( i ) );
    const own   = new Set( faces.flatMap( ( i ) => g.f[i].map( ( v, k, f ) => ek( v, f[( k + 1 ) % f.length] ) ) ) );
    const wires = [
      ...g.w.filter( ( [a, b] ) => sel.v.has( a ) && sel.v.has( b ) ),
      ...[...sel.e].filter( ( k ) => !own.has( k ) && !g.w.some( ( [a, b] ) => ek( a, b ) === k ) ).map( ( k ) => k.split( "_" ).map( Number ) as [number, number] ),
    ];
    groups      = faces.length || wires.length ? [{ faces, wires }] : [];
  } else if ( kind === "loose" ) {
    // each set of corners joined by edges ( faces' and loose ones )
    const seen = new Set<number>(), islands: Set<number>[] = [];
    for ( const v of g.v.keys() ) {
      if ( seen.has( v ) ) continue;
      const island = linked( g, [v] );
      for ( const x of island ) seen.add( x );
      if ( all.some( ( i ) => island.has( g.f[i][0] ) ) || g.w.some( ( [a] ) => island.has( a ) ) ) islands.push( island );
    }
    groups = islands.map( ( isl ) => ( { faces: all.filter( ( i ) => isl.has( g.f[i][0] ) ), wires: g.w.filter( ( [a] ) => isl.has( a ) ) } ) ).slice( 1 );
  } else {
    const slots = [...new Set( g.m )].sort( ( a, b ) => a - b );
    groups      = slots.slice( 1 ).map( ( k ) => ( { faces: all.filter( ( i ) => ( g.m[i] ?? 0 ) === k ), wires: [] } ) );
  }
  if ( !groups.length ) return { rest: g, parts: [] };
  const goneF = new Set( groups.flatMap( ( x ) => x.faces ) );
  // ( only loose edges leave: an edge copied off a face stays with it )
  const goneW = new Set( groups.flatMap( ( x ) => x.wires.map( ( [a, b] ) => ek( a, b ) ) ).filter( ( k ) => g.w.some( ( [a, b] ) => ek( a, b ) === k ) ) );
  // ( a separated face's edges stay on as the rest's where its own faces still use them; loose ones go with it )
  const rest  = part( g, all.filter( ( i ) => !goneF.has( i ) ), g.w.filter( ( [a, b] ) => !goneW.has( ek( a, b ) ) ) );
  return { rest, parts: groups.map( ( x ) => part( g, x.faces, x.wires ) ) };
}
