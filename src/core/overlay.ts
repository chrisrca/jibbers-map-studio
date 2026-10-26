// The game's custom-object shader can lay snow ( or any colour ) over surfaces that face a direction — the
// "overlay", switched on by the material keyword `_OVERLAY` ( Map-Tools CustomObjectLit.shader ). Many of Melon's
// materials use it, so a material dropped onto a piece can bring snow along unless it's switched off.

import type { CustomMaterial } from "./types";

// jbrmap::MaterialProp as serialized ( externally tagged ).
type Prop = { Float: number } | { Color: [number, number, number, number] } | { Vector: [number, number, number, number] } | { Texture: string };

const props    = ( m: CustomMaterial ) => ( m.extra_props ?? {} ) as Record<string, Prop>;
const keywords = ( m: CustomMaterial ) => ( m.keywords    ?? [] ) as string[];
const num      = ( p: Prop | undefined, d: number ) => ( p && "Float" in p ? p.Float : d );
const vec      = ( p: Prop | undefined, d: [number, number, number, number] ) => ( p && "Color" in p ? p.Color : p && "Vector" in p ? p.Vector : d );

export interface Overlay {
  // linear RGB
  color:     [number, number, number];
  // Unity space
  direction: [number, number, number];
  amount:    number;
  sharpness: number;
  intensity: number;
}

/**
 * The overlay a material shows in game, or null ( defaults are the shader's ).
**/
export function materialOverlay( m: CustomMaterial ): Overlay | null {
  if ( !keywords( m ).includes( "_OVERLAY" ) ) return null;
  const p = props( m );
  const c = vec( p._OverlayColor,     [1, 1, 1, 1] );
  const d = vec( p._OverlayDirection, [0, 1, 0, 0] );
  return {
    color:     [c[0], c[1], c[2]],
    direction: [d[0], d[1], d[2]],
    amount:    num( p._OverlayAmount, 0.4 ),
    sharpness: Math.max( 0.001, num( p._OverlaySharpness, 0.3 ) ),
    intensity: num( p._OverlayIntensity, 1 ),
  };
}

/**
 * The material with the overlay switched on or off ( the game reads the keyword; the float mirrors it ).
**/
export function withOverlay( m: CustomMaterial, on: boolean ): CustomMaterial {
  const kw = keywords( m ).filter( ( k ) => k !== "_OVERLAY" && k !== "_OVERLAY_FADE" );
  if ( on ) kw.push( "_OVERLAY" );
  return { ...m, keywords: kw, extra_props: { ...props( m ), _UseOverlay: { Float: on ? 1 : 0 } } };
}
