import { describe, expect, it } from "vitest";
import { cross, dot, edgesOf, ek, faceCenter, faceNormal, primitive, PRIMITIVES, recalcOutside, runs, type Mesh } from "../../src/model/mesh";
import { duplicate, edgeLoop, edgeRing, extrudeEdges, extrudeFaces, faceLoop, fill, inset, loopCut, merge, remove, selFromFaces, subdivide } from "../../src/model/ops";

/**
 * Signed volume ( positive: faces point outwards ).
**/
function volume( g: Mesh ) {
  let v = 0;
  for ( const f of g.f ) for ( let i = 1; i + 1 < f.length; i++ ) v += dot( g.v[f[0]], cross( g.v[f[i]], g.v[f[i + 1]] ) );
  return v / 6;
}
/**
 * Every edge between exactly two faces that run it opposite ways ( a closed, consistently facing surface ).
**/
function closed( g: Mesh ) {
  for ( const e of edgesOf( g ).values() ) {
    if ( e.faces.length !== 2 ) return false;
    const [f1, f2] = e.faces.map( ( f ) => g.f[f] );
    if ( runs( f1, e.a, e.b ) === runs( f2, e.a, e.b ) ) return false;
  }
  return true;
}
const top = ( g: Mesh ) => g.f.findIndex( ( _, i ) => faceNormal( g, i )[1] > 0.99 );

describe( "primitives", () => {
  it( "are closed and face outwards (the solid ones), a plane faces up", () => {
    for ( const p of PRIMITIVES ) {
      const g = primitive( p.id );
      if ( ["plane", "grid", "circle"].includes( p.id ) ) continue;
      expect( closed( g ), p.id ).toBe( true );
      expect( volume( g ), p.id ).toBeGreaterThan( 0 );
    }
    expect( primitive( "cube" ).v.length  ).toBe( 8 );
    expect( volume( primitive( "cube" ) ) ).toBeCloseTo( 8, 5 );
    const plane = primitive( "plane" );
    expect( faceNormal( plane, 0 )[1]               ).toBeCloseTo( 1 );
    expect( faceNormal( primitive( "grid" ), 0 )[1] ).toBeCloseTo( 1 );
  } );

  it( "recalculate outside puts flipped faces back", () => {
    const g = primitive( "cube" );
    g.f[2].reverse();
    g.f[4].reverse();
    const r = recalcOutside( g );
    expect( closed( r ) ).toBe( true );
    expect( volume( r ) ).toBeGreaterThan( 0 );
  } );
} );

