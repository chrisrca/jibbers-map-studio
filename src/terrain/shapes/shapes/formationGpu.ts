// A formation worked out on the graphics card: Map-Tools' FormationEdit.compute in WGSL, kernel for kernel, run as
// FormationBuilder.RunFormation runs it ( formation.ts has the same here, for when there's no card ).

import type { SimInput, SimOutput } from "./formation";

// ( GPUBufferUsage, GPUShaderStage, GPUMapMode: not declared here )
const MAP_READ = 1, COPY_SRC = 4, COPY_DST = 8, UNIFORM = 64, STORAGE = 128, COMPUTE = 4;

// The settings as the shader has them, in this order ( its uniform struct is made from this ).
const FIELDS: [string, "f32" | "u32" | "i32"][] = [
  ["w", "u32"], ["h", "u32"], ["polyCount", "u32"], ["domeRes", "u32"],
  ["x0", "f32"], ["z0", "f32"], ["sp", "f32"], ["sizeY", "f32"],
  ["posY", "f32"], ["edgeFalloff", "f32"], ["domeReach", "f32"], ["peakHeight", "f32"],
  ["blendMode", "u32"], ["baseHeight", "f32"], ["baseLevel", "f32"], ["noiseType", "u32"],
  ["noiseHeight", "f32"], ["noiseScale", "f32"], ["octaves", "i32"], ["lacunarity", "f32"],
  ["gain", "f32"], ["warp", "f32"], ["seed", "u32"], ["onPeak", "f32"],
  ["mirrorX", "f32"], ["mirrorZ", "f32"], ["mirrorOn", "u32"], ["lifetime", "i32"],
  ["inertia", "f32"], ["capacity", "f32"], ["deposit", "f32"], ["erode", "f32"],
  ["evaporate", "f32"], ["radius", "i32"], ["dropletSeed", "u32"], ["maxErodeStep", "f32"],
  ["lineLow", "f32"], ["lineHigh", "f32"], ["slopeStart", "f32"], ["slopeFull", "f32"],
  ["crevice", "f32"], ["stencil", "i32"], ["amount", "f32"], ["addsHeight", "f32"],
  ["rock", "f32"], ["noiseOX", "f32"], ["noiseOZ", "f32"], ["pad2", "f32"],
];

