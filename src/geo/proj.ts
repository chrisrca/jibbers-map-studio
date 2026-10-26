// Map projections for importing real terrain, without a GIS library.
//
// A real area is laid out flat in metres with a transverse Mercator projection centred on it ( as the US State
// Plane systems do for a state, here for just the area ): over a few kilometres the distortion is a few millimetres.
// Studio/Unity axes: +X = east, +Z = north, 1 unit = 1 m.

export interface LonLat {
  lon: number;
  lat: number;
}

const A   = 6378137.0; // WGS84
const F   = 1 / 298.257223563;
const E2  = F * ( 2 - F );
const EP2 = E2 / ( 1 - E2 );
const RAD = Math.PI / 180;

function meridianArc( phi: number ) {
  return (
    A *
    ( ( 1 - E2 / 4 - ( 3 * E2 ** 2 ) / 64 - ( 5 * E2 ** 3 ) / 256 ) * phi -
      ( ( 3  * E2 ) / 8 + ( 3 * E2 ** 2 ) / 32 + ( 45 * E2 ** 3 ) / 1024 ) * Math.sin( 2 * phi ) +
      ( ( 15 * E2 ** 2 ) / 256 + ( 45 * E2 ** 3 ) / 1024 ) * Math.sin( 4 * phi ) -
      ( ( 35 * E2 ** 3 ) / 3072 ) * Math.sin( 6 * phi ) )
  );
}

// Transverse Mercator ( Snyder ) centred on `origin`, scale 1: lon/lat <-> metres east/north of the origin.
export class LocalProjection {
  private readonly lam0: number;
  private readonly m0:   number;
  constructor( readonly origin: LonLat ) {
    this.lam0 = origin.lon * RAD;
    this.m0   = meridianArc( origin.lat * RAD );
  }

  /**
   * lon/lat -> [east, north] metres
  **/
  forward( p: LonLat ): [number, number] {
    const phi = p.lat * RAD, lam = p.lon * RAD;
    const s   = Math.sin( phi ), c = Math.cos( phi );
    const n   = A / Math.sqrt( 1 - E2 * s * s );
    const t   = Math.tan( phi ) ** 2;
    const cc  = EP2 * c * c;
    const a   = ( lam - this.lam0 ) * c;
    const x   = n * ( a + ( ( 1 - t + cc ) * a ** 3 ) / 6 + ( ( 5 - 18 * t + t * t + 72 * cc - 58 * EP2 ) * a ** 5 ) / 120 );
    const y =
      meridianArc( phi ) -
      this.m0 +
      n * Math.tan( phi ) * ( a ** 2 / 2 + ( ( 5 - t + 9 * cc + 4 * cc * cc ) * a ** 4 ) / 24 + ( ( 61 - 58 * t + t * t + 600 * cc - 330 * EP2 ) * a ** 6 ) / 720 );
    return [x, y];
  }

  /**
   * [east, north] metres -> lon/lat
  **/
  inverse( x: number, y: number ): LonLat {
    const m  = this.m0 + y;
    const mu = m / ( A * ( 1 - E2 / 4 - ( 3 * E2 ** 2 ) / 64 - ( 5 * E2 ** 3 ) / 256 ) );
    const e1 = ( 1 - Math.sqrt( 1 - E2 ) ) / ( 1 + Math.sqrt( 1 - E2 ) );
    const phi1 =
      mu +
      ( ( 3    * e1 ) / 2 - ( 27 * e1 ** 3 ) / 32 ) * Math.sin( 2 * mu ) +
      ( ( 21   * e1 ** 2 ) / 16 - ( 55 * e1 ** 4 ) / 32 ) * Math.sin( 4 * mu ) +
      ( ( 151  * e1 ** 3 ) / 96 ) * Math.sin( 6 * mu ) +
      ( ( 1097 * e1 ** 4 ) / 512 ) * Math.sin( 8 * mu );
    const s  = Math.sin( phi1 ), c = Math.cos( phi1 );
    const c1 = EP2 * c * c, t1 = Math.tan( phi1 ) ** 2;
    const n1 = A / Math.sqrt( 1 - E2 * s * s );
    const r1 = ( A * ( 1 - E2 ) ) / ( 1 - E2 * s * s ) ** 1.5;
    const d  = x / n1;
    const lat =
      phi1 -
      ( ( n1 * Math.tan( phi1 ) ) / r1 ) *
        ( d ** 2 / 2 - ( ( 5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2 ) * d ** 4 ) / 24 + ( ( 61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1 ) * d ** 6 ) / 720 );
    const lon = this.lam0 + ( d - ( ( 1 + 2 * t1 + c1 ) * d ** 3 ) / 6 + ( ( 5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1 ) * d ** 5 ) / 120 ) / c;
    return { lon: lon / RAD, lat: lat / RAD };
  }
}

