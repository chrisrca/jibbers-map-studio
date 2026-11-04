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

/**
 * An 8-bit RGBA PNG's pixels ( rows top to bottom, every channel as stored: no premultiplying ), or null for any
 * other kind ( palette, grey, 16-bit, interlaced: left to the studio's back end ).
**/
export async function decodePng( png: Uint8Array ): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  const v    = new DataView( png.buffer, png.byteOffset, png.byteLength );
  const idat: Uint8Array[] = [];
  let width  = 0, height = 0, kind = -1;
  for ( let p = 8; p + 8 <= png.length; ) {
    const len = v.getUint32( p ), type = String.fromCharCode( png[p + 4], png[p + 5], png[p + 6], png[p + 7] );
    if ( type === "IHDR" ) {
      width  = v.getUint32( p + 8 );
      height = v.getUint32( p + 12 );
      // ( depth 8, colour type 6, no interlace )
      kind   = png[p + 16] === 8 && png[p + 17] === 6 && png[p + 20] === 0 ? 6 : -1;
    } else if ( type === "IDAT" ) idat.push( png.subarray( p + 8, p + 8 + len ) );
    else if ( type === "IEND" ) break;
    p += 12 + len;
  }
  if ( kind !== 6 || !width || !height || !idat.length ) return null;
  const raw    = new Uint8Array( await new Response( new Blob( idat as BlobPart[] ).stream().pipeThrough( new DecompressionStream( "deflate" ) ) ).arrayBuffer() );
  const stride = width * 4, out = new Uint8Array( stride * height );
  if ( raw.length < ( stride + 1 ) * height ) return null;
  for ( let y = 0; y < height; y++ ) {
    const f = raw[y * ( stride + 1 )], s = y * ( stride + 1 ) + 1, d = y * stride, u = d - stride;
    switch ( f ) {
      case 0:
        out.set( raw.subarray( s, s + stride ), d );
        break;
      case 1:
        for ( let i = 0; i < stride; i++ ) out[d + i] = raw[s + i] + ( i >= 4 ? out[d + i - 4] : 0 );
        break;
      case 2:
        for ( let i = 0; i < stride; i++ ) out[d + i] = raw[s + i] + ( y ? out[u + i] : 0 );
        break;
      case 3:
        for ( let i = 0; i < stride; i++ ) out[d + i] = raw[s + i] + ( ( ( i >= 4 ? out[d + i - 4] : 0 ) + ( y ? out[u + i] : 0 ) ) >> 1 );
        break;
      case 4:
        for ( let i = 0; i < stride; i++ ) {
          const a  = i >= 4 ? out[d + i - 4] : 0, b = y ? out[u + i] : 0, c = i >= 4 && y ? out[u + i - 4] : 0;
          const pp = a + b - c, pa = Math.abs( pp - a ), pb = Math.abs( pp - b ), pc = Math.abs( pp - c );
          out[d + i] = raw[s + i] + ( pa <= pb && pa <= pc ? a : pb <= pc ? b : c );
        }
        break;
      default:
        return null;
    }
  }
  return { width, height, data: out };
}