const SHADER = /* wgsl */ `
struct Params { ${FIELDS.map( ( [n, t] ) => `${n}: ${t}` ).join( ", " )} }
struct Pass { a: f32, b: f32, count: u32, offset: u32 }

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> Q: Pass;
@group(0) @binding(2) var<storage, read> inA: array<f32>;
@group(0) @binding(3) var<storage, read> inB: array<f32>;
@group(0) @binding(4) var<storage, read_write> outA: array<f32>;
@group(0) @binding(5) var<storage, read_write> base: array<f32>;
@group(0) @binding(6) var<storage, read_write> mask: array<f32>;
@group(0) @binding(7) var<storage, read_write> hint: array<atomic<i32>>;
// ( the profile's samples, then the outline's points: one buffer, the card allows eight )
@group(0) @binding(8) var<storage, read> shape: array<f32>;
@group(0) @binding(9) var<storage, read_write> outB: array<f32>;

const HEIGHT_SCALE: f32 = 1048576.0;

fn cx( v: i32 ) -> i32 { return clamp( v, 0, i32( P.w ) - 1 ); }
fn cy( v: i32 ) -> i32 { return clamp( v, 0, i32( P.h ) - 1 ); }
fn at( x: i32, y: i32 ) -> u32 { return u32( y ) * P.w + u32( x ); }
fn sat( x: f32 ) -> f32 { return clamp( x, 0.0, 1.0 ); }

fn sampleDome( t: f32 ) -> f32 {
  let fi = sat( t ) * f32( P.domeRes - 1u );
  let lo = u32( floor( fi ) );
  let hi = min( lo + 1u, P.domeRes - 1u );
  return mix( shape[lo], shape[hi], fract( fi ) );
}

fn hash( x: u32, y: u32, s: u32 ) -> u32 {
  var h = x * 374761393u + y * 668265263u + s * 362437u;
  h = ( h ^ ( h >> 13u ) ) * 1274126177u;
  return h ^ ( h >> 16u );
}

fn hash1( v: u32 ) -> u32 {
  var x = v;
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return x;
}

fn grad( i: vec2<i32>, s: u32 ) -> vec2<f32> {
  let h   = hash( u32( i.x + 8192 ), u32( i.y + 8192 ), s );
  let ang = f32( h & 0xffffu ) / 65535.0 * 6.28318530718;
  return vec2<f32>( cos( ang ), sin( ang ) );
}

fn perlin( p: vec2<f32>, s: u32 ) -> f32 {
  let i = vec2<i32>( floor( p ) );
  let f = p - floor( p );
  let u = f * f * ( 3.0 - 2.0 * f );
  let a = dot( grad( i, s ), f );
  let b = dot( grad( i + vec2<i32>( 1, 0 ), s ), f - vec2<f32>( 1.0, 0.0 ) );
  let c = dot( grad( i + vec2<i32>( 0, 1 ), s ), f - vec2<f32>( 0.0, 1.0 ) );
  let d = dot( grad( i + vec2<i32>( 1, 1 ), s ), f - vec2<f32>( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}

fn fbm( q: vec2<f32>, oct: i32, s: u32 ) -> f32 {
  var p = q; var sum = 0.0; var amp = 0.5; var norm = 0.0;
  for ( var o = 0; o < oct; o++ ) {
    sum += perlin( p, s + u32( o ) ) * amp;
    norm += amp; amp *= P.gain; p *= P.lacunarity;
  }
  return select( 0.0, sum / norm, norm > 0.0 );
}

fn ridged( q: vec2<f32>, oct: i32, s: u32 ) -> f32 {
  var p = q; var sum = 0.0; var amp = 0.5; var norm = 0.0; var weight = 1.0;
  for ( var o = 0; o < oct; o++ ) {
    var n = 1.0 - abs( perlin( p, s + u32( o ) ) );
    n *= n; n *= weight; weight = sat( n );
    sum += n * amp; norm += amp; amp *= P.gain; p *= P.lacunarity;
  }
  return select( 0.0, sum / norm, norm > 0.0 );
}

fn noiseAt( w: vec2<f32>, domeT: f32 ) -> f32 {
  var p = w;
  if ( ( P.mirrorOn & 1u ) != 0u ) { p.x = P.mirrorX - p.x; }
  if ( ( P.mirrorOn & 2u ) != 0u ) { p.y = P.mirrorZ - p.y; }
  var sp = ( p - vec2<f32>( P.noiseOX, P.noiseOZ ) ) / max( P.noiseScale, 0.01 );
  let warpOct = min( P.octaves, 4 );
  if ( P.warp > 0.0 ) {
    let q = vec2<f32>( fbm( sp + 11.5, warpOct, P.seed + 37u ), fbm( sp + 27.3, warpOct, P.seed + 91u ) );
    sp += q * P.warp;
  }
  var n: f32;
  if ( P.noiseType == 1u ) { n = ridged( sp, P.octaves, P.seed ) - 0.4; }
  else if ( P.noiseType == 2u ) { n = ( abs( fbm( sp, P.octaves, P.seed ) ) - 0.2 ) * 2.0; }
  else { n = fbm( sp, P.octaves, P.seed ); }
  return n * P.noiseHeight * mix( 1.0, domeT, sat( P.onPeak ) );
}

// ( the distance in from the outline; −1 outside it )
fn polyAt( i: u32 ) -> vec2<f32> { return vec2<f32>( shape[P.domeRes + i * 2u], shape[P.domeRes + i * 2u + 1u] ); }

fn polyDistance( p: vec2<f32> ) -> f32 {
  var inside = false;
  var md = 1e30;
  var j = P.polyCount - 1u;
  for ( var i = 0u; i < P.polyCount; i++ ) {
    let a = polyAt( i );
    let b = polyAt( j );
    if ( ( ( a.y > p.y ) != ( b.y > p.y ) ) && ( p.x < ( b.x - a.x ) * ( p.y - a.y ) / ( b.y - a.y ) + a.x ) ) { inside = !inside; }
    let ab = b - a;
    let t  = sat( dot( p - a, ab ) / max( dot( ab, ab ), 1e-6 ) );
    let dq = p - ( a + ab * t );
    md = min( md, dot( dq, dq ) );
    j = i;
  }
  return select( -1.0, sqrt( md ), inside );
}

@compute @workgroup_size( 8, 8 )
fn generate( @builtin( global_invocation_id ) id: vec3<u32> ) {
  if ( id.x >= P.w || id.y >= P.h ) { return; }
  let q    = id.y * P.w + id.x;
  let orig = inA[q];
  var outN = orig;
  var m    = 0.0;
  let p    = vec2<f32>( P.x0 + f32( id.x ) * P.sp, P.z0 + f32( id.y ) * P.sp );
  let d    = polyDistance( p );
  if ( d >= 0.0 ) {
    m = select( 1.0, sat( d / P.edgeFalloff ), P.edgeFalloff > 0.0 );
    m = m * m * ( 3.0 - 2.0 * m );
    let domeT = select( 1.0, sat( d / P.domeReach ), P.domeReach > 0.0 );
    let surf  = ( sampleDome( domeT ) * P.peakHeight + noiseAt( p, domeT ) ) / P.sizeY + P.baseHeight;
    if ( P.blendMode == 0u ) { outN = orig + surf * m; }
    else {
      let goal   = P.baseLevel + surf;
      var shaped = goal;
      if ( P.blendMode == 1u ) { shaped = max( orig, goal ); }
      else if ( P.blendMode == 2u ) { shaped = min( orig, goal ); }
      outN = mix( orig, shaped, m );
    }
  }
  outA[q] = outN;
  base[q] = orig;
  mask[q] = m;
}

fn box( x: i32, y: i32 ) -> f32 {
  var sum = 0.0;
  for ( var dy = -1; dy <= 1; dy++ ) { for ( var dx = -1; dx <= 1; dx++ ) { sum += inA[at( cx( x + dx ), cy( y + dy ) )]; } }
  return sum / 9.0;
}

@compute @workgroup_size( 8, 8 )
fn soften( @builtin( global_invocation_id ) id: vec3<u32> ) {
  if ( id.x >= P.w || id.y >= P.h ) { return; }
  let q   = id.y * P.w + id.x;
  outA[q] = mix( inA[q], box( i32( id.x ), i32( id.y ) ), Q.a * mask[q] );
}

@compute @workgroup_size( 8, 8 )
fn thermal( @builtin( global_invocation_id ) id: vec3<u32> ) {
  if ( id.x >= P.w || id.y >= P.h ) { return; }
  let x  = i32( id.x );
  let y  = i32( id.y );
  let hC = inA[at( x, y )];
  var offs = array<vec2<i32>, 8>( vec2<i32>( -1, 0 ), vec2<i32>( 1, 0 ), vec2<i32>( 0, -1 ), vec2<i32>( 0, 1 ), vec2<i32>( -1, -1 ), vec2<i32>( 1, -1 ), vec2<i32>( -1, 1 ), vec2<i32>( 1, 1 ) );
  var net = 0.0;
  for ( var k = 0; k < 8; k++ ) {
    let hN   = inA[at( cx( x + offs[k].x ), cy( y + offs[k].y ) )];
    let thr  = select( Q.b * 1.41421356, Q.b, k < 4 );
    let dh   = hC - hN;
    let flow = 0.125 * Q.a * max( 0.0, abs( dh ) - thr );
    net += select( flow, -flow, dh > 0.0 );
  }
  outA[at( x, y )] = hC + net;
}

@compute @workgroup_size( 8, 8 )
fn toInt( @builtin( global_invocation_id ) id: vec3<u32> ) {
  if ( id.x >= P.w || id.y >= P.h ) { return; }
  let q = id.y * P.w + id.x;
  atomicStore( &hint[q], i32( inA[q] * HEIGHT_SCALE ) );
}

@compute @workgroup_size( 8, 8 )
fn fromInt( @builtin( global_invocation_id ) id: vec3<u32> ) {
  if ( id.x >= P.w || id.y >= P.h ) { return; }
  let q   = id.y * P.w + id.x;
  outA[q] = clamp( f32( atomicLoad( &hint[q] ) ) / HEIGHT_SCALE, -1.0, 3.0 );
}

fn heightAt( x: i32, y: i32 ) -> f32 { return clamp( f32( atomicLoad( &hint[at( cx( x ), cy( y ) )] ) ) / HEIGHT_SCALE, -1.0, 3.0 ); }
fn addHeight( x: i32, y: i32, a: f32 ) { atomicAdd( &hint[at( cx( x ), cy( y ) )], i32( round( a * HEIGHT_SCALE ) ) ); }

fn corners( nx: i32, ny: i32, ox: f32, oy: f32, a: f32 ) {
  addHeight( nx, ny, a * ( 1.0 - ox ) * ( 1.0 - oy ) );
  addHeight( nx + 1, ny, a * ox * ( 1.0 - oy ) );
  addHeight( nx, ny + 1, a * ( 1.0 - ox ) * oy );
  addHeight( nx + 1, ny + 1, a * ox * oy );
}

fn brush( nx: i32, ny: i32, a: f32, R: i32, wSum: f32 ) {
  for ( var by = -R; by <= R; by++ ) {
    for ( var bx = -R; bx <= R; bx++ ) {
      let x = nx + bx;
      let y = ny + by;
      if ( x < 0 || y < 0 || x >= i32( P.w ) || y >= i32( P.h ) ) { continue; }
      let w = max( 0.0, 1.0 - sqrt( f32( bx * bx + by * by ) ) / f32( R ) );
      if ( w > 0.0 ) { addHeight( x, y, a * w / wSum ); }
    }
  }
}

@compute @workgroup_size( 64 )
fn droplet( @builtin( global_invocation_id ) id: vec3<u32> ) {
  if ( id.x >= Q.count ) { return; }
  var rng = hash1( ( id.x + Q.offset ) * 1973u + P.dropletSeed * 9277u + 1u );
  var posX = 0.0;
  var posY = 0.0;
  var spawned = false;
  for ( var t = 0; t < 8; t++ ) {
    posX = f32( rng & 0xffffu ) / 65535.0 * f32( P.w - 1u );
    rng  = hash1( rng );
    posY = f32( rng & 0xffffu ) / 65535.0 * f32( P.h - 1u );
    rng  = hash1( rng );
    if ( mask[at( i32( posX ), i32( posY ) )] > 0.01 ) { spawned = true; break; }
  }
  if ( !spawned ) { return; }
  let R = clamp( P.radius, 1, 4 );
  var wSum = 1.0;
  if ( R > 1 ) {
    wSum = 0.0;
    for ( var wy = -R; wy <= R; wy++ ) { for ( var wx = -R; wx <= R; wx++ ) { wSum += max( 0.0, 1.0 - sqrt( f32( wx * wx + wy * wy ) ) / f32( R ) ); } }
  }
  var dirX = 0.0;
  var dirY = 0.0;
  var speed = 1.0;
  var water = 1.0;
  var sediment = 0.0;
  var left = false;
  for ( var life = 0; life < P.lifetime; life++ ) {
    let nodeX = i32( posX );
    let nodeY = i32( posY );
    let offX  = posX - f32( nodeX );
    let offY  = posY - f32( nodeY );
    let hNW = heightAt( nodeX, nodeY );
    let hNE = heightAt( nodeX + 1, nodeY );
    let hSW = heightAt( nodeX, nodeY + 1 );
    let hSE = heightAt( nodeX + 1, nodeY + 1 );
    let height = hNW * ( 1.0 - offX ) * ( 1.0 - offY ) + hNE * offX * ( 1.0 - offY ) + hSW * ( 1.0 - offX ) * offY + hSE * offX * offY;
    let gradX  = ( hNE - hNW ) * ( 1.0 - offY ) + ( hSE - hSW ) * offY;
    let gradY  = ( hSW - hNW ) * ( 1.0 - offX ) + ( hSE - hNE ) * offX;
    dirX = dirX * P.inertia - gradX * ( 1.0 - P.inertia );
    dirY = dirY * P.inertia - gradY * ( 1.0 - P.inertia );
    let len = sqrt( dirX * dirX + dirY * dirY );
    if ( len <= 1e-6 ) { break; }
    dirX /= len;
    dirY /= len;
    posX += dirX;
    posY += dirY;
    if ( posX < 0.0 || posX > f32( P.w - 1u ) || posY < 0.0 || posY > f32( P.h - 1u ) ) { left = true; break; }
    let nX = i32( posX );
    let nY = i32( posY );
    let aX = posX - f32( nX );
    let aY = posY - f32( nY );
    let newHeight = heightAt( nX, nY ) * ( 1.0 - aX ) * ( 1.0 - aY ) + heightAt( nX + 1, nY ) * aX * ( 1.0 - aY ) + heightAt( nX, nY + 1 ) * ( 1.0 - aX ) * aY + heightAt( nX + 1, nY + 1 ) * aX * aY;
    let dh  = newHeight - height;
    let cap = max( -dh, 0.0004 ) * speed * water * P.capacity;
    if ( sediment > cap || dh > 0.0 ) {
      let amount = select( ( sediment - cap ) * P.deposit, min( dh, sediment ), dh > 0.0 );
      sediment -= amount;
      corners( nodeX, nodeY, offX, offY, amount );
    } else {
      let amount = min( min( ( cap - sediment ) * P.erode, -dh ), P.maxErodeStep );
      sediment += amount;
      if ( R <= 1 ) { corners( nodeX, nodeY, offX, offY, -amount ); }
      else { brush( nodeX, nodeY, -amount, R, wSum ); }
    }
    speed = sqrt( max( 0.0, speed * speed + ( -dh ) * 4.0 ) );
    water *= ( 1.0 - P.evaporate );
    if ( water < 0.01 ) { break; }
  }
  if ( !left && sediment > 0.0001 ) {
    let nodeX = i32( posX );
    let nodeY = i32( posY );
    if ( R <= 1 ) { corners( nodeX, nodeY, posX - f32( nodeX ), posY - f32( nodeY ), sediment ); }
    else { brush( nodeX, nodeY, sediment, R, wSum ); }
  }
}

@compute @workgroup_size( 8, 8 )
fn settle( @builtin( global_invocation_id ) id: vec3<u32> ) {
  if ( id.x >= P.w || id.y >= P.h ) { return; }
  let q   = id.y * P.w + id.x;
  outA[q] = sat( mix( inA[q], box( i32( id.x ), i32( id.y ) ), Q.a ) );
}

@compute @workgroup_size( 8, 8 )
fn accumulate( @builtin( global_invocation_id ) id: vec3<u32> ) {
  if ( id.x >= P.w || id.y >= P.h ) { return; }
  let x  = i32( id.x );
  let y  = i32( id.y );
  let D  = max( P.stencil, 1 );
  let dhx = ( inB[at( cx( x + D ), y )] - inB[at( cx( x - D ), y )] ) * P.sizeY / ( 2.0 * P.sp * f32( D ) );
  let dhz = ( inB[at( x, cy( y + D ) )] - inB[at( x, cy( y - D ) )] ) * P.sizeY / ( 2.0 * P.sp * f32( D ) );
  let slopeDeg = degrees( atan( sqrt( dhx * dhx + dhz * dhz ) ) );
  var altFactor = 1.0;
  if ( P.lineHigh >= 0.0 ) { altFactor = smoothstep( P.lineLow, max( P.lineHigh, P.lineLow + 0.01 ), P.posY + inA[at( x, y )] * P.sizeY ); }
  let slopeFactor = 1.0 - smoothstep( P.slopeStart, max( P.slopeFull, P.slopeStart + 0.01 ), slopeDeg );
  let D2   = min( D * 2, 8 );
  let curv = ( ( inB[at( cx( x - D2 ), y )] + inB[at( cx( x + D2 ), y )] + inB[at( x, cy( y - D2 ) )] + inB[at( x, cy( y + D2 ) )] ) * 0.25 - inB[at( x, y )] ) * P.sizeY / ( f32( D2 ) * P.sp );
  outA[at( x, y )] = sat( slopeFactor + clamp( curv * P.crevice * 1.5, -0.6, 0.6 ) ) * altFactor;
}

@compute @workgroup_size( 8, 8 )
fn composite( @builtin( global_invocation_id ) id: vec3<u32> ) {
  if ( id.x >= P.w || id.y >= P.h ) { return; }
  let x   = i32( id.x );
  let y   = i32( id.y );
  let q   = at( x, y );
  let hN  = inA[q];
  let cov = sat( inB[q] );
  let D   = min( max( P.stencil, 1 ) * 2, 8 );
  let hAvg = ( inA[at( cx( x - D ), y )] + inA[at( cx( x + D ), y )] + inA[at( x, cy( y - D ) )] + inA[at( x, cy( y + D ) )] ) * 0.25;
  outA[q] = hN + P.addsHeight * cov * ( P.amount + max( 0.0, hAvg - hN ) );
  outB[q] = smoothstep( 0.3, 0.7, 1.0 - cov ) * mask[q] * P.rock;
}
`;

