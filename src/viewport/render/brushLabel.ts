// The sculpt brush's size and strength by the mouse ( "12 m · 50%" ), drawn in the view itself: as a page element over
// the view, moved every frame, it had the page put the whole view together again each frame ( a sculpt brush moved
// about missed one frame in seven on a busy park; none without it ). A flat label, the same size on screen wherever it
// is, just below and right of the mouse; its picture made again only when what it says changes.

import * as THREE from "three/webgpu";

// ( as the page's label was: its padding, its corners, its colours, its text size; CSS pixels )
const PAD_X = 7, PAD_Y = 2, CORNER = 4, TEXT = 10, LINE = 14;
const BG    = "rgba(24, 24, 24, .82)", HI = "#ffffff", DIM = "#a6a6a6";
// ( where it sits from the mouse, CSS pixels; the picture's size, room enough for what it says, so it's never made
// again at another size: a new picture is a new material, made on the frame )
const OFF_X = 18, OFF_Y = 14, W = 160, H = 16;

export class BrushLabel {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement( "canvas" );
  private tex    = new THREE.CanvasTexture( this.canvas );
  private said   = "";

  constructor() {
    const dpr                 = Math.min( 2, window.devicePixelRatio || 1 );
    this.canvas.width         = W * dpr;
    this.canvas.height        = H * dpr;
    this.tex.colorSpace       = THREE.SRGBColorSpace;
    this.tex.minFilter        = THREE.LinearFilter;
    this.tex.generateMipmaps  = false;
    // ( its colours as they are: not tone-mapped nor fogged as the map is )
    const mat                 = new THREE.SpriteNodeMaterial( { map: this.tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false } );
    this.sprite               = new THREE.Sprite( mat );
    this.sprite.renderOrder   = 2000;
    this.sprite.frustumCulled = false;
    this.sprite.visible       = false;
    // ( not something to pick )
    this.sprite.raycast       = () => {};
  }

  /**
   * Shown at `at` ( the ground under the mouse, the 3D view ) saying `main` and, fainter, `more`; or hidden ( null ).
  **/
  show( at: THREE.Vector3 | null, main: string, more: string, camera: THREE.PerspectiveCamera, viewH: number ) {
    this.sprite.visible = !!at;
    if ( !at ) return;
    const said = `${main}|${more}`;
    if ( said !== this.said ) this.draw( ( this.said = said ), main, more );
    // ( a screen size: three draws a sprite that doesn't shrink with distance as this many units a unit away )
    const k = ( 2 * Math.tan( THREE.MathUtils.degToRad( camera.fov ) / 2 ) ) / Math.max( 1, viewH );
    this.sprite.position.copy( at );
    this.sprite.scale.set( W * k, H * k, 1 );
    // ( its corner OFF_X right of and OFF_Y below the mouse )
    this.sprite.center.set( -OFF_X / W, 1 + OFF_Y / H );
  }

  private draw( _key: string, main: string, more: string ) {
    const c    = this.canvas, g = c.getContext( "2d" )!, dpr = c.width / W;
    const font = `${TEXT}px Inter, system-ui, sans-serif`;
    g.setTransform( dpr, 0, 0, dpr, 0, 0 );
    g.clearRect( 0, 0, W, H );
    g.font     = font;
    const wm   = g.measureText( main ).width, wr = g.measureText( more ).width;
    const w    = Math.min( W, Math.ceil( wm + wr + PAD_X * 2 ) ), h = Math.min( H, LINE + PAD_Y * 2 - 2 );
    g.fillStyle = BG;
    g.beginPath();
    g.roundRect( 0, 0, w, h, CORNER );
    g.fill();
    g.textBaseline = "middle";
    g.fillStyle    = HI;
    g.fillText( main, PAD_X, h / 2 );
    g.fillStyle    = DIM;
    g.fillText( more, PAD_X + wm, h / 2 );
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    ( this.sprite.material as THREE.Material ).dispose();
  }
}
