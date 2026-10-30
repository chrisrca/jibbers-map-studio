// One tile of a chunk drawn: its grid at the level of detail for its distance, its heights and masks as textures,
// and its material ( the ground's look ).

import { Fn, abs, attribute, cameraPosition, cos, dot, float, floor, fract, fwidth, ivec2, max, mix, mx_noise_float, positionWorld, round, select, sin, step, clamp as tclamp, texture, textureLoad, transformNormalToView, uniform, varying, vec2, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { type Rect, Terrain, TerrainChunk } from "../../../terrain/terrain";
import { withLamps } from "../lamps";
import { type GpuAccess, writeTextureRegion } from "./gpu";
import { type N, blackTex, brushLook, brushRings, gameTex, powderOf, snowLook, whiteTex } from "./look";

export const SKIRT_FLAG = 1;

export class Tile {
  readonly mesh:          THREE.Mesh;
  // the tile's heights and one sample beyond it all round ( for the lighting at its edges )
  readonly heightTex:     THREE.DataTexture;
  // the sculpt mask, 0..1
  readonly sculptMaskTex: THREE.DataTexture;
  readonly box = new THREE.Box3();
  step         = -1;
  readonly maskNode: ReturnType<typeof texture>;
  private minH = 0;
  private maxH = 0;

  // 1 when the chunk's mask has 4 channels ( G = marking hue, B = marking coverage ), as the game reads it
  readonly markings = uniform( 0 );
  // the mask's pixels per side: the marking hue is read from the nearest pixel, unblended, as the game does
  readonly maskSize = uniform( new THREE.Vector2( 1, 1 ) );
  readonly hueNode: ReturnType<typeof texture>;
  setMaskSize( tex: THREE.Texture ) {
    const img = tex.image as { width?: number; height?: number } | undefined;
    this.maskSize.value.set( img?.width || 1, img?.height || 1 );
  }

  // 1 when the chunk has a flow mask ( corduroy direction )
  readonly hasFlow     = uniform( 0 );
  // 1 when grip can't go on the chunk ( it has markings or powder: paint.ts gripBlocked )
  readonly gripBlocked = uniform( 0 );
  readonly flowNode: ReturnType<typeof texture>;
  readonly snowNode: ReturnType<typeof texture>;
  readonly rockNode: ReturnType<typeof texture>;

  constructor( public chunk: TerrainChunk, public ci: number, readonly tx: number, readonly tz: number, maskTex: THREE.Texture, markings: boolean, flowTex: THREE.Texture | null = null ) {
    this.markings.value                = markings ? 1 : 0;
    this.hasFlow.value                 = flowTex  ? 1 : 0;
    const q                            = chunk.tileQuads, s = q + 1;
    const a                            = s + 2;
    this.heightTex                     = new THREE.DataTexture( new Float32Array( a * a ), a, a, THREE.RedFormat, THREE.FloatType );
    this.heightTex.magFilter           = this.heightTex.minFilter = THREE.NearestFilter;
    this.sculptMaskTex                 = new THREE.DataTexture( new Uint8Array( s * s ), s, s, THREE.RedFormat, THREE.UnsignedByteType );
    this.sculptMaskTex.magFilter       = this.sculptMaskTex.minFilter = THREE.LinearFilter;
    this.sculptMaskTex.generateMipmaps = false;

    const spacing    = chunk.spacing, res = chunk.res;
    const i0         = tx * q, j0 = tz * q;
    const mat        = new THREE.MeshLambertNodeMaterial();
    const grid       = attribute( "grid", "vec3" );
    const h          = textureLoad( this.heightTex, ivec2( grid.x.toInt().add( 1 ), grid.y.toInt().add( 1 ) ) ).x;
    const skirtDepth = float( spacing * 8 + 2 );
    mat.positionNode = vec3( grid.x.mul( spacing ), h.sub( grid.z.mul( skirtDepth ) ), grid.y.mul( -spacing ) );

    const nUv     = varying( vec2( grid.x.add( 0.5 ).div( s   ), grid.y.add( 0.5 ).div( s ) ) );
    const mUv     = varying( vec2( grid.x.add( i0  ).div( res - 1 ), grid.y.add( j0 ).div( res - 1 ) ) );
    const masked  = texture( this.sculptMaskTex, nUv ).r;
    // the normal at a pixel: at the four samples round it, from their neighbours' heights, blended ( Unity space )
    const gc      = varying( vec2( grid.x, grid.y ) );
    const nSample = Fn( () => {
      // ( the cell's corner kept inside the tile: at its last sample a pixel's blend can't reach past its border ring )
      const c  = tclamp( floor( gc ), vec2( 0, 0 ), vec2( s - 2, s - 2 ) ), f = gc.sub( c );
      const ci = ivec2( c.x.toInt().add( 1 ), c.y.toInt().add( 1 ) );
      const H  = ( di: number, dj: number ) => textureLoad( this.heightTex, ci.add( ivec2( di, dj ) ) ).x;
      const at = ( di: number, dj: number ) => vec3( H( di - 1, dj ).sub( H( di + 1, dj ) ), float( 2 * spacing ), H( di, dj - 1 ).sub( H( di, dj + 1 ) ) ).normalize();
      return mix( mix( at( 0, 0 ), at( 1, 0 ), f.x ), mix( at( 0, 1 ), at( 1, 1 ), f.x ), f.y );
    } )();
    this.maskNode = texture( maskTex, mUv );
    this.setMaskSize( maskTex );
    this.hueNode  = texture( maskTex, floor( mUv.mul( this.maskSize ) ).add( 0.5 ).div( this.maskSize ) ).level( float( 0 ) );
    this.flowNode = texture( flowTex ?? blackTex, mUv );
    // the game's snow and boulders, tiled as its terrain shader tiles them: 30 and 150 times across a chunk
    this.snowNode = texture( gameTex.snow ?? whiteTex, mUv.mul( 30 ) );
    this.rockNode = texture( gameTex.rock ?? whiteTex, mUv.mul( 150 ) );
    // texture nodes of untyped textures lose their vec4 typing; it samples as rgba
    const mask    = this.maskNode as unknown as ReturnType<typeof vec4>;
    // corduroy direction ( Unity XZ ), as the game reads the flow mask: 0..1 = 0..360° from +Z towards +X; without one
    // the grooves run along +Z ( the game's default )
    const flowA   = ( this.flowNode as unknown as ReturnType<typeof vec4> ).r.mul( Math.PI * 2 );
    const fdx     = mix( float( 0 ), flowA.sin(), this.hasFlow ), fdz = mix( float( 1 ), flowA.cos(), this.hasFlow );

    mat.normalNode = Fn( () => {
      // stored normal is Unity space; mirror Z into three space
      const n      = vec3( nSample.x, nSample.y, nSample.z.negate() ).normalize().toVar();
      const snow   = mask.r;
      const fade   = tclamp( float( 1 ).sub( positionWorld.distance( cameraPosition ).mul( 0.035 ) ), 0, 1 );
      // the game's grooves: sin( ( x·d.z − z·d.x )·tiling ) across the flow, tilting the normal sideways to it
      const zU     = positionWorld.z.negate();
      const phase  = positionWorld.x.mul( fdz ).sub( zU.mul( fdx ) ).mul( snowLook.pisteTiling );
      const powder = mask.a.mul( this.markings );
      const groove = sin( phase ).mul( snowLook.grooveStrength ).mul( snow ).mul( fade ).mul( float( 1 ).sub( powderOf( powder ) ) );
      return transformNormalToView( n.add( vec3( fdz, 0, fdx ).mul( groove ) ).normalize() );
    } )();

    mat.colorNode = Fn( () => {
      const snow    = mask.r;
      // rock: the game's grey over its boulder texture ( without the game's, two octaves of noise ); snow: white over
      // its snow texture
      const pw      = vec2( positionWorld.x, positionWorld.z );
      const grain   = mx_noise_float( pw.mul( 0.45 ) ).mul( 0.6 ).add( mx_noise_float( pw.mul( 2.1 ) ).mul( 0.4 ) );
      const rockTex = ( this.rockNode as unknown as ReturnType<typeof vec4> ).rgb, snowTex = ( this.snowNode as unknown as ReturnType<typeof vec4> ).rgb;
      const rock    = mix( snowLook.rockColor.mul( grain.mul( 0.28 ).add( 1 ) ), rockTex.mul( snowLook.rockColor ), snowLook.gameSnow );
      const white   = mix( snowLook.baseColor,                                   snowTex.mul( snowLook.baseColor ), snowLook.gameSnow );
      const col     = mix( rock, white, snow ).toVar();
      // markings, as the game draws them: the hue from the nearest mask pixel snapped to 1/20, blended
      // markingTint of the way towards a saturated tint at the snow's brightness, by the ( smooth ) coverage
      const hue     = round( ( this.hueNode as unknown as ReturnType<typeof vec4> ).g.mul( 20 ) ).div( 20 );
      const tint    = tclamp( abs( fract( vec3( hue, hue, hue ).add( vec3( 1, 2 / 3, 1 / 3 ) ) ).mul( 6 ).sub( 3 ) ).sub( 1 ), 0, 1 );
      const lum     = dot( col, vec3( 0.299, 0.587, 0.114 ) );
      const on      = step( 0.001, hue ).mul( step( hue, 0.999 ) ).mul( mask.b ).mul( this.markings ).mul( snowLook.markingTint );
      col.assign( mix( col, tint.mul( max( lum, 0.5 ) ), on ) );
      // powder ( the mask's alpha ), laid over the snow as the game does
      col.assign( mix( col, snowLook.thirdColor, powderOf( mask.a ).mul( this.markings ).mul( snow ) ) );
      // paint mode, Flow: the ground coloured by direction ( hue = angle ), as Better Terrain Editor shows it
      const fh      = fract( flowA.div( Math.PI * 2 ) );
      const flowCol = tclamp( abs( fract( vec3( fh, fh, fh ).add( vec3( 1, 2 / 3, 1 / 3 ) ) ).mul( 6 ).sub( 3 ) ).sub( 1 ), 0, 1 );
      col.assign( mix( col, flowCol, snowLook.showFlow.mul( this.hasFlow ).mul( 0.55 ) ) );
      const grip = mask.a.mul( float( 1 ).sub( this.markings ) );
      col.assign( mix( col, snowLook.gripColor,        snowLook.showGrip.mul( tclamp( grip.mul( 1.5 ), 0, 1 ) ).mul( 0.6 ) ) );
      col.assign( mix( col, snowLook.gripBlockedColor, snowLook.showGrip.mul( this.gripBlocked ).mul( 0.4 )                ) );
      // reading the ground's shape: slope colours ( green, yellow, orange, red, purple from the least to the most,
      // in bands when asked ), hillshade ( lit from a sun of its own, the tilt exaggerated ), contour lines
      const slope  = nSample.y.acos().mul( 57.2958 );
      const st     = snowLook.slopeStep;
      const banded = select( st.greaterThan( 0.01 ), floor( slope.div( max( st, 0.01 ) ) ).add( 0.5 ).mul( st ), slope );
      const t      = tclamp( banded.sub( snowLook.slopeMin ).div( max( snowLook.slopeMax.sub( snowLook.slopeMin ), 0.01 ) ), 0, 1 ).mul( 4 );
      let ramp: N  = mix( vec3( 0.2, 0.72, 0.3 ), vec3( 0.95, 0.85, 0.2 ), tclamp( t, 0, 1 ) );
      ramp         = mix( ramp, vec3( 0.98, 0.55, 0.15 ), tclamp( t.sub( 1 ), 0, 1 ) );
      ramp         = mix( ramp, vec3( 0.88, 0.18, 0.15 ), tclamp( t.sub( 2 ), 0, 1 ) );
      ramp         = mix( ramp, vec3( 0.55, 0.2,  0.68 ), tclamp( t.sub( 3 ), 0, 1 ) );
      col.assign( mix( col, ramp, snowLook.showSlope.mul( snowLook.slopeOpacity ) ) );
      const nn  = vec3( nSample.x.mul( snowLook.exaggeration ), nSample.y, nSample.z.negate().mul( snowLook.exaggeration ) ).normalize();
      const sun = vec3( cos( snowLook.sunHeight ).mul( sin( snowLook.sunDir ) ), sin( snowLook.sunHeight ), cos( snowLook.sunHeight ).mul( cos( snowLook.sunDir ) ).negate() );
      const lit = max( dot( nn, sun ), 0 ).mul( 1.25 ).add( 0.12 );
      col.assign( col.mul( mix( float( 1 ), lit, snowLook.hillshade ) ) );
      // relief: lit by the map's own sun again, as much brighter or darker as the slope turns to it or away ( flat
      // ground as it was; less as the sun gets low, none once it's down )
      const n3    = vec3( nSample.x, nSample.y, nSample.z.negate() ).normalize();
      const toSun = tclamp( max( dot( n3, snowLook.sunView ), 0 ).mul( 0.9 ).add( 0.45 ).div( max( snowLook.sunView.y, 0.05 ).mul( 0.9 ).add( 0.45 ) ), 0.45, 1.3 );
      col.assign( col.mul( mix( float( 1 ), toSun, snowLook.relief.mul( tclamp( snowLook.sunView.y.mul( 6 ), 0, 1 ) ) ) ) );
      const h      = positionWorld.y, cs = max( snowLook.contours, 0.01 );
      const across = abs( fract( h.div( cs ).add( 0.5 ) ).sub( 0.5 ) ).mul( cs ).div( max( fwidth( h ), 1e-4 ) );
      const line   = float( 1 ).sub( tclamp( across.sub( 0.5 ), 0, 1 ) ).mul( step( 0.01, snowLook.contours ) );
      col.assign( mix( col, vec3( 0.1, 0.11, 0.13 ), line.mul( snowLook.contourOpacity ) ) );
      // masked ground: darker, as in Blender
      col.assign( col.mul( float( 1 ).sub( masked.mul( 0.6 ).mul( brushLook.showMask ) ) ) );
      // the brush: faint fill by strength, a dark halo so the ring reads on white snow, then the rings
      const b = brushRings();
      col.assign( mix( col, brushLook.color, b.fill.mul( 0.14 ) ) );
      col.assign( col.mul( float( 1 ).sub( b.halo.mul( 0.55 ) ) ) );
      // brighter than white: it's lit like the snow, and must still stand out on slopes in shade
      col.assign( mix( col, brushLook.color.mul( 2.2 ), max( b.ring, b.inner.mul( 0.75 ) ) ) );
      return col;
    } )();

    // ( the map's lamps on it, by night: facing its own normal, three space )
    withLamps( mat, vec3( nSample.x, nSample.y, nSample.z.negate() ).normalize() );
    this.mesh                  = new THREE.Mesh( undefined, mat );
    this.mesh.frustumCulled    = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.position.set( chunk.position[0] + i0 * spacing, chunk.position[1], -( chunk.position[2] + j0 * spacing ) );
    this.mesh.updateMatrix();
    this.mesh.receiveShadow = true;
    this.upload( null );
  }

  /**
   * Copies the tile's samples ( and one beyond them all round ) and its sculpt mask from the chunk and writes them to
   * the GPU. With `rect` ( chunk samples ), only that part is refreshed — sculpting touches a small area of a 513² tile.
  **/
  upload( t: Terrain | null, rect?: Rect, gpu: GpuAccess | null = null ) {
    const c   = this.chunk, q = c.tileQuads, s = q + 1, res = c.res, a = s + 2;
    const i0  = this.tx * q, j0 = this.tz * q;
    const hd  = this.heightTex.image.data as Float32Array;
    // the tile-local part to refresh, its outer ring included ( -1 .. s )
    const li0 = rect ? Math.max( -1, rect[0] - i0 ) : -1, lj0 = rect ? Math.max( -1, rect[1] - j0 ) : -1;
    const li1 = rect ? Math.min( s, rect[2] - i0 ) : s, lj1 = rect ? Math.min( s, rect[3] - j0 ) : s;
    if ( li0 > li1 || lj0 > lj1 ) return;
    const sp = c.spacing;
    // ( past the chunk's edge: the next chunk's ground, or its own edge's )
    const H  = ( gi: number, gj: number ) => {
      if ( gi >= 0 && gj >= 0 && gi < res && gj < res ) return c.heights[gj * res + gi];
      if ( t ) {
        const w = t.heightAt( c.position[0] + gi * sp, c.position[2] + gj * sp );
        if ( !Number.isNaN( w ) ) return w - c.position[1];
      }
      return c.heights[Math.min( res - 1, Math.max( 0, gj ) ) * res + Math.min( res - 1, Math.max( 0, gi ) )];
    };
    for ( let j = lj0; j <= lj1; j++ ) {
      const gj = j0 + j, row = ( j + 1 ) * a + 1;
      // the inside of a row straight from the chunk; its ends ( and rows off the chunk ) through the lookup
      const ia = Math.max( li0, -i0 ), ib = Math.min( li1, res - 1 - i0 );
      if ( gj >= 0 && gj < res && ia <= ib ) {
        for ( let i = li0; i < ia; i++ ) hd[row + i] = H( i0 + i, gj );
        hd.set( c.heights.subarray( gj * res + i0 + ia, gj * res + i0 + ib + 1 ), row + ia );
        for ( let i = ib + 1; i <= li1; i++ ) hd[row + i] = H( i0 + i, gj );
      } else for ( let i = li0; i <= li1; i++ ) hd[row + i] = H( i0 + i, gj );
    }
    // the tile's own range ( its outer ring left out )
    let mn = rect ? this.minH : Infinity, mx = rect ? this.maxH : -Infinity;
    for ( let j = Math.max( 0, lj0 ); j <= Math.min( s - 1, lj1 ); j++ )
      for ( let i = Math.max( 0, li0 ), k = ( j + 1 ) * a + i + 1; i <= Math.min( s - 1, li1 ); i++, k++ ) {
        const v = hd[k];
        if ( v < mn ) mn = v;
        if ( v > mx ) mx = v;
      }
    // just the part that changed written to the GPU ( the texture made again whole only when the card hasn't one yet )
    const part: [number, number, number, number] = [li0 + 1, lj0 + 1, li1 + 1, lj1 + 1];
    if ( !rect || !writeTextureRegion( gpu, this.heightTex, new Uint8Array( hd.buffer, hd.byteOffset, hd.byteLength ), a, 4, part ) ) this.heightTex.needsUpdate = true;
    // the sculpt mask ( a chunk without one: nothing to show, once )
    if ( c.mask || !this.maskShown ) {
      const md  = this.sculptMaskTex.image.data as Uint8Array;
      const mi0 = Math.max( 0, li0 ), mj0 = Math.max( 0, lj0 ), mi1 = Math.min( s - 1, li1 ), mj1 = Math.min( s - 1, lj1 );
      if ( c.mask ) for ( let j = mj0; j <= mj1; j++ ) md.set( c.mask.subarray( ( j0 + j ) * res + i0 + mi0, ( j0 + j ) * res + i0 + mi1 + 1 ), j * s + mi0 );
      if ( !rect || !c.mask || !writeTextureRegion( gpu, this.sculptMaskTex, md, s, 1, [mi0, mj0, mi1, mj1] ) ) this.sculptMaskTex.needsUpdate = true;
      this.maskShown = true;
    }
    this.minH = mn;
    this.maxH = mx;
    const p   = this.mesh.position, size = q * sp;
    this.box.set( new THREE.Vector3( p.x, p.y + mn - sp * 8 - 2, p.z - size ), new THREE.Vector3( p.x + size, p.y + mx, p.z ) );
  }
  // ( the mask texture written at least once )
  private maskShown = false;

  dispose() {
    this.heightTex.dispose();
    this.sculptMaskTex.dispose();
    ( this.mesh.material as THREE.Material ).dispose();
  }
}
