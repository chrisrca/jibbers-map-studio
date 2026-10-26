import { describe, expect, it } from "vitest";
import { fromBlender, rotFromBlender, rotToBlender, toBlender } from "../../src/core/blenderAxes";
import { unityEulerToQuat, type V3 } from "../../src/core/coords";

const near = ( a: V3, b: V3 ) => a.forEach( ( v, i ) => expect( v ).toBeCloseTo( b[i], 4 ) );

describe( "Blender's axes", () => {
  it( "swaps up and depth for positions", () => {
    expect( toBlender( [1, 2, 3] )                ).toEqual( [1, 3, 2] );
    expect( fromBlender( toBlender( [4, 5, 6] ) ) ).toEqual( [4, 5, 6] );
  } );

  it( "turns a Unity yaw into a turn about Blender's Z (the other way: left- to right-handed)", () => {
    near( rotToBlender( [0, 90, 0] ), [0, 0, -90] );
    near( rotToBlender( [0, 0,  0] ), [0, 0, 0  ] );
  } );

  it( "tips about X the same way round as Blender sees it", () => {
    // Unity +X pitch takes its +Y ( up ) toward +Z ( forward ); in Blender that's Z toward Y: a turn of -90 about X
    near( rotToBlender( [90, 0, 0] ), [-90, 0, 0] );
  } );

  it( "comes back to the same rotation", () => {
    for ( const e of [[10, 20, 30], [-43, 4.7, -5.6], [0, 180, 0], [89, 45, 10]] as V3[] ) {
      const back = rotFromBlender( rotToBlender( e ) );
      const a    = unityEulerToQuat( e ), b = unityEulerToQuat( back );
      expect( Math.abs( a.dot( b ) ) ).toBeCloseTo( 1, 6 );
    }
  } );
} );
