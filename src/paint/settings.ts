// Ground paint settings ( kept apart from paint.ts so the store can use them without importing the painting code ).

import type { FalloffPreset } from "../sculpt/brushes";
import { mergeBrush, type PaintBrush } from "./engine/brush";
import type { BlendMode } from "./engine/stroke";

// What the ground brush paints into the game's snow mask: snow or rock, markings ( the game's hues ), powder depth,
// grip ( powder depth on a chunk that shows none ), corduroy direction.
export type PaintTool = "snow" | "marking" | "powder" | "grip" | "flow";

// The game's marking colours ( Better Terrain Editor's palette ): hue values the shader snaps to 1/20 steps.
export const MARKING_COLOURS: { name: string; hue: number }[] = [
  { name: "Red",          hue: 0.05 }, { name: "Orange", hue: 0.1 }, { name: "Gold",        hue: 0.15 }, { name: "Yellow",  hue: 0.2 },
  { name: "Yellow-green", hue: 0.25 }, { name: "Lime",   hue: 0.3 }, { name: "Light green", hue: 0.35 }, { name: "Green",   hue: 0.4 },
  { name: "Teal",         hue: 0.45 }, { name: "Cyan",   hue: 0.5 }, { name: "Light blue",  hue: 0.55 }, { name: "Blue",    hue: 0.6 },
  { name: "Dark blue",    hue: 0.65 }, { name: "Purple", hue: 0.7 }, { name: "Pink",        hue: 0.75 }, { name: "Magenta", hue: 0.8 },
];

export interface PaintSettings {
  tool:      PaintTool;
  radius:    number;
  // the snow tools' strength; the colour brushes' opacity
  strength:  number;
  falloff:   FalloffPreset;
  hardness:  number;
  invert:    boolean;
  // index into MARKING_COLOURS: the markings brush's hue
  colour:    number;
  // Texture Paint's colour and its second colour ( X swaps them ), sRGB 0..1
  rgb:       [number, number, number];
  rgb2:      [number, number, number];
  blend:     BlendMode;
  // the colour brushes' tip, dynamics, texture and feel ( paint/engine/brush.ts )
  brush:     PaintBrush;
  // the preset the brush started from
  preset:    string;
  // colours used lately, newest first ( hex )
  recent:    string[];
  // powder ( and grip ) depth to paint, 0..1 ( × the game's powder height, 1 m )
  powder:    number;
  // Texture Paint on a piece: which of its maps, the value painted on a grey one, and the tool
  channel:   "colour" | "metallic" | "roughness" | "height";
  value:     number;
  texTool:   "brush" | "fill" | "gradient" | "decal";
  // Gradient ( Blender's ): along the line dragged, or out from where it starts; from the colour into what's there
  // ( fade ), or into the second colour
  gradient:  { shape: "linear" | "radial"; to: "fade" | "second" };
  // Fill: how different a colour can be and still be filled ( 0..1 )
  tolerance: number;
}

export const DEFAULT_PAINT: PaintSettings = {
  tool:      "snow",
  radius:    6,
  strength:  0.6,
  falloff:   "smooth",
  hardness:  0.5,
  invert:    false,
  colour:    11,
  rgb:       [0.85, 0.1, 0.1],
  rgb2:      [1, 1, 1],
  blend:     "mix",
  brush:     mergeBrush( undefined ),
  preset:    "Hard Round",
  recent:    [],
  powder:    0.6,
  channel:   "colour",
  value:     1,
  texTool:   "brush",
  gradient:  { shape: "linear", to: "fade" },
  tolerance: 0.15,
};

/**
 * How far along the gradient a point `t` is ( 0 at the line's start, 1 at its end, held either side ), eased in and
 * out: a straight ramp shows a line where it starts and ends.
**/
export function gradientAt( t: number ) {
  const u = Math.min( 1, Math.max( 0, t ) );
  return u * u * ( 3 - 2 * u );
}

/**
 * One texel ( RGBA at `o` in `px` ) under the gradient at `t`: the colour fading into what's there, or the colours
 * in turn, laid at `strength` × `w` ( how squarely its face looks at the view ).
**/
export function gradientTexel( px: Uint8Array, o: number, t: number, c0: readonly number[], c1: readonly number[], to: "fade" | "second", strength: number, w = 1 ) {
  const g = gradientAt( t ), a = ( to === "fade" ? 1 - g : 1 ) * strength * w;
  if ( a <= 0 ) return;
  for ( let c = 0; c < 3; c++ ) {
    const want = ( to === "fade" ? c0[c] : c0[c] + ( c1[c] - c0[c] ) * g ) * 255;
    px[o + c]  = Math.round( px[o + c] + ( want - px[o + c] ) * a );
  }
  px[o + 3] = 255;
}

/**
 * Settings remembered from an older version, brought up to this one.
**/
export function mergePaint( saved: Partial<PaintSettings> & { tool?: string; blend?: string } ): PaintSettings {
  const p = { ...DEFAULT_PAINT, ...saved, brush: mergeBrush( saved.brush ) } as PaintSettings;
  if ( ["colour", "soften", "smear", "clone"].includes( saved.tool as string ) ) p.tool = "marking";
  return p;
}