describe( "edit operators", () => {
  it( "extrude the top of a box up: a taller closed box", () => {
    const g = primitive( "cube" );
    const t = top( g );
    const r = extrudeFaces( g, new Set( [t] ) );
    expect( r.normal[1] ).toBeCloseTo( 1 );
    // move the extruded face up 1 m
    for ( const v of r.sel.v ) r.mesh.v[v] = [r.mesh.v[v][0], r.mesh.v[v][1] + 1, r.mesh.v[v][2]];
    expect( r.mesh.f.length  ).toBe( 10   );
    expect( r.mesh.v.length  ).toBe( 12   );
    expect( closed( r.mesh ) ).toBe( true );
    expect( volume( r.mesh ) ).toBeCloseTo( 12, 5 );
  } );

  it( "inset a face: a ring inside it, still closed; with depth it rises", () => {
    const g = primitive( "cube" );
    const t = top( g );
    const r = inset( g, new Set( [t] ), 0.25, 0.5 );
    expect( r.mesh.f.length  ).toBe( 10   );
    expect( closed( r.mesh ) ).toBe( true );
    expect( volume( r.mesh ) ).toBeGreaterThan( 8 );
    // the inset face is 0.25 in from each side: 1.5 m square
    const f  = [...r.sel.f][0];
    const xs = r.mesh.f[f].map( ( v ) => r.mesh.v[v][0] );
    expect( Math.max( ...xs ) - Math.min( ...xs ) ).toBeCloseTo( 1.5, 5 );
    expect( faceCenter( r.mesh, f )[1]            ).toBeCloseTo( 1.5, 5 );
  } );

  it( "loop cut round a box, and the ring and loop behind it", () => {
    const g    = primitive( "cube" );
    // a vertical edge
    const k    = [...edgesOf( g ).entries()].find( ( [, e] ) => Math.abs( g.v[e.a][1] - g.v[e.b][1] ) > 1 )![0];
    const ring = edgeRing( g, k );
    expect( ring.closed      ).toBe( true );
    expect( ring.ring.length ).toBe( 4    );
    const r = loopCut( g, k, 2 );
    expect( r.mesh.f.length  ).toBe( 14   );
    expect( r.mesh.v.length  ).toBe( 16   );
    expect( closed( r.mesh ) ).toBe( true );
    expect( volume( r.mesh ) ).toBeCloseTo( 8, 5 );
    // the new loop is selected, and walking it from one of its edges finds the whole of it
    const one  = [...r.sel.e][0];
    const loop = edgeLoop( r.mesh, one );
    expect( loop.length ).toBe( 4 );
  } );

  it( "loops along a grid's border, across it, and the faces round a ring ( Alt+click )", () => {
    const g      = primitive( "grid", { segments: 3 } );
    const border = [...edgesOf( g ).entries()].filter( ( [, e] ) => e.faces.length === 1 ).map( ( [k] ) => k );
    // ( a corner has two border edges, a vertex between corners has three edges: the border runs round all of it )
    expect( edgeLoop( g, border[0] ).sort() ).toEqual( [...border].sort() );
    // across the grid: a line of three edges, end to end
    const inner = [...edgesOf( g ).entries()].find( ( [, e] ) => e.faces.length === 2 )![0];
    expect( edgeLoop( g, inner ).length ).toBe( 3 );
    // the faces round the ring through an edge: a row of three quads
    expect( faceLoop( g, inner ).length ).toBe( 3 );
    // round a box: the four sides
    const cube = primitive( "cube" );
    const up   = [...edgesOf( cube ).entries()].find( ( [, e] ) => Math.abs( cube.v[e.a][1] - cube.v[e.b][1] ) > 1 )![0];
    expect( faceLoop( cube, up ).length ).toBe( 4 );
  } );

  it( "loop cut on a grid stops at its edge; slide moves the cut", () => {
    const g = primitive( "grid", { segments: 3 } );
    const k = ek( g.f[4][0], g.f[4][1] );
    const r = loopCut( g, k, 1, 0.5 );
    expect( r.mesh.f.length ).toBe( 12 );
  } );

  it( "subdivide a face; neighbours keep the surface closed", () => {
    const g = primitive( "cube" );
    const r = subdivide( g, new Set( [top( g )] ) );
    expect( r.mesh.f.length  ).toBe( 9    );
    expect( closed( r.mesh ) ).toBe( true );
    expect( volume( r.mesh ) ).toBeCloseTo( 8, 5 );
  } );

  it( "delete a face and fill the hole again; merge; dissolve", () => {
    const g     = primitive( "cube" );
    const t     = top( g );
    const ring  = g.f[t];
    const holed = remove( g, selFromFaces( g, [t] ), "faces" );
    expect( holed.mesh.f.length  ).toBe( 5     );
    expect( closed( holed.mesh ) ).toBe( false );
    const verts  = ring.map( ( v ) => holed.mesh.v.findIndex( ( p ) => p.every( ( x, k ) => x === g.v[v][k] ) ) );
    const filled = fill( holed.mesh, verts );
    expect( closed( filled.mesh ) ).toBe( true );
    expect( volume( filled.mesh ) ).toBeCloseTo( 8, 5 );
    // the top four merged at their centre: a pyramid-like solid with a point
    const m = merge( g, ring, "center" );
    expect( m.mesh.v.length  ).toBe( 5    );
    expect( closed( m.mesh ) ).toBe( true );
    // dissolving a loop cut's edges puts back six faces
    const k    = [...edgesOf( g ).entries()].find( ( [, e] ) => Math.abs( g.v[e.a][1] - g.v[e.b][1] ) > 1 )![0];
    const cut  = loopCut( g, k );
    const back = remove( cut.mesh, cut.sel, "dissolveEdges" );
    expect( back.mesh.f.length  ).toBe( 6    );
    expect( closed( back.mesh ) ).toBe( true );
  } );

  it( "extrude an open edge into a face; duplicate makes a separate copy", () => {
    const g = primitive( "plane" );
    const e = ek( g.f[0][0], g.f[0][1] );
    const r = extrudeEdges( g, new Set( [e] ) );
    expect( r.mesh.f.length ).toBe( 2 );
    // the new face carries on the plane's facing ( shares the edge running the other way )
    const shared = edgesOf( r.mesh ).get( e )!;
    expect( runs( r.mesh.f[shared.faces[0]], shared.a, shared.b ) ).not.toBe( runs( r.mesh.f[shared.faces[1]], shared.a, shared.b ) );
    const d = duplicate( primitive( "cube" ), selFromFaces( primitive( "cube" ), [0, 1, 2, 3, 4, 5] ) );
    expect( d.mesh.f.length ).toBe( 12 );
    expect( d.mesh.v.length ).toBe( 16 );
    expect( d.sel.f.size    ).toBe( 6  );
  } );
} );


