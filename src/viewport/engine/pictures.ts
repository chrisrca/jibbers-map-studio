// Pictures of the view: the asset browser's previews ( one at a time, between frames ) and captures for the self-tests.

import * as THREE from "three/webgpu";
import type { Engine } from "./engine";

// Previews and captures.
export class Pictures {
  constructor( private engine: Engine ) {}

  private previewQueue: Promise<unknown> = Promise.resolve();

  /**
   * Renders `obj` on its own, framed from a three-quarter view, to a PNG object URL ( asset browser previews ).
   * Previews render one at a time between viewport frames.
  **/
  renderPreview( obj: THREE.Object3D, width = 208, height = 152 ): Promise<string> {
    const job = this.previewQueue.then( async () => {
      await this.engine.ready;
      const scene                = new THREE.Scene();
      // the same reflections as the 3D view ( metal and glossy paint draw black without them )
      scene.environment          = this.engine.scene.environment;
      scene.environmentIntensity = this.engine.scene.environmentIntensity;
      scene.add( new THREE.HemisphereLight( 0xdfe9ff, 0x4a5260, 1.5 ) );
      const sun = new THREE.DirectionalLight( 0xffffff, 2.4 );
      sun.position.set( 3, 5, 4 );
      scene.add( sun, obj );
      obj.updateMatrixWorld( true );
      const s   = new THREE.Box3().setFromObject( obj ).getBoundingSphere( new THREE.Sphere() );
      const r   = Math.max( s.radius, 0.01 );
      const cam = new THREE.PerspectiveCamera( 30, width / height, r / 100, r * 20 );
      cam.position.copy( s.center ).addScaledVector( new THREE.Vector3( 1, 0.7, 1.2 ).normalize(), r * 3.2 );
      cam.lookAt( s.center );
      const rt    = new THREE.RenderTarget( width, height, { samples: 4 } );
      const clear = this.engine.renderer.getClearColor( new THREE.Color() );
      const alpha = this.engine.renderer.getClearAlpha();
      this.engine.renderer.setClearColor( 0x000000, 0 );
      this.engine.renderer.setRenderTarget( rt );
      this.engine.renderer.render( scene, cam );
      this.engine.renderer.setRenderTarget( null );
      this.engine.renderer.setClearColor( clear, alpha );
      const px = ( await this.engine.renderer.readRenderTargetPixelsAsync( rt, 0, 0, width, height ) ) as Uint8Array;
      rt.dispose();
      scene.remove( obj );
      const canvas = new OffscreenCanvas( width, height );
      const ctx    = canvas.getContext( "2d" )!;
      const img    = ctx.createImageData( width, height );
      // WebGPU pads each row of a readback to 256 bytes; copy row by row with the real stride
      const stride = Math.ceil( ( width * 4 ) / 256 ) * 256;
      for ( let y = 0; y < height; y++ ) img.data.set( px.subarray( y * stride, y * stride + width * 4 ), y * width * 4 );
      ctx.putImageData( img, 0, 0 );
      return URL.createObjectURL( await canvas.convertToBlob( { type: "image/png" } ) );
    } );
    this.previewQueue = job.catch( () => {} );
    return job;
  }

  /**
   * Renders the current view offscreen and returns PNG bytes ( used by the self-test ).
  **/
  async capture( width = 1280, height = 720 ): Promise<Uint8Array> {
    const rt   = new THREE.RenderTarget( width, height, { samples: 4 } );
    const cam  = this.engine.camera.clone();
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
    this.engine.terrainR.update( cam );
    // ( as the screen shows it: tone-mapped, in sRGB )
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.engine.renderer.setOutputRenderTarget( rt );
    this.engine.renderer.setRenderTarget( rt );
    this.engine.renderer.render( this.engine.scene, cam );
    this.engine.renderer.setRenderTarget( null );
    this.engine.renderer.setOutputRenderTarget( null );
    const px = ( await this.engine.renderer.readRenderTargetPixelsAsync( rt, 0, 0, width, height ) ) as Uint8Array;
    rt.dispose();
    const canvas = new OffscreenCanvas( width, height );
    const ctx    = canvas.getContext( "2d" )!;
    const img    = ctx.createImageData( width, height );
    const stride = Math.ceil( ( width * 4 ) / 256 ) * 256; // rows are padded to 256 bytes
    for ( let y = 0; y < height; y++ ) img.data.set( px.subarray( y * stride, y * stride + width * 4 ), y * width * 4 );
    // ( the sRGB target encodes again what the output step already encoded: undone once, the screen's values )
    const lut = Uint8Array.from( { length: 256 }, ( _, v ) => {
      const c = v / 255;
      return Math.round( 255 * ( c <= 0.04045 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4 ) );
    } );
    for ( let k = 0; k < img.data.length; k += 4 ) {
      img.data[k]     = lut[img.data[k]];
      img.data[k + 1] = lut[img.data[k + 1]];
      img.data[k + 2] = lut[img.data[k + 2]];
    }
    ctx.putImageData( img, 0, 0 );
    const blob = await canvas.convertToBlob( { type: "image/png" } );
    return new Uint8Array( await blob.arrayBuffer() );
  }
}
