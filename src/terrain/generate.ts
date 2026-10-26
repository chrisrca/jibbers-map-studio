// New-map layouts ( src-tauri makes their ground ), the noise the brushes use, and a map's size once exported.

export interface LayoutPreset {
  id:          string;
  label:       string;
  description: string;
  // chunk grid radius: 0 = single chunk, 1 = 3x3, 2 = 5x5 ...
  radius:      number;
  // resolution by ring distance from the centre chunk
  ringRes:     number[];
  chunkSize:   number;
}

// Metres between height samples on every map: the detail of the game's own parks.
export const GROUND_SPACING = 0.25;

/**
 * Heightmap resolution of a chunk `size` metres across at that detail ( at most 4097 samples a side ).
**/
export function groundRes( size: number ) {
  let r = 257;
  while ( size / ( r - 1 ) > GROUND_SPACING + 1e-9 && r < 4097 ) r = 2 * r - 1;
  return r;
}

export const LAYOUTS: LayoutPreset[] = [
  { id: "park",     label: "Park — 1 km",     description: "One 1 km chunk at 0.24 m (like MLNZ Park).", radius: 0, ringRes: [groundRes( 1000 )], chunkSize: 1000 },
  { id: "resort",   label: "Resort — 3 km",   description: "3×3 km at 0.24 m.",                          radius: 1, ringRes: [groundRes( 1000 )], chunkSize: 1000 },
  { id: "mountain", label: "Mountain — 5 km", description: "5×5 km at 0.24 m.",                          radius: 2, ringRes: [groundRes( 1000 )], chunkSize: 1000 },
  { id: "range",    label: "Range — 7 km",    description: "7×7 km at 0.24 m.",                          radius: 3, ringRes: [groundRes( 1000 )], chunkSize: 1000 },
];

export type BaseTerrain = "slope" | "hills" | "mountain" | "flat";

export interface NewMapOptions {
  layout:      LayoutPreset;
  base:        BaseTerrain;
  // run steepness in degrees for slope/mountain bases
  slopeDeg:    number;
  // vertical range of every chunk
  heightRange: number;
  seed:        number;
}

// ---------------------------------------------------------------- noise

function hash( ix: number, iz: number, seed: number ) {
  let h = Math.imul( ix, 0x8da6b343 ) ^ Math.imul( iz, 0xd8163841 ) ^ Math.imul( seed, 0x9e3779b9 );
  h     = Math.imul( h ^ ( h >>> 13 ), 0x85ebca6b );
  h    ^= h >>> 16;
  return ( h & 0xffff ) / 65535;
}

export function valueNoise( x: number, z: number, seed = 0 ) {
  const x0 = Math.floor( x ), z0 = Math.floor( z );
  const fx = x - x0, fz = z - z0;
  const sx = fx * fx * ( 3 - 2 * fx ), sz = fz * fz * ( 3 - 2 * fz );
  const a  = hash( x0, z0, seed ), b = hash( x0 + 1, z0, seed ), c = hash( x0, z0 + 1, seed ), d = hash( x0 + 1, z0 + 1, seed );
  return ( ( a + ( b - a ) * sx ) * ( 1 - sz ) + ( c + ( d - c ) * sx ) * sz ) * 2 - 1;
}

export function fbm( x: number, z: number, octaves: number, seed = 0, lacunarity = 2, gain = 0.5 ) {
  let sum = 0, amp = 1, norm = 0;
  for ( let o = 0; o < octaves; o++ ) {
    sum  += amp * valueNoise( x, z, seed + o * 17 );
    norm += amp;
    amp  *= gain;
    x    *= lacunarity;
    z    *= lacunarity;
  }
  return sum / norm;
}

export function ridged( x: number, z: number, octaves: number, seed = 0 ) {
  let sum = 0, amp = 1, norm = 0, prev = 1;
  for ( let o = 0; o < octaves; o++ ) {
    const n = 1 - Math.abs( valueNoise( x, z, seed + o * 31 ) );
    sum    += n * n * amp * prev;
    prev    = n * n;
    norm   += amp;
    amp    *= 0.5;
    x      *= 2;
    z      *= 2;
  }
  return sum / norm;
}

/**
 * Rough exported size in bytes ( gzip ~60% on terrain data, base64 x4/3 ).
**/
export function estimateExportBytes( chunks: { res: number }[] ) {
  return chunks.reduce( ( s, c ) => s + c.res * c.res * 2 * 0.62 * ( 4 / 3 ), 0 );
}
