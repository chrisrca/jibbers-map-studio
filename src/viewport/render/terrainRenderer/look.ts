// The ground's look in its shader: the snow, rock, markings, powder and grip ( the game's terrain shader's numbers ),
// the terrain view's overlays, and the brush's ring drawn on it.

import { abs, atan, float, fwidth, max, min, positionWorld, sin, step, clamp as tclamp, smoothstep as tsmooth, uniform } from "three/tsl";
import * as THREE from "three/webgpu";

// The sculpt brush, drawn on the terrain itself ( so it hugs every bump ): a ring at the radius, a dashed ring where the
// falloff starts, and a faint fill showing how strongly each spot is affected — at the brush and at each of its
// symmetric copies ( up to 4 places ), round or square and turned. A second, orange ring shows the Clone brush's
// source. Positions are three.js XZ.
export const brushLook = {
  centers:   [0, 1, 2, 3].map( () => uniform( new THREE.Vector2() ) ),
  // how many of `centers` are in use
  count:     uniform( 1 ),
  radius:    uniform( 10 ),
  // fraction of the radius at full strength
  hard:      uniform( 0.4 ),
  // 1 round … 0 square
  roundness: uniform( 1 ),
  // tip rotation in three.js XZ, radians
  angle:     uniform( 0 ),
  visible:   uniform( 0 ),
  color:     uniform( new THREE.Color( 0.55, 0.86, 1.0 ) ),
  // shade masked ground
  showMask:  uniform( 1 ),
};

// Shared look settings, as the game's own terrain material has them ( Jibbers' "SnowTerrain", PisteSnowLegacy ):
// grey rock ( 0.698 ) over its boulder texture and white over its snow one ( both read from the game: noise and
// plain white without it ), markings tinted 30% towards their hue, fine corduroy ( tiling 60 ).
export const snowLook = {
  baseColor: uniform( new THREE.Color( 0.93, 0.94, 0.96 ) ),
  rockColor: uniform( new THREE.Color( 0.47, 0.46, 0.45 ) ),
  markingTint:    uniform( 0.3  ),
  pisteTiling:    uniform( 60   ),
  grooveStrength: uniform( 0.22 ),
  showSlope:      uniform( 0    ),
  slopeMin:       uniform( 10   ),
  slopeMax:       uniform( 45   ),
  slopeStep:      uniform( 0    ),
  slopeOpacity:   uniform( 0.85 ),
  hillshade:      uniform( 0    ),
  exaggeration:   uniform( 2    ),
  // radians: round from north ( Unity +Z ), up from the ground
  sunDir:    uniform( ( 315 * Math.PI ) / 180 ),
  sunHeight: uniform( ( 35  * Math.PI ) / 180 ),
  contours:       uniform( 0   ),
  contourOpacity: uniform( 0.5 ),
  // paint mode's view of the flow mask: 1 = colour the ground by corduroy direction
  showFlow:       uniform( 0   ),
  // paint mode, Grip: the grip shown ( on chunks without the 4-channel flag ), and the chunks it can't go on
  showGrip:       uniform( 0   ),
  gripColor:        uniform( new THREE.Color( 1,    0.55, 0.12 ) ),
  gripBlockedColor: uniform( new THREE.Color( 0.08, 0.08, 0.1  ) ),
  // 1 once the game's snow and rock textures are in ( TerrainRenderer.useGameSnow )
  gameSnow:       uniform( 0 ),
  // powder ( the mask's alpha ), as the game lays it: its colour, full at `thirdDepth` ( m ), its edge sharpened
  thirdColor:     uniform( new THREE.Color( 1, 1, 1 ) ),
  thirdDepth:     uniform( 0.1 ),
  thirdSharpness: uniform( 0.3 ),
};

/**
 * How much powder covers the snow at a mask alpha ( PisteSnowLegacy's third layer ): full at its depth, the edge
 * sharpened round the middle.
**/
export const powderOf = ( a: N ) =>
  tclamp( min( a.div( max( snowLook.thirdDepth, 0.01 ) ), 1 ).sub( 0.5 ).div( max( snowLook.thirdSharpness, 0.001 ) ).add( 0.5 ), 0, 1 );

// The game's snow and rock textures ( white till they're read )
export const gameTex = { snow: null as THREE.Texture | null, rock: null as THREE.Texture | null };

export const whiteTex = ( () => {
  const t       = new THREE.DataTexture( new Uint8Array( [255, 255, 255, 255] ), 1, 1 );
  t.needsUpdate = true;
  return t;
} )();

export const blackTex = ( () => {
  const t       = new THREE.DataTexture( new Uint8Array( [0, 0, 0, 255] ), 1, 1 );
  t.needsUpdate = true;
  return t;
} )();

// TSL node types are too strict for this kind of arithmetic; the shader graph is checked when it's built
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any;

/**
 * Ring/inner-ring/halo/fill ( 0..1 ) of one brush outline centred at `c`.
**/
const ringsAt = ( c: N, on: N ): { fill: N; ring: N; halo: N; inner: N } => {
  const rel: N    = positionWorld.xz.sub( c );
  const ca        = brushLook.angle.cos(), sa = brushLook.angle.sin();
  const lx        = rel.x.mul( ca ).add( rel.y.mul( sa ) ), lz = rel.y.mul( ca ).sub( rel.x.mul( sa ) );
  // superellipse: p = 2 is a circle, larger p squarer
  const p: N      = float( 2 ).add( float( 1 ).sub( brushLook.roundness ).mul( 10 ) );
  const d: N      = ( abs( lx ) as N ).pow( p ).add( ( abs( lz ) as N ).pow( p ) ).pow( float( 1 ).div( p ) ).max( 0 );
  const px        = max( fwidth( d ),      0.0001 ); // one screen pixel in metres here: rings stay ~2 px wide at any distance
  const r         = max( brushLook.radius, 0.001  );
  const t         = d.div( r );
  const fill      = float( 1 ).sub( tsmooth( brushLook.hard, 1, t ) ).mul( step( t, 1 ) ).mul( on );
  const toRing    = abs( d.sub( r ) );
  const ring      = float( 1 ).sub( tsmooth( px.mul( 0.6 ), px.mul( 1.6 ), toRing ) ).mul( on );
  const halo      = float( 1 ).sub( tsmooth( px.mul( 1.6 ), px.mul( 3.5 ), toRing ) ).mul( on );
  const dash      = step( 0,    sin( atan( rel.y, rel.x ).mul( 36 ) ) );
  const showInner = step( 0.03, brushLook.hard                        ).mul( step( brushLook.hard, 0.97 ) );
  const inner     = float( 1 ).sub( tsmooth( px.mul( 0.5 ), px.mul( 1.4 ), abs( d.sub( r.mul( brushLook.hard ) ) ) ) ).mul( dash ).mul( showInner ).mul( on );
  return { fill, ring, halo, inner };
};

/**
 * Brush ring/inner-ring/halo/fill amounts ( 0..1 ) at this fragment, over every copy of the brush; 0 when hidden.
**/
export const brushRings = (): { fill: N; ring: N; halo: N; inner: N } => {
  const parts = brushLook.centers.map( ( c, k ) => ringsAt( c, brushLook.visible.mul( step( k + 0.5, brushLook.count ) ) ) );
  const m     = ( f: ( x: ( typeof parts )[0] ) => N ): N => parts.slice( 1 ).reduce( ( a: N, x ) => max( a, f( x ) ), f( parts[0] ) );
  return { fill: m( ( x ) => x.fill ), ring: m( ( x ) => x.ring ), halo: m( ( x ) => x.halo ), inner: m( ( x ) => x.inner ) };
};
