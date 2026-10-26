// Minimal RGBA PNG encoder. Unlike a canvas, it keeps every channel exactly as given ( a canvas premultiplies alpha,
// which would wipe the colour wherever a snow mask's powder channel is 0 ).

const CRC = ( () => {
  const t = new Uint32Array( 256 );
  for ( let n = 0; n < 256; n++ ) {
    let c = n;
    for ( let k = 0; k < 8; k++ ) c = c & 1 ? 0xedb88320 ^ ( c >>> 1 ) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
} )();

function crc32( bytes: Uint8Array ) {
  let c = 0xffffffff;
  for ( let i = 0; i < bytes.length; i++ ) c = CRC[( c ^ bytes[i] ) & 0xff] ^ ( c >>> 8 );
  return ( c ^ 0xffffffff ) >>> 0;
}

function chunk( type: string, data: Uint8Array ) {
  const out = new Uint8Array( 12 + data.length );
  const v   = new DataView( out.buffer );
  v.setUint32( 0, data.length );
  for ( let i = 0; i < 4; i++ ) out[4 + i] = type.charCodeAt( i );
  out.set( data, 8 );
  v.setUint32( 8 + data.length, crc32( out.subarray( 4, 8 + data.length ) ) );
  return out;
}

/**
 * `rgba`: width*height*4 bytes, rows top to bottom.
**/
export async function encodePng( width: number, height: number, rgba: Uint8Array ): Promise<Uint8Array> {
  const ihdr = new Uint8Array( 13 );
  const v    = new DataView( ihdr.buffer );
  v.setUint32( 0, width  );
  v.setUint32( 4, height );
  ihdr.set( [8, 6, 0, 0, 0], 8 ); // 8-bit RGBA, no interlace
  // each row: filter type 0, then the row
  const raw = new Uint8Array( height * ( width * 4 + 1 ) );
  for ( let y = 0; y < height; y++ ) raw.set( rgba.subarray( y * width * 4, ( y + 1 ) * width * 4 ), y * ( width * 4 + 1 ) + 1 );
  const z     = new Uint8Array( await new Response( new Blob( [raw] ).stream().pipeThrough( new CompressionStream( "deflate" ) ) ).arrayBuffer() );
  const parts = [new Uint8Array( [137, 80, 78, 71, 13, 10, 26, 10] ), chunk( "IHDR", ihdr ), chunk( "IDAT", z ), chunk( "IEND", new Uint8Array( 0 ) )];
  const out   = new Uint8Array( parts.reduce( ( s, p ) => s + p.length, 0 ) );
  let o       = 0;
  for ( const p of parts ) {
    out.set( p, o );
    o += p.length;
  }
  return out;
}
