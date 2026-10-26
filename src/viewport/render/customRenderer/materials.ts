// Pieces' materials as the game's shader draws them ( Custom/CustomObjectLit ): their textures read as the game reads
// them, metallic and smoothness, the snow overlay, alpha; shared between pieces and made once.

import { dot, float, materialColor, mix, normalMap, normalWorld, saturate, smoothstep, sqrt, texture as textureNode, vec2, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { ipc, joinPath } from "../../../core/ipc";
import { materialOverlay } from "../../../core/overlay";
import { withLamps } from "../lamps";
import type { CustomObjectsRenderer } from "./index";
import { MaterialData } from "./index";

// Pieces' materials.
export class PieceMaterials {
  constructor( private renderer: CustomObjectsRenderer ) {}

  images = new Map<string, Promise<ImageBitmap | null>>();
  mats   = new Map<string, THREE.MeshStandardNodeMaterial>();
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
   * The viewport material for a game material ( shared and cached; don't dispose it ).
  **/
  async material( m: MaterialData ): Promise<THREE.MeshStandardNodeMaterial> {
    const normalTex = ( m.normal_tex   as string | undefined ) ?? "", glowTex  = ( m.emission_tex  as string | undefined ) ?? "";
    const metalTex  = ( m.metallic_tex as string | undefined ) ?? "", roughTex = ( m.roughness_tex as string | undefined ) ?? "";
    const key       = JSON.stringify( [m.base_tex, normalTex, glowTex, metalTex, roughTex, m.render_mode, m.alpha_cutoff, m.tiling, m.offset, m.cull_mode, m.base_color, m.emission_color, m.metallic, m.smoothness, materialOverlay( m )] );
    const cached    = this.mats.get( key );
    if ( cached ) return cached;
    const [bmp, normalBmp, glowBmp, metalBmp, roughBmp] = await Promise.all( [this.image( m.base_tex ), this.image( normalTex, true ), this.image( glowTex ), this.image( metalTex ), this.image( roughTex )] );
    const again = this.mats.get( key ); // another part may have built it meanwhile
    if ( again ) return again;
    // each texture read the way the game reads it: as colour ( sRGB ) or as plain values
    const linear = ( await this.renderer.index )?.linear ?? {};
    const srgb   = ( k: string, colour: boolean ) => ( k in linear ? !linear[k] : colour );
    const c      = m.base_color;
    const mat    = new THREE.MeshStandardNodeMaterial( {
      color:     new THREE.Color().setRGB( c.r, c.g, c.b, THREE.SRGBColorSpace ),
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
    // the game's snow/colour overlay on surfaces facing a direction ( see core/overlay.ts )
    const ov = materialOverlay( m );
    if ( ov ) {
      const dir     = vec3( ov.direction[0], ov.direction[1], -ov.direction[2] ).normalize(); // Unity → three
      const f       = smoothstep( ov.amount - ov.sharpness, ov.amount + ov.sharpness, dot( normalWorld, dir ) ).mul( ov.intensity );
      mat.colorNode = mix( materialColor, vec3( ...ov.color ), f );
    }
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