const KERNELS = ["generate", "soften", "thermal", "toInt", "fromInt", "droplet", "settle", "accumulate", "composite"] as const;
type Kernel = ( typeof KERNELS )[number];

let made: { device: GPUDevice; layout: GPUBindGroupLayout; pipes: Record<Kernel, GPUComputePipeline> } | null = null;

function pipelines( device: GPUDevice ) {
  if ( made?.device === device ) return made;
  const kinds: GPUBufferBindingType[] = ["uniform", "uniform", "read-only-storage", "read-only-storage", "storage", "storage", "storage", "storage", "read-only-storage", "storage"];
  const layout                        = device.createBindGroupLayout( { entries: kinds.map( ( type, binding ) => ( { binding, visibility: COMPUTE, buffer: { type } } ) ) } );
  const module                        = device.createShaderModule( { code: SHADER } );
  const pl                            = device.createPipelineLayout( { bindGroupLayouts: [layout] } );
  const pipes                         = Object.fromEntries( KERNELS.map( ( k ) => [k, device.createComputePipeline( { layout: pl, compute: { module, entryPoint: k } } )] ) ) as Record<Kernel, GPUComputePipeline>;
  made                                = { device, layout, pipes };
  return made;
}

/**
 * The formation `I` worked out on the graphics card.
**/
export async function simulateGpu( device: GPUDevice, I: SimInput ): Promise<SimOutput> {
  // ( anything the card won't do said, not left as a grid of zeros: worked out here instead )
  device.pushErrorScope( "validation" );
  let scoped               = true;
  const { layout, pipes }  = pipelines( device );
  const N                  = I.w * I.h, bytes = N * 4;
  const owned: GPUBuffer[] = [];
  const buffer             = ( size: number, usage: number ) => {
    const b = device.createBuffer( { size: Math.max( 16, Math.ceil( size / 4 ) * 4 ), usage } );
    owned.push( b );
    return b;
  };
  const filled = ( data: Float32Array | Uint8Array, usage: number ) => {
    const b = buffer( data.byteLength, usage | COPY_DST );
    device.queue.writeBuffer( b, 0, data as Uint8Array<ArrayBuffer> );
    return b;
  };
  try {
    // the settings
    const P   = new ArrayBuffer( FIELDS.length * 4 ), dv = new DataView( P );
    const hy  = I.hydraulic, sn = I.snow;
    const val: Record<string, number> = {
      w: I.w, h: I.h, polyCount: I.poly.length / 2, domeRes: I.dome.length, x0: I.x0, z0: I.z0, sp: I.sp, sizeY: I.sizeY, posY: I.posY,
      edgeFalloff: I.edgeFalloff, domeReach: I.domeReach, peakHeight: I.peakHeight, blendMode: I.blendMode, baseHeight: I.baseHeight, baseLevel: I.baseLevel,
      noiseType: I.noiseType, noiseHeight: I.noiseHeight, noiseScale: I.noiseScale, octaves: I.octaves, lacunarity: I.lacunarity, gain: I.gain, warp: I.warp,
      seed: I.seed, onPeak: I.onPeak, mirrorX: Number.isNaN( I.mirrorX ) ? 0 : I.mirrorX, mirrorZ: Number.isNaN( I.mirrorZ ) ? 0 : I.mirrorZ,
      mirrorOn: ( Number.isNaN( I.mirrorX ) ? 0 : 1 ) | ( Number.isNaN( I.mirrorZ ) ? 0 : 2 ),
      lifetime: hy?.lifetime ?? 0, inertia: hy?.inertia ?? 0, capacity: hy?.capacity ?? 0, deposit: hy?.deposit ?? 0, erode: hy?.erode ?? 0, evaporate: hy?.evaporate ?? 0,
      radius: hy?.radius ?? 1, dropletSeed: hy?.seed ?? 0, maxErodeStep: hy?.maxErodeStep ?? 0,
      lineLow: sn?.lineLow ?? -1, lineHigh: sn?.lineHigh ?? -1, slopeStart: sn?.slopeStart ?? 0, slopeFull: sn?.slopeFull ?? 0, crevice: sn?.crevice ?? 0,
      stencil: sn?.stencil ?? 1, amount: sn?.amount ?? 0, addsHeight: sn?.addsHeight ?? 0, rock: sn?.rock ?? 0, noiseOX: I.noiseOX, noiseOZ: I.noiseOZ,
    };
    FIELDS.forEach( ( [n, t], k ) => {
      const v = val[n] ?? 0;
      if ( t === "f32" ) dv.setFloat32( k * 4, v, true );
      else if ( t === "u32" ) dv.setUint32( k * 4, v >>> 0, true );
      else dv.setInt32( k * 4, v | 0, true );
    } );
    const pBuf = filled( new Uint8Array( P ), UNIFORM );
    const pass = ( a: number, b = 0, count = 0, offset = 0 ) => {
      const q = new ArrayBuffer( 16 ), d = new DataView( q );
      d.setFloat32( 0, a, true );
      d.setFloat32( 4, b, true );
      d.setUint32( 8, count, true );
      d.setUint32( 12, offset, true );
      return filled( new Uint8Array( q ), UNIFORM );
    };
    // the samples: the ground, the heights ( two, turn about ), the snow ( two ), what's made, how much it takes, the
    // rock, the heights as integers ( the droplets wear them together ), the profile and the outline
    const ground = filled( I.ground, STORAGE );
    let hCur     = buffer( bytes, STORAGE ), hAlt = buffer( bytes, STORAGE ), snCur = buffer( bytes, STORAGE ), snAlt = buffer( bytes, STORAGE );
    const base   = buffer( bytes, STORAGE ), mask = buffer( bytes, STORAGE | COPY_SRC ), fin = buffer( bytes, STORAGE | COPY_SRC ), rock = buffer( bytes, STORAGE | COPY_SRC );
    const both   = new Float32Array( I.dome.length + I.poly.length );
    both.set( I.dome );
    both.set( I.poly, I.dome.length );
    const hint   = buffer( bytes, STORAGE ), shape = filled( both, STORAGE );
    const none   = pass( 0 );
    const enc    = device.createCommandEncoder();
    const cp     = enc.beginComputePass();
    const run    = ( k: Kernel, q: GPUBuffer, inA: GPUBuffer, inB: GPUBuffer, outA: GPUBuffer, outB = rock, groups?: [number, number] ) => {
      const res = [pBuf, q, inA, inB, outA, base, mask, hint, shape, outB];
      cp.setPipeline( pipes[k] );
      cp.setBindGroup( 0, device.createBindGroup( { layout, entries: res.map( ( b, binding ) => ( { binding, resource: { buffer: b } } ) ) } ) );
      const [gx, gy] = groups ?? [Math.ceil( I.w / 8 ), Math.ceil( I.h / 8 )];
      cp.dispatchWorkgroups( Math.max( 1, gx ), Math.max( 1, gy ) );
    };
    const turn = () => { const t = hCur; hCur = hAlt; hAlt = t; };
    run( "generate", none, ground, ground, hCur );
    if ( I.smoothIters > 0 ) {
      const q = pass( I.smooth );
      for ( let i = 0; i < I.smoothIters; i++ ) { run( "soften", q, hCur, ground, hAlt ); turn(); }
    }
    if ( I.thermal ) {
      const q = pass( I.thermal.strength, I.thermal.talus );
      for ( let i = 0; i < I.thermal.iters; i++ ) { run( "thermal", q, hCur, ground, hAlt ); turn(); }
    }
    if ( hy ) {
      run( "toInt", none, hCur, ground, hAlt );
      const waves = Math.min( 64, Math.max( 1, Math.ceil( hy.droplets / 8192 ) ) ), size = Math.ceil( hy.droplets / waves );
      for ( let w = 0; w < waves; w++ ) {
        const count = Math.min( size, hy.droplets - w * size );
        if ( count <= 0 ) break;
        run( "droplet", pass( 0, 0, count, w * size ), ground, ground, hAlt, rock, [Math.ceil( count / 64 ), 1] );
      }
      run( "fromInt", none, ground, ground, hCur );
      const q = pass( 0.5, ( Math.tan( ( 70 * Math.PI ) / 180 ) * I.sp ) / I.sizeY );
      for ( let i = 0; i < 3; i++ ) { run( "thermal", q, hCur, ground, hAlt ); turn(); }
    }
    if ( sn ) {
      const one = pass( 1 );
      run( "settle", one, hCur, ground, snCur );
      run( "settle", one, snCur, ground, hAlt );
      run( "accumulate", none, hCur, hAlt, snCur );
      const half = pass( 0.5 );
      for ( let i = 0; i < sn.settle; i++ ) {
        run( "settle", half, snCur, ground, snAlt );
        const t = snCur;
        snCur   = snAlt;
        snAlt   = t;
      }
    }
    run( "composite", none, hCur, sn ? snCur : ground, fin, rock );
    cp.end();
    // read back
    const back = [fin, mask, rock].map( ( b ) => {
      const r = buffer( bytes, MAP_READ | COPY_DST );
      enc.copyBufferToBuffer( b, 0, r, 0, bytes );
      return r;
    } );
    device.queue.submit( [enc.finish()] );
    scoped    = false;
    const err = await device.popErrorScope();
    if ( err ) {
      made = null;
      throw new Error( err.message );
    }
    await Promise.all( back.map( ( b ) => b.mapAsync( 1 ) ) );
    const [h, k, rk] = back.map( ( b ) => new Float32Array( b.getMappedRange().slice( 0, bytes ) ) );
    return { h, k, rock: rk };
  } finally {
    if ( scoped ) void device.popErrorScope();
    for ( const b of owned ) b.destroy();
  }
}
