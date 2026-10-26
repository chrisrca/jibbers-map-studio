// Painted pieces ( Texture Paint ): their paint as textures on their materials, uploaded as strokes go on.

import { float, saturate, texture as textureNode } from "three/tsl";
import * as THREE from "three/webgpu";
import { useEditor } from "../../../map/store";
import { pendingOf, pieceTexture } from "../../../texture/meshPaint";
import { redraw } from "../../redraw";
import { writeTextureRegion } from "../terrainRenderer";
import type { CustomObjectsRenderer } from "./index";
import { MaterialData } from "./index";

// Painted pieces' textures.
export class PiecePaint {
  constructor( private renderer: CustomObjectsRenderer ) {}

  // painted pieces' textures on the graphics card, by piece and channel ( "colour", "metallic", "roughness", "normal" )
  textures = new Map<string, { tex: THREE.DataTexture; stale: number }>();
  private materials = new Map<string, THREE.MeshStandardNodeMaterial>();
  pending = new Set<string>();

  /**
   * A channel's pixels of a piece's texture ( the normal map for "normal" ).
  **/
  private pixels( uid: string, ch: string ): Uint8Array | null {
    const T = pieceTexture( uid );
    if ( !T ) return null;
    if ( ch === "colour" ) return T.rgba;
    if ( ch === "normal" ) return T.normal;
    return T.ch[ch as "metallic" | "roughness"] ?? null;
  }

  /**
   * A channel of the piece's paint as a texture ( made, or brought up to date ).
  **/
  private texture( uid: string, ch = "colour" ): THREE.DataTexture | null {
    const T = pieceTexture( uid ), px = this.pixels( uid, ch );
    if ( !T || !px ) return null;
    const key = `${uid}|${ch}`;
    let p     = this.textures.get( key );
    if ( !p || p.tex.image.width !== T.n ) {
      const tex           = new THREE.DataTexture( px, T.n, T.n, THREE.RGBAFormat, THREE.UnsignedByteType );
      // colour as colour; the maps as values ( as the game reads them )
      tex.colorSpace      = ch === "colour" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.magFilter       = THREE.LinearFilter;
      tex.minFilter       = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy      = 8;
      tex.needsUpdate     = true;
      if ( ch === "colour" ) T.pending = null;
      this.textures.set( key, ( p = { tex, stale: 0 } ) );
    }
    return p.tex;
  }

  /**
   * Painted textures follow their dabs ( once a frame ); their smaller copies once a stroke rests.
  **/
  update() {
    const now = performance.now();
    if ( this.pending.size ) redraw();
    for ( const key of this.pending ) {
      const [uid, ch] = key.split( "|" );
      const T         = pieceTexture( uid ), p = this.textures.get( key ), px = this.pixels( uid, ch );
      if ( !T || !p || !px ) continue;
      if ( p.tex.image.width !== T.n ) {
        // a new size: new textures, and the piece's materials made again with them
        for ( const k of [...this.textures.keys() ] ) if ( k.startsWith( `${uid}|` ) ) { this.textures.get( k )!.tex.dispose(); this.textures.delete( k ); }
        for ( const k of [...this.materials.keys()] ) if ( k.startsWith( `${uid}|` ) ) this.materials.delete( k );
        queueMicrotask( () => this.rebuild( uid ) );
        continue;
      }
      const all    = pendingOf.get( T ) ?? {};
      const region = ch === "colour" ? T.pending : ch === "normal" ? "all" : all[ch as "metallic" | "roughness"] ?? null;
      if ( ch === "colour" ) T.pending = null;
      else if ( ch !== "normal" ) delete all[ch as "metallic" | "roughness"];
      if ( p.tex.image.data !== px ) {
        ( p.tex.image as { data: Uint8Array } ).data = px;
        p.tex.needsUpdate = true;
      } else if ( region && region !== "all" && writeTextureRegion( this.renderer.gpu, p.tex, px, T.n, 4, region ) ) p.stale = now;
      else if ( region ) p.tex.needsUpdate = true;
    }
    this.pending.clear();
    for ( const p of this.textures.values() )
      if ( p.stale && now - p.stale > 250 ) {
        p.tex.needsUpdate = true;
        p.stale           = 0;
      }
  }

  /**
   * A painted piece's material: its own, with the paint as its texture ( its colour tinting it ), and the maps painted
   * so far read as the game's shader reads them ( metallic = map + metallic, smoothness = 1 - map + smoothness ).
  **/
  material( uid: string, base: THREE.MeshStandardNodeMaterial, m: MaterialData ) {
    const tex = this.texture( uid );
    if ( !tex ) return base;
    const metal = this.texture( uid, "metallic" ), rough = this.texture( uid, "roughness" ), normal = this.texture( uid, "normal" );
    // ( made again whenever one of its textures is new: a resize or an undo of one makes new ones )
    const key   = `${uid}|${base.uuid}|${tex.uuid}|${metal?.uuid}|${rough?.uuid}|${normal?.uuid}`;
    let mat     = this.materials.get( key );
    if ( !mat ) {
      for ( const k of [...this.materials.keys()] ) if ( k.startsWith( `${uid}|${base.uuid}|` ) ) this.materials.delete( k );
      mat     = base.clone();
      mat.map = tex;
      if ( metal ) mat.metalnessNode = saturate( textureNode( metal ).r.add( m.metallic ) );
      if ( rough ) mat.roughnessNode = float( 1 ).sub( saturate( float( 1 ).sub( textureNode( rough ).r ).add( m.smoothness ) ) );
      if ( normal ) {
        mat.normalNode = null;
        mat.normalMap  = normal;
      }
      mat.needsUpdate = true;
      this.materials.set( key, mat );
    }
    return mat;
  }

  /**
   * Whether what the viewport draws on a painted piece is its texture as it is now ( for the self-tests ).
  **/
  showsPaint( uid: string ) {
    const T = pieceTexture( uid ), g = this.renderer.shown.get( uid )?.group;
    if ( !T || !g ) return false;
    const mats = g.children.flatMap( ( m ) => [( m as THREE.Mesh ).material].flat() ) as THREE.MeshStandardNodeMaterial[];
    return mats.length > 0 && mats.every( ( m ) => ( m.map?.image as { data?: Uint8Array } | undefined )?.data === T.rgba || this.pending.has( `${uid}|colour` ) );
  }

  rebuild( uid: string ) {
    const o = useEditor.getState().customObjects.find( ( x ) => x.uid === uid );
    const s = this.renderer.shown.get( uid );
    if ( !o || !s ) return;
    // ( a stand-in for what it was built from, so the piece itself counts as changed )
    s.data = { ...o };
    this.renderer.sync( useEditor.getState().customObjects, this.renderer.selection );
  }
}
