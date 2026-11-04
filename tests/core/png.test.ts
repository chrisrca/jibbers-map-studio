import { describe, expect, it } from "vitest";
import { decodePng, encodePng } from "../../src/core/png";

// a 37 × 23 mask with every channel busy, alpha 0 under colour too ( a canvas would lose it )
function pixels( w = 37, h = 23 ) {
  const px = new Uint8Array( w * h * 4 );
  for ( let k = 0; k < px.length; k++ ) px[k] = ( k * 37 + ( k >> 7 ) * 11 ) & 255;
  for ( let k = 3; k < px.length; k += 64 ) px[k] = 0;
  return { w, h, px };
}

// a PNG whose rows are filtered as `filter( y )` says ( 0..4: none, sub, up, average, Paeth ), as other tools write them
async function filtered( w: number, h: number, px: Uint8Array, filter: ( y: number ) => number ) {
  const stride = w * 4, raw = new Uint8Array( ( stride + 1 ) * h );
  for ( let y = 0; y < h; y++ ) {
    const f = filter( y ), d = y * ( stride + 1 );
    raw[d]  = f;
    for ( let i = 0; i < stride; i++ ) {
      const x = px[y * stride + i], a = i >= 4 ? px[y * stride + i - 4] : 0, b = y ? px[( y - 1 ) * stride + i] : 0, c = i >= 4 && y ? px[( y - 1 ) * stride + i - 4] : 0;
      const p = a + b - c, pa = Math.abs( p - a ), pb = Math.abs( p - b ), pc = Math.abs( p - c );
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? ( a + b ) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      raw[d + 1 + i] = ( x - pred ) & 255;
    }
  }
  const z    = new Uint8Array( await new Response( new Blob( [raw] ).stream().pipeThrough( new CompressionStream( "deflate" ) ) ).arrayBuffer() );
  const ihdr = new Uint8Array( 13 ), v = new DataView( ihdr.buffer );
  v.setUint32( 0, w );
  v.setUint32( 4, h );
  ihdr.set( [8, 6, 0, 0, 0], 8 );
  const chunk = ( type: string, data: Uint8Array ) => {
    const out = new Uint8Array( 12 + data.length ), dv = new DataView( out.buffer );
    dv.setUint32( 0, data.length );
    for ( let i = 0; i < 4; i++ ) out[4 + i] = type.charCodeAt( i );
    out.set( data, 8 );
    return out;
  };
  // ( the image data split over two IDAT chunks, as big files are )
  const half  = Math.floor( z.length / 2 );
  const parts = [new Uint8Array( [137, 80, 78, 71, 13, 10, 26, 10] ), chunk( "IHDR", ihdr ), chunk( "IDAT", z.subarray( 0, half ) ), chunk( "IDAT", z.subarray( half ) ), chunk( "IEND", new Uint8Array( 0 ) )];
  const out   = new Uint8Array( parts.reduce( ( s, p ) => s + p.length, 0 ) );
  let o       = 0;
  for ( const p of parts ) {
    out.set( p, o );
    o += p.length;
  }
  return out;
}

describe( "reading a mask's PNG", () => {
  it( "gives back what the studio wrote, every channel exactly", async () => {
    const { w, h, px } = pixels();
    const img          = await decodePng( await encodePng( w, h, px ) );
    expect( img ).not.toBeNull();
    expect( [img!.width, img!.height] ).toEqual( [w, h] );
    expect( img!.data ).toEqual( px );
  } );

  it( "undoes each of the row filters other tools use", async () => {
    const { w, h, px } = pixels();
    for ( const f of [( y: number ) => y % 5, () => 1, () => 2, () => 3, () => 4] ) expect( ( await decodePng( await filtered( w, h, px, f ) ) )!.data ).toEqual( px );
  } );

  it( "leaves other kinds ( not 8-bit RGBA ) to the back end", async () => {
    const png = await encodePng( 2, 2, new Uint8Array( 16 ) );
    png[8 + 8 + 9] = 2;
    expect( await decodePng( png ) ).toBeNull();
  } );
} );
