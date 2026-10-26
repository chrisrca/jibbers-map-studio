// The map's lamps ( its floodlights' and snow cannons' lights, and pieces' own ): lit in the materials' shaders from a
// handful of uniforms, not as three's lights — switching three's lights on or off made every material in the map again
// ( 11 s on Joyosa Park as night fell ); this way it's numbers that change, never a shader. Unity's sums ( its punctual
// lights in URP ): over the distance squared, eased off to nothing at the light's range, a spot's cone eased between
// its inner and outer angles; times the surface's colour, facing it ( Unity's lights don't divide by π: added where the
// material glows, after three's own lighting ).

import * as THREE from "three/webgpu";
import { diffuseColor, dot, float, Fn, If, Loop, materialEmissive, max, normalWorld, normalWorldGeometry, positionWorld, smoothstep, uniform, uniformArray, vec3, vec4 } from "three/tsl";

export const LAMPS = 16;

const zero     = () => Array.from( { length: LAMPS }, () => new THREE.Vector4() );
// how many are lit
const count    = uniform( 0, "int" );
// where each is ( view space ), its range in w
const posRange = uniformArray( zero(), "vec4" );
// where each shines ( a point: none ), the cosine of half its outer cone in w ( a point: -2, all round )
const dirOuter = uniformArray( zero(), "vec4" );
// its colour times its intensity, the cosine of half its inner cone in w
const colInner = uniformArray( zero(), "vec4" );
// the piece each belongs to ( -1: none ): a piece isn't lit by its own lamps near them — the game's cast shadows,
// and a floodlight's housing and post are in its lamps' ( lit, they burnt white ); its foot, further down, is lit
const owners   = uniformArray( Array.from( { length: LAMPS }, () => -1 ), "float" );
// each piece's number, by its uid ( the lamps' owners )
const ownerOf  = new Map<string, number>();
// the piece being drawn ( its number, or -1 )
const drawn    = uniform( -1, "float" ).onObjectUpdate( ( { object } ) => {
  const uid = ( object?.userData as { uid?: string } | undefined )?.uid;
  return ( uid ? ownerOf.get( uid ) : undefined ) ?? -1;
} );

// The light the lamps throw on a surface facing `N` ( world space; before its colour ).
const lampLight = Fn( ( [N]: [typeof normalWorld] ) => {
  const sum = vec3( 0, 0, 0 ).toVar();
  Loop( { start: 0, end: count, type: "int" }, ( { i } ) => {
    // ( vec4s each: the types don't say so )
    const at     = ( a: typeof posRange ) => a.element( i ) as unknown as ReturnType<typeof vec4>;
    const p      = at( posRange ), d = at( dirOuter ), c = at( colInner );
    const toL    = p.xyz.sub( positionWorld );
    const d2     = max( dot( toL, toL ), float( 0.0001 ) );
    const l      = toL.div( d2.sqrt() );
    const others = ( owners.element( i ) as unknown as ReturnType<typeof float> ).equal( drawn ).select( smoothstep( float( 7 ), float( 9 ), d2.sqrt() ), float( 1 ) );
    // eased off to nothing at its range
    const f      = float( 1 ).sub( d2.div( p.w.mul( p.w ) ).pow( 2 ) ).clamp( 0, 1 );
    const fall   = f.mul( f ).div( d2 );
    // a spot's cone ( a point's all round )
    const cosA   = dot( l.negate(), d.xyz );
    const cone   = cosA.sub( d.w ).div( max( c.w.sub( d.w ), float( 0.0001 ) ) ).clamp( 0, 1 );
    const spot   = cone.mul( cone );
    const facing = max( dot( N, l ), float( 0 ) );
    If( fall.greaterThan( 0 ), () => {
      sum.addAssign( c.xyz.mul( fall ).mul( spot ).mul( facing ).mul( others ) );
    } );
  } );
  return sum;
} );

/**
 * A material lit by the lamps too ( its glow and theirs: made once, the lamps changing nothing of it ). `normal`: its
 * own world normal, when it works one out ( the terrain's ).
**/
export function withLamps<M extends THREE.MeshStandardNodeMaterial | THREE.MeshLambertNodeMaterial>( m: M, normal?: unknown ): M {
  // ( every node material takes a glow node: Lambert's types don't say so )
  const g        = m as unknown as { emissiveNode: unknown };
  // ( the mesh's own normal, not the shading one: asking for that again here undid the material's normal map and its
  // lighting — the terrain went dark, the game's features washed out )
  g.emissiveNode = vec3( ( g.emissiveNode as typeof materialEmissive | null ) ?? materialEmissive ).add( lampLight( ( normal as typeof normalWorld | undefined ) ?? normalWorldGeometry ).mul( diffuseColor.rgb ) );
  return m;
}

// A lamp to light ( view space; Unity's numbers ).
export interface Lamp {
  kind:      "spot" | "point";
  pos:       THREE.Vector3;
  dir:       THREE.Vector3;
  color:     THREE.Color;
  intensity: number;
  range:     number;
  // degrees, the whole cone
  angle:     number;
  inner:     number;
  // the piece it's on ( its uid ), which it doesn't light
  owner?:    string;
}

/**
 * The lamps lit now ( the first LAMPS of them ), each at `k` of its brightness ( 0 by day ).
**/
export function setLamps( list: Lamp[], k: number ) {
  const n     = k > 0.001 ? Math.min( LAMPS, list.length ) : 0;
  count.value = n;
  for ( let i = 0; i < n; i++ ) {
    const s = list[i];
    ( posRange.array[i] as THREE.Vector4 ).set( s.pos.x, s.pos.y, s.pos.z, Math.max( 0.01, s.range ) );
    const spot  = s.kind === "spot";
    const outer = spot ? Math.cos( ( Math.min( 179.9, s.angle ) * Math.PI ) / 360 ) : -2;
    // ( an inner cone of 0, as the game's lamps have: bright in the middle, fading all the way out to the edge )
    const inner = spot ? Math.cos( ( Math.min( s.angle, Math.max( 0, s.inner ) ) * Math.PI ) / 360 ) : -1;
    const dir   = s.dir.clone().normalize();
    if ( s.owner && !ownerOf.has( s.owner ) ) ownerOf.set( s.owner, ownerOf.size + 1 );
    ( owners.array as number[] )[i] = s.owner ? ownerOf.get( s.owner )! : -1;
    ( dirOuter.array[i] as THREE.Vector4 ).set( dir.x, dir.y, dir.z, outer );
    ( colInner.array[i] as THREE.Vector4 ).set( s.color.r * s.intensity * k, s.color.g * s.intensity * k, s.color.b * s.intensity * k, Math.max( inner, outer + 1e-4 ) );
  }
}

/**
 * How many are lit now.
**/
export const lampsLit = () => count.value as number;
