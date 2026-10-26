// Colour maths: hex, RGB and HSV ( sRGB 0..1 ), for the colour pickers.

const clamp01 = ( v: number ) => ( v < 0 ? 0 : v > 1 ? 1 : v );
export function hexOf( [r, g, b]: [number, number, number] ) {
  return `#${[r, g, b].map( ( v ) => Math.round( clamp01( v ) * 255 ).toString( 16 ).padStart( 2, "0" ) ).join( "" )}`;
}
export function rgbOfHex( hex: string ): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec( hex.trim() );
  if ( !m ) return null;
  const h = m[1].length === 3 ? m[1].replace( /./g, ( c ) => c + c ) : m[1];
  return [0, 2, 4].map( ( k ) => parseInt( h.slice( k, k + 2 ), 16 ) / 255 ) as [number, number, number];
}
export function hsvOf( [r, g, b]: [number, number, number] ): [number, number, number] {
  const max = Math.max( r, g, b ), min = Math.min( r, g, b ), d = max - min;
  let h     = 0;
  if ( d > 0 ) h = max === r ? ( ( g - b ) / d + 6 ) % 6 : max === g ? ( b - r ) / d + 2 : ( r - g ) / d + 4;
  return [h / 6, max > 0 ? d / max : 0, max];
}
export function rgbOfHsv( h: number, s: number, v: number ): [number, number, number] {
  const f = ( n: number ) => {
    const k = ( n + h * 6 ) % 6;
    return v - v * s * Math.max( 0, Math.min( k, 4 - k, 1 ) );
  };
  return [f( 5 ), f( 3 ), f( 1 )];
}
