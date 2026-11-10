// The ground lit as the game lights a map's snow ( Custom/PisteSnow, its own lighting rather than PBR's: read from its
// shader ). Each light: wrapped round ( saturate( ( N·L + wrap ) / ( 1 + wrap ) ) ) times the colour; a highlight
// ( N·H to a power of e^( 10 × ( 1 − roughness ) ), at least 1, times its specular × 0.2 ); a sheen at a glance
// ( ( 1 − N·V )^5 × sheen, wrapped ); and light scattered through it from behind ( ( V·−L )² × the colour × scatter,
// wrapped ). The light all round as Lambert has it ( the sky's colours, times the colour ). Until the game's snow is
// read, plain Lambert.

import { BRDF_Lambert, clamp, diffuseColor, dot, exp, float, max, mix, normalView, positionViewDirection, pow, uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";

// The game's snow lighting numbers ( terrain.json ), and whether they're in ( 1 ) or the plain look's kept ( 0 )
export const snowLighting = {
  on:        uniform( 0 ),
  wrap:      uniform( 0.2 ),
  specular:  uniform( 0.15 ),
  roughness: uniform( 1 ),
  sheen:     uniform( 0.168 ),
  scatter:   uniform( 0.1 ),
};

type DirectInput = Parameters<THREE.PhongLightingModel["direct"]>[0];
type Light       = { lightDirection: Node<"vec3">; lightColor: Node<"vec3">; reflectedLight: { directDiffuse: { addAssign: ( v: unknown ) => void }; directSpecular: { addAssign: ( v: unknown ) => void } } };

class SnowLightingModel extends THREE.PhongLightingModel {
  constructor() {
    super( false );
  }

  direct( input: DirectInput ) {
    const { lightDirection: L, lightColor, reflectedLight } = input as unknown as Light;
    const s      = snowLighting;
    const N      = normalView as unknown as Node<"vec3">, V = positionViewDirection as unknown as Node<"vec3">;
    const albedo = ( diffuseColor as unknown as Node<"vec4"> ).rgb;
    // ( Unity's lights don't divide by π, three's do: its light comes in π times the game's )
    const light  = lightColor.mul( 1 / Math.PI );
    const wrap   = clamp( dot( N, L ).add( s.wrap ).div( s.wrap.add( 1 ) ), 0, 1 );
    const sheen  = pow( float( 1 ).sub( clamp( dot( N, V ), 0, 1 ) ), 5 ).mul( s.sheen );
    const behind = clamp( dot( V, L.negate() ), 0, 1 );
    const H      = L.add( V ).normalize();
    const power  = max( exp( float( 1 ).sub( s.roughness ).mul( 10 ) ), 1 );
    const shine  = pow( clamp( dot( N, H ), 0, 1 ), power ).mul( s.specular ).mul( 0.2 );
    const game   = albedo.mul( wrap ).add( sheen.mul( wrap ) ).add( behind.mul( behind ).mul( albedo ).mul( s.scatter ).mul( wrap ) ).mul( light );
    // ( plain Lambert, as before the game's snow is read )
    const plain  = lightColor.mul( clamp( dot( N, L ), 0, 1 ) ).mul( ( BRDF_Lambert as unknown as ( a: { diffuseColor: unknown } ) => Node<"vec3"> )( { diffuseColor: albedo } ) );
    reflectedLight.directDiffuse.addAssign( mix( plain, game, s.on ) );
    reflectedLight.directSpecular.addAssign( light.mul( shine ).mul( s.on ) );
  }
}

/**
 * The ground's material: Lambert's, lit as the game's snow.
**/
export class SnowMaterial extends THREE.MeshLambertNodeMaterial {
  setupLightingModel(): THREE.PhongLightingModel {
    return new SnowLightingModel();
  }
}
