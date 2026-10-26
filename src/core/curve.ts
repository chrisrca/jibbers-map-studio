// Editable 0..1 profile curves ( the studio's take on Unity's AnimationCurve, as Map-Tools' terrain inserts use ):
// keys with automatic smooth tangents, evaluated as a monotone cubic so profiles never overshoot their keys.

export interface CurveKey {
  t: number;
  v: number;
}
export type Curve = CurveKey[];

const clamp01 = ( x: number ) => Math.min( 1, Math.max( 0, x ) );

/**
 * Value at t ( 0..1 ); keys are kept sorted by t. Constant outside the first/last key.
**/
export function evalCurve( c: Curve, t: number ): number {
  if ( !c.length ) return 0;
  if ( t <= c[0].t ) return c[0].v;
  const last = c[c.length - 1];
  if ( t >= last.t ) return last.v;
  let i = 0;
  while ( i < c.length - 2 && t > c[i + 1].t ) i++;
  const a = c[i], b = c[i + 1];
  const h = b.t - a.t;
  if ( h <= 1e-9 ) return b.v;
  const s  = ( t - a.t ) / h;
  const ma = slope( c, i ) * h, mb = slope( c, i + 1 ) * h;
  const s2 = s * s, s3 = s2 * s;
  return ( 2 * s3 - 3 * s2 + 1 ) * a.v + ( s3 - 2 * s2 + s ) * ma + ( -2 * s3 + 3 * s2 ) * b.v + ( s3 - s2 ) * mb;
}

/**
 * Fritsch–Carlson tangent at key i ( flat at local extremes, so there's no overshoot ).
**/
function slope( c: Curve, i: number ): number {
  const d = ( k: number ) => ( c[k + 1].v - c[k].v ) / Math.max( 1e-9, c[k + 1].t - c[k].t );
  if ( c.length < 2 ) return 0;
  if ( i === 0 ) return d( 0 );
  if ( i === c.length - 1 ) return d( i - 1 );
  const d0 = d( i - 1 ), d1 = d( i );
  if ( d0 * d1 <= 0 ) return 0;
  return ( 2 * d0 * d1 ) / ( d0 + d1 ); // harmonic mean keeps it monotone
}

/**
 * `repeats` copies of the curve along 0..1, each `scale`× the length of the one before ( Map-Tools'
 * EvaluateRepeatedScaling ), with an optional smooth hand-over of `fade` ( fraction of each section ) between them.
**/
export function evalRepeated( c: Curve, t: number, repeats: number, scale: number, fade = 0 ): number {
  repeats = Math.max( 1, Math.round( repeats ) );
  if ( repeats === 1 ) return evalCurve( c, t );
  const sizes: number[] = [];
  let cur               = 1, total = 0;
  for ( let i = 0; i < repeats; i++ ) { sizes.push( cur ); total += cur; cur *= scale; }
  const bounds = [0];
  for ( const s of sizes ) bounds.push( bounds[bounds.length - 1] + s / total );
  const inSection = ( x: number ) => {
    let k = repeats - 1;
    for ( let i = 0; i < repeats; i++ ) if ( x < bounds[i + 1] ) { k = i; break; }
    return evalCurve( c, clamp01( ( x - bounds[k] ) / ( bounds[k + 1] - bounds[k] ) ) );
  };
  if ( fade > 0 )
    for ( let b = 1; b < repeats; b++ ) {
      const lo = bounds[b] - ( bounds[b] - bounds[b - 1] ) * fade, hi = bounds[b] + ( bounds[b + 1] - bounds[b] ) * fade;
      if ( t > lo && t < hi ) {
        const u  = ( t - lo ) / ( hi - lo );
        const sm = u * u * ( 3 - 2 * u );
        return inSection( lo ) + ( inSection( hi ) - inSection( lo ) ) * sm;
      }
    }
  return inSection( t );
}

export const curve = ( ...pts: [number, number][] ): Curve => pts.map( ( [t, v] ) => ( { t, v } ) );

// Height profiles along a curve shape: 0 at the start height, 1 at the end height ( Map-Tools stores 1 − this ).
// The jump presets assume the end is the high point.
export const PROFILES: Record<string, { label: string; tip: string; curve: Curve }> = {
  ramp:     { label: "Ramp",      tip: "Straight from the start height to the end height",      curve: curve( [0, 0  ], [1,    1   ] ) },
  kicker:   { label: "Kicker",    tip: "Curved transition that steepens towards the lip (end)", curve: curve( [0, 0  ], [0.45, 0.18], [0.8, 0.55], [1, 1] ) },
  table:    { label: "Table",     tip: "Up the kicker, flat deck, down the landing",            curve: curve( [0, 0  ], [0.22, 0.75], [0.3, 1], [0.7, 1], [0.85, 0.45], [1, 0] ) },
  roller:   { label: "Roller",    tip: "Smooth bump up and back down",                          curve: curve( [0, 0  ], [0.5,  1   ], [1, 0] ) },
  stepdown: { label: "Step-down", tip: "Kicker, then a drop to a lower landing",                curve: curve( [0, 0.4], [0.3,  0.75], [0.36, 1], [0.45, 0.3], [0.7, 0.05], [1, 0] ) },
  landing:  { label: "Landing",   tip: "Knuckle at the start, steep then flattening out",       curve: curve( [0, 1  ], [0.15, 0.95], [0.6, 0.25], [1, 0] ) },
};

// Cross-sections ( 0 = no change, 1 = full depth up ).
export const CROSS_SECTIONS: Record<string, { label: string; curve: Curve }> = {
  flat:   { label: "Flat",      curve: curve( [0, 0], [1,    0   ] ) },
  pipe:   { label: "Half-pipe", curve: curve( [0, 1], [0.25, 0.15], [0.5, 0], [0.75, 0.15], [1, 1] ) },
  crown:  { label: "Crowned",   curve: curve( [0, 0], [0.5,  1   ], [1, 0] ) },
  gutter: { label: "Gutter",    curve: curve( [0, 0], [0.5,  -1  ], [1, 0] ) },
};

// Circle radial profiles: t = 0 centre … 1 edge; value × depth is added.
export const RADIALS: Record<string, { label: string; curve: Curve }> = {
  mound:   { label: "Mound",   curve: curve( [0, 1 ], [0.5, 0.55 ], [1, 0] ) },
  bowl:    { label: "Bowl",    curve: curve( [0, -1], [0.6, -0.55], [1, 0] ) },
  plateau: { label: "Plateau", curve: curve( [0, 1 ], [0.6, 1    ], [1, 0] ) },
  cone:    { label: "Cone",    curve: curve( [0, 1 ], [1,   0    ] ) },
};
