// Pieces' materials as the game's shader draws them ( Custom/CustomObjectLit ): their textures read as the game reads
// them, metallic and smoothness, the snow overlay, alpha; shared between pieces and made once.

import { abs, dot, float, fract, materialColor, max, min, mix, normalMap, normalWorld, pow, saturate, select, smoothstep, sqrt, sRGBTransferEOTF, sRGBTransferOETF, step, texture as textureNode, uniform, vec2, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import type { adjustOf } from "../../../core/types";
import { ipc, joinPath } from "../../../core/ipc";
import { materialOverlay } from "../../../core/overlay";
import { withLamps } from "../lamps";
import type { CustomObjectsRenderer } from "./index";
import { MaterialData } from "./index";

/**
 * A colour turned round the colour wheel by `turn` ( 0..1 ) as the game's own features are ( Custom/MapObject's
 * _HueShift ): to HSV as it gets it, in linear light, the hue moved, back. A piece's Hue is baked into its textures that
 * way on export ( project/hue.rs ), so the view and the game show the same. ( `turn` a uniform: every Hue the same
 * shader, nothing compiled as the slider's dragged. )
**/
const hueTurn = ( c: Node<"vec3">, turn: Node<"float"> ) => {
  const p = mix( vec4( c.b, c.g, -1, 2 / 3 ), vec4( c.g, c.b, 0, -1 / 3 ), step( c.b, c.g ) );
  const q = mix( vec4( p.x, p.y, p.w, c.r ), vec4( c.r, p.y, p.z, p.x ), step( p.x, c.r ) );
  const d = q.x.sub( min( q.w, q.y ) );
  const h = fract( abs( q.z.add( q.w.sub( q.y ).div( d.mul( 6 ).add( 1e-10 ) ) ) ).add( turn ) );
  const s = d.div( q.x.add( 1e-10 ) );
  const k = saturate( abs( fract( vec3( h ).add( vec3( 1, 2 / 3, 1 / 3 ) ) ).mul( 6 ).sub( 3 ) ).sub( 1 ) );
  return mix( vec3( 1 ), k, s ).mul( q.x );
};

/**
 * A material lit as the ground is: the sun and the sky's colours, not the sky's reflections ( a map's surroundings: lit
 * as pieces are, all round by the sky besides, they came out brighter and bluer than the snow they meet ).
**/
class GroundLit extends THREE.MeshStandardNodeMaterial {
  setupEnvironment(): THREE.EnvironmentNode | null {
    return null;
  }
}

/**
 * A piece's paint adjusted ( project/hue.rs bakes it the same for the game ): its Hue first ( hueTurn, in linear light ),
 * then, in sRGB as Photoshop has them, Brightness ( a curve: dark and light ends kept ), Contrast ( about the middle ),
 * Saturation ( from its grey, the luma ) and Lightness ( towards white, or black ). Each a uniform: every setting the
 * same shader, nothing compiled as a slider's dragged.
**/
export const adjusted = ( c: Node<"vec3">, a: NonNullable<ReturnType<typeof adjustOf>> ) => {
  const turned = a.hue ? hueTurn( c, uniform( a.hue ) ) : c;
  if ( !a.saturation && !a.lightness && !a.brightness && !a.contrast ) return turned;
  const b = uniform( a.brightness ), k = uniform( a.contrast ), s = uniform( a.saturation ), l = uniform( a.lightness );
  let x   = ( sRGBTransferOETF( vec4( turned, 1 ) ) as unknown as Node<"vec4"> ).rgb;
  x       = pow( max( x, vec3( 0 ) ), vec3( float( 1 ).sub( b.mul( 0.6 ) ) ) );
  x       = x.sub( 0.5 ).mul( k.add( 1 ) ).add( 0.5 );
  x       = mix( vec3( dot( x, vec3( 0.299, 0.587, 0.114 ) ) ), x, s.add( 1 ) );
  x       = saturate( select( l.greaterThan( 0 ), mix( x, vec3( 1 ), l ), x.mul( l.add( 1 ) ) ) );
  return ( sRGBTransferEOTF( vec4( x, 1 ) ) as unknown as Node<"vec4"> ).rgb;
};

// Pieces' materials.
export class PieceMaterials {
  constructor( private renderer: CustomObjectsRenderer ) {}

  images = new Map<string, Promise<ImageBitmap | null>>();
  mats   = new Map<string, THREE.MeshStandardNodeMaterial>();
  // ( each material as it's being made, by its key: pieces built at once, a map's trees, share the one made for the
  // first, not one each )
  making = new Map<string, Promise<THREE.MeshStandardNodeMaterial>>();
  // textures by image, colour space and placing: materials using the same picture share one copy on the GPU
  texs   = new Map<string, THREE.Texture>();

  /**
   * A texture's image; `data`: its values as stored ( a normal map's: not premultiplied by its alpha, which holds X ).
  **/
  private image( key: string, data = false ): Promise<ImageBitmap | null> {
    if ( !key ) return Promise.resolve( null );
    const at = data ? `data|${key}` : key;
    let p    = this.images.get( at );
    if ( !p ) {
      p = this.renderer.index.then( ( index ) => {
        const file = index?.textures[key];
        return file
          ? ipc
              .readBinary( joinPath( index!.dir, file ) )
            // flipped so the bitmap's first row is the bottom of the image: with flipY off, v = 0 is the bottom
            // like in Unity ( WebGPU ignores Texture.flipY for bitmaps )
              .then( ( buf ) => createImageBitmap( new Blob( [buf], { type: "image/png" } ), data ? { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" } : { imageOrientation: "flipY" } ) )
              .catch( ( err ) => {
                console.warn( "custom texture failed", key, err );
                return null;
              } )
          : null;
      } );
      this.images.set( at, p );
      p.then( ( b ) => !b && this.images.get( at ) === p && this.images.delete( at ) );
    }
    return p;
  }

  /**
   * The viewport material for a game material ( shared and cached; don't dispose it ); `adjust`: its piece's paint
   * adjusted ( adjustOf ); `ground`: lit as the ground is ( GroundLit: a map's surroundings ).
  **/
  material( m: MaterialData, adjust: ReturnType<typeof adjustOf> = null, ground = false ): Promise<THREE.MeshStandardNodeMaterial> {
    const normalTex = ( m.normal_tex   as string | undefined ) ?? "", glowTex  = ( m.emission_tex  as string | undefined ) ?? "";
    const metalTex  = ( m.metallic_tex as string | undefined ) ?? "", roughTex = ( m.roughness_tex as string | undefined ) ?? "";
    const key       = JSON.stringify( [m.base_tex, normalTex, glowTex, metalTex, roughTex, m.render_mode, m.alpha_cutoff, m.tiling, m.offset, m.cull_mode, m.base_color, m.emission_color, m.metallic, m.smoothness, materialOverlay( m ), adjust, ground] );
    const cached    = this.mats.get( key );
    if ( cached ) return Promise.resolve( cached );
    let made        = this.making.get( key );
    if ( !made ) {
      made = this.make( m, key, normalTex, glowTex, metalTex, roughTex, adjust, ground ).finally( () => this.making.delete( key ) );
      this.making.set( key, made );
    }
    return made;
  }

  private async make( m: MaterialData, key: string, normalTex: string, glowTex: string, metalTex: string, roughTex: string, adjust: ReturnType<typeof adjustOf>, ground: boolean ): Promise<THREE.MeshStandardNodeMaterial> {
    const [bmp, normalBmp, glowBmp, metalBmp, roughBmp] = await Promise.all( [this.image( m.base_tex ), this.image( normalTex, true ), this.image( glowTex ), this.image( metalTex ), this.image( roughTex )] );
    // each texture read the way the game reads it: as colour ( sRGB ) or as plain values
    const linear = ( await this.renderer.index )?.linear ?? {};
    const srgb   = ( k: string, colour: boolean ) => ( k in linear ? !linear[k] : colour );
    const c      = m.base_color;
    const mat    = new ( ground ? GroundLit : THREE.MeshStandardNodeMaterial )( {
      // ( a map's surroundings as their texture paints them: their colour is the export's tint, for the game's light,
      // geo/scenery/inner.ts tintFor )
      color:     ground ? new THREE.Color( 1, 1, 1 ) : new THREE.Color().setRGB( c.r, c.g, c.b, THREE.SRGBColorSpace ),
      roughness: 1 - m.smoothness,
      metalness: m.metallic,
      side:      m.cull_mode === 0 ? THREE.DoubleSide : m.cull_mode === 1 ? THREE.BackSide : THREE.FrontSide,
    } );
    const e = m.emission_color;
    if ( e.r + e.g + e.b > 0 ) mat.emissive = new THREE.Color().setRGB( e.r, e.g, e.b, THREE.SRGBColorSpace );
    const texture = ( imageKey: string, b: ImageBitmap, colour: boolean ) => {
      const k = `${imageKey}|${colour}|${m.tiling.x},${m.tiling.y}|${m.offset.x},${m.offset.y}`;
      let tex = this.texs.get( k );
      if ( tex ) return tex;
      tex            = new THREE.Texture( b );
      tex.flipY      = false;
      tex.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS      = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set( m.tiling.x, m.tiling.y );
      tex.offset.set( m.offset.x, m.offset.y );
      tex.anisotropy  = 8;
      tex.needsUpdate = true;
      this.texs.set( k, tex );
      return tex;
    };
    if ( bmp ) mat.map = texture( m.base_tex, bmp, srgb( m.base_tex, true ) );
    if ( normalBmp ) {
      // read as Unity's UnpackNormal reads it: X from alpha × red, Y from green, Z made up. That's right for plain
      // normal maps ( alpha 1 ) and for DXT5nm ones ( red 1, X kept in the alpha ), as many of the maps' pieces have:
      // read as RGB, those lean every normal one way and the overlay's snow lands on the sides.
      // ( no flip for the mirroring from Unity's space: without tangents, three works the surface's directions out
      // from the mesh and its texture coordinates as drawn, which takes the mirroring with it )
      const t        = textureNode( texture( `data|${normalTex}`, normalBmp, srgb( normalTex, false ) ) );
      const xy       = vec2( t.a.mul( t.r ), t.g ).mul( 2 ).sub( 1 );
      mat.normalNode = normalMap( vec3( xy, sqrt( saturate( float( 1 ).sub( dot( xy, xy ) ) ) ) ).mul( 0.5 ).add( 0.5 ) );
    }
    // as the game draws pieces ( Custom/CustomObjectLit ): metallic = map + number, smoothness = 1 − map + number, each
    // kept to 0..1 ( without a map, just the number ). With the number 0 ( the game's features come converted that way )
    // that's three's own map times 1 — the same shader for every such material, so it isn't made again for each ( the
    // maps are grey: the channel three reads holds the same value ); only a map with a number besides needs its own.
    if ( metalBmp ) {
      const tex = texture( metalTex, metalBmp, srgb( metalTex, false ) );
      if ( m.metallic === 0 ) { mat.metalnessMap = tex; mat.metalness = 1; }
      else mat.metalnessNode = saturate( textureNode( tex ).r.add( m.metallic ) );
    }
    if ( roughBmp ) {
      const tex = texture( roughTex, roughBmp, srgb( roughTex, false ) );
      if ( m.smoothness === 0 ) { mat.roughnessMap = tex; mat.roughness = 1; }
      else mat.roughnessNode = float( 1 ).sub( saturate( float( 1 ).sub( textureNode( tex ).r ).add( m.smoothness ) ) );
    }
    if ( glowBmp ) {
      mat.emissiveMap = texture( glowTex, glowBmp, srgb( glowTex, true ) );
      mat.emissive    = new THREE.Color().setRGB( e.r, e.g, e.b, THREE.SRGBColorSpace );
    }
    // its piece's paint adjusted ( on its texture times its colour, as baked ), then the game's snow/colour overlay on
    // surfaces facing a direction ( see core/overlay.ts )
    // ( a texture's alpha with it: the colour is its map times the material's colour )
    const base  = vec4( materialColor as unknown as Node<"vec4"> );
    const paint = adjust ? adjusted( base.rgb, adjust ) : null;
    const ov    = materialOverlay( m );
    if ( ov ) {
      const dir     = vec3( ov.direction[0], ov.direction[1], -ov.direction[2] ).normalize(); // Unity → three
      const f       = smoothstep( ov.amount - ov.sharpness, ov.amount + ov.sharpness, dot( normalWorld, dir ) ).mul( ov.intensity );
      mat.colorNode = vec4( mix( paint ?? base.rgb, vec3( ...ov.color ), f ), base.a );
    } else if ( paint ) mat.colorNode = vec4( paint, base.a );
    if ( m.render_mode === 1 ) mat.alphaTest = m.alpha_cutoff;
    if ( m.render_mode === 2 ) {
      mat.transparent = true;
      mat.opacity     = c.a;
      mat.depthWrite  = false;
    }
    // ( the map's lamps on it, by night )
    withLamps( mat );
    this.mats.set( key, mat );
    return mat;
  }
}