// Web Mercator ( EPSG:3857 ) metres, as map tiles and many elevation services use.
export const mercator = {
  forward: ( p: LonLat ): [number, number] => [A * p.lon * RAD, A * Math.log( Math.tan( Math.PI / 4 + ( p.lat * RAD ) / 2 ) )],
  inverse: ( x: number, y: number ): LonLat => ( { lon: x / A / RAD, lat: ( 2 * Math.atan( Math.exp( y / A ) ) - Math.PI / 2 ) / RAD } ),
};

/**
 * A polygon ( rings of [lon, lat] ) ready for many point tests: its edges sorted into bands of latitude, so a point only
 * tries the edges at its own latitude ( the even-odd rule ). Elevation footprints run to hundreds of thousands of
 * corners; testing every point against all of them froze the page for seconds.
**/
export function indexPolygon( rings: number[][][] ) {
  let count = 0;
  for ( const ring of rings ) count += ring.length;
  const x1 = new Float64Array( count ), y1 = new Float64Array( count ), x2 = new Float64Array( count ), y2 = new Float64Array( count );
  let w    = Infinity, s = Infinity, e = -Infinity, n = -Infinity, k = 0;
  for ( const ring of rings )
    for ( let i = 0, j = ring.length - 1; i < ring.length; j = i++ ) {
      x1[k] = ring[i][0];
      y1[k] = ring[i][1];
      x2[k] = ring[j][0];
      y2[k] = ring[j][1];
      w     = Math.min( w, x1[k] );
      e     = Math.max( e, x1[k] );
      s     = Math.min( s, y1[k] );
      n     = Math.max( n, y1[k] );
      k++;
    }
  const bands = Math.max( 1, Math.min( 8192, Math.ceil( count / 8 ) ) );
  const band  = ( y: number ) => Math.min( bands - 1, Math.max( 0, Math.floor( ( ( y - s ) / ( n - s || 1 ) ) * bands ) ) );
  // each edge in every band it crosses ( counted first, then filled: one flat list )
  const start = new Int32Array( bands + 1 );
  for ( let i = 0; i < count; i++ ) for ( let b = band( Math.min( y1[i], y2[i] ) ), b1 = band( Math.max( y1[i], y2[i] ) ); b <= b1; b++ ) start[b + 1]++;
  for ( let b = 0; b < bands; b++ ) start[b + 1] += start[b];
  const edges = new Int32Array( start[bands] ), fill = start.slice( 0, bands );
  for ( let i = 0; i < count; i++ ) for ( let b = band( Math.min( y1[i], y2[i] ) ), b1 = band( Math.max( y1[i], y2[i] ) ); b <= b1; b++ ) edges[fill[b]++] = i;
  return {
    w, s, e, n,
    contains( lon: number, lat: number ) {
      if ( lon < w || lon > e || lat < s || lat > n ) return false;
      const b    = band( lat );
      let inside = false;
      for ( let q = start[b]; q < start[b + 1]; q++ ) {
        const i = edges[q];
        if ( y1[i] > lat !== y2[i] > lat && lon < ( ( x2[i] - x1[i] ) * ( lat - y1[i] ) ) / ( y2[i] - y1[i] ) + x1[i] ) inside = !inside;
      }
      return inside;
    },
  };
}