describe( "bevel", () => {
  it( "one edge of a box: a chamfer, still closed", async () => {
    const { bevel } = await import( "../../src/model/bevel" );
    const g         = primitive( "cube" );
    const k         = [...edgesOf( g ).keys()][0];
    const r         = bevel( g, new Set( [k] ), 0.2 );
    expect( r.mesh.f.length  ).toBe( 7    );
    expect( r.mesh.v.length  ).toBe( 10   );
    expect( closed( r.mesh ) ).toBe( true );
    expect( volume( r.mesh ) ).toBeCloseTo( 8    - 0.5 * 0.2 * 0.2 * 2, 4 );
  } );

  it( "every edge of a box, rounded in segments: strips and corner patches, closed", async () => {
    const { bevel } = await import( "../../src/model/bevel" );
    const g         = primitive( "cube" );
    const r         = bevel( g, new Set( edgesOf( g ).keys() ), 0.2 );
    expect( r.mesh.f.length  ).toBe( 6 + 12 + 8 );
    expect( closed( r.mesh ) ).toBe( true       );
    const r3 = bevel( g, new Set( edgesOf( g ).keys() ), 0.25, 3 );
    expect( closed( r3.mesh ) ).toBe( true );
    expect( volume( r3.mesh ) ).toBeGreaterThan( volume( r.mesh ) - 0.5 );
    expect( volume( r3.mesh ) ).toBeLessThan( 8 );
  } );
} );

describe( "bridge", () => {
  it( "joins two open rings of a tube into its middle again", async () => {
    const { bridge, remove, selFromFaces: sff } = await import( "../../src/model/ops" );
    const { edgesOf: eo } = await import( "../../src/model/mesh" );
    const g               = primitive( "cylinder", { segments: 8 } );
    // cut out the middle band: delete the side faces, leaving two caps with open rims
    const sides           = g.f.map( ( _, i ) => i ).filter( ( i ) => Math.abs( faceNormal( g, i )[1] ) < 0.5 );
    const holed           = remove( g, sff( g, sides ), "faces" ).mesh;
    const rims            = new Set( [...eo( holed ).entries()].filter( ( [, e] ) => e.faces.length === 1 ).map( ( [k] ) => k ) );
    expect( rims.size ).toBe( 16 );
    const r = bridge( holed, rims );
    expect( r.mesh.f.length  ).toBe( 10   );
    expect( closed( r.mesh ) ).toBe( true );
    expect( volume( r.mesh ) ).toBeGreaterThan( 0 );
  } );
} );

describe( "groups for individual origins", () => {
  it( "finds each connected bit of a selection", async () => {
    const { selectedGroups, selFromFaces: sff } = await import( "../../src/model/ops" );
    const g      = primitive( "cube" );
    const top    = g.f.findIndex( ( _, i ) => faceNormal( g, i )[1] > 0.99 ), bottom = g.f.findIndex( ( _, i ) => faceNormal( g, i )[1] < -0.99 );
    const groups = selectedGroups( g, sff( g, [top, bottom] ) );
    expect( groups.length                   ).toBe( 2 );
    expect( groups.map( ( x ) => x.length ) ).toEqual( [4, 4] );
  } );
} );
