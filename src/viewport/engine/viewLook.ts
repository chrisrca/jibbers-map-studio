// The view's look: the Assets workspace's shading ( Blender's ) or the map's, the selection's outline, the stage swapped
// in for the map, and every shader made ready under the loading veil.

import OutlineNode from "three/addons/tsl/display/OutlineNode.js";
import { float, mix, nodeObject, pass, perspectiveDepthToViewZ, positionView, screenUV, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { useEditor, workspaceOf } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { redraw } from "../redraw";
import { BLENDER_BG } from "../render/stage";
import type { Engine } from "./engine";
import { CameraView } from "./engine";

// three's outline, its own pass over the whole scene for depth left out: the scene's own depth, as it was just drawn
// for the view, used instead ( drawn twice over, a busy map dragging a piece held the view to 60 fps ). That depth has
// the selection in it too: a selected piece is behind something where it's further than the scene's nearest by more
// than a little.
type Frame = THREE.NodeFrame;

type Inner = { _depthTextureUniform: { value: THREE.Texture; sample( uv: unknown ): unknown }; _cameraNear: unknown; _cameraFar: unknown; _prepareMaskMaterial: THREE.NodeMaterial; _prepareMaskSpriteMaterial: THREE.NodeMaterial };
class SceneDepthOutline extends OutlineNode {
  constructor( scene: THREE.Scene, camera: THREE.Camera, private view: ReturnType<typeof pass>, params: ConstructorParameters<typeof OutlineNode>[2] ) {
    super( scene, camera, params );
  }

  setup( builder: THREE.NodeBuilder ) {
    const out  = super.setup( builder );
    const self = this as unknown as Inner;
    const mask = () => {
      const viewZ  = perspectiveDepthToViewZ( self._depthTextureUniform.sample( screenUV ) as never, self._cameraNear as never, self._cameraFar as never );
      const behind = positionView.z.lessThan( viewZ.sub( viewZ.negate().mul( 0.002 ).max( 0.02 ) ) ).select( 1, 0 );
      return vec3( 0, behind, 1 );
    };
    self._prepareMaskMaterial.colorNode       = mask();
    self._prepareMaskMaterial.needsUpdate     = true;
    self._prepareMaskSpriteMaterial.colorNode = mask();
    return out;
  }

  updateBefore( frame: Frame ) {
    if ( !frame.renderer ) return super.updateBefore( frame );
    // ( the view drawn first, this frame, and its depth taken )
    frame.updateBeforeNode( this.view );
    const self = this as unknown as Inner, r = frame.renderer as THREE.WebGPURenderer, render = r.render;
    self._depthTextureUniform.value = ( this.view as unknown as { renderTarget: THREE.RenderTarget } ).renderTarget.depthTexture!;
    // ( the first scene drawn is three's depth pass: not drawn; the second its pass over the selection, with the
    // scene's matrices as the view just had them )
    let first = true;
    r.render  = function ( this: THREE.WebGPURenderer, ...a: Parameters<THREE.WebGPURenderer["render"]> ) {
      if ( first ) return void ( first = false );
      const scene = a[0], auto = scene.matrixWorldAutoUpdate;
      scene.matrixWorldAutoUpdate = false;
      try {
        return render.apply( this, a );
      } finally {
        scene.matrixWorldAutoUpdate = auto;
      }
    } as THREE.WebGPURenderer["render"];
    try {
      return super.updateBefore( frame );
    } finally {
      r.render = render;
    }
  }
}

// The view's look.
export class ViewLook {
  constructor( private engine: Engine ) {}

  // The render with selected pieces outlined ( made the first time ).
  private outline: { pipeline: THREE.RenderPipeline; selected: THREE.Object3D[]; scene: ReturnType<typeof pass> } | null = null;
  // the camera's view of each, kept for coming back to it
  private views:   { map:      CameraView | null; assets: CameraView | null } = { map: null, assets: null };

  /**
   * The Assets workspace's shading ( Blender's: Wireframe, Solid, Material Preview, Rendered ) and overlays; on the
   * map, the map's look.
  **/
  apply() {
    const st = useEditor.getState(), v = st.view3d, on = workspaceOf( st.tool ) === "assets";
    this.engine.daylight.sky ??= this.engine.scene.background as THREE.Texture;
    this.engine.daylight.fog ??= this.engine.scene.fog        as THREE.Fog;
    const game                   = v.shading === "material" || v.shading === "rendered";
    // ( a map with no terrain yet: Blender's grey round its floor, as the Assets workspace has it )
    // ( its time set: the sky, to see it by )
    const bare                   = !on && terrain.chunks.length === 0 && !( st.map?.overrideTime && this.engine.daylight.skyNode );
    this.engine.scene.background = bare ? new THREE.Color( BLENDER_BG ) : !on || game ? this.engine.daylight.sky : new THREE.Color( BLENDER_BG );
    // ( on a map, the game's own sky, drawn by its shader, when the game's there )
    ( this.engine.scene as unknown as { backgroundNode: unknown } ).backgroundNode = !bare && !on && this.engine.daylight.skyNode ? this.engine.daylight.skyNode : null;
    this.engine.scene.fog = bare ? null : !on || v.shading === "rendered" ? this.engine.daylight.fog : null;
    // Solid and Wireframe in Blender's plain colour ( its "Standard" view ); the game's look as the game's picture
    const tone            = on && !game ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    if ( this.engine.renderer.toneMapping !== tone ) {
      this.engine.renderer.toneMapping = tone;
      if ( this.outline ) this.outline.pipeline.needsUpdate = true;
    }
    this.engine.stage.setLook( v.shading === "rendered", v.overlays.grid );
    // ( Texture Paint shows the paint whatever the shading, as Blender's does )
    const paint = st.tool === "material" && st.materialMode === "paint" && !game;
    this.engine.customR.setLook( on ? { shading: paint ? "material" : v.shading, xray: v.xray && ( v.shading === "solid" || v.shading === "wire" ), faces: v.overlays.faceOrientation } : null );
  }

  outlined() {
    if ( !this.outline ) {
      const selected: THREE.Object3D[] = [];
      const scene                      = pass( this.engine.scene, this.engine.camera );
      const o                          = nodeObject( new SceneDepthOutline( this.engine.scene, this.engine.camera, scene, { selectedObjects: selected, edgeThickness: float( 1.4 ), downSampleRatio: 1 } ) ) as unknown as OutlineNode;
      const pipeline                   = new THREE.RenderPipeline( this.engine.renderer );
      // Blender's theme: selected objects orange, behind things fainter ( drawn over the scene, so it shows on snow too )
      const orange                     = vec3( 0.95, 0.33, 0.02 );
      pipeline.outputNode              = mix( mix( scene, orange, o.hiddenEdge.mul( 0.5 ).clamp( 0, 1 ) ), orange, o.visibleEdge.mul( 3 ).clamp( 0, 1 ) );
      this.outline                     = { pipeline, selected, scene };
    }
    const sel  = this.outline.selected, st = useEditor.getState();
    sel.length = 0;
    // ( not what's being edited: Edit Mode draws its own )
    if ( !this.engine.editing )
      for ( const x of st.selection ) {
        const g = x.kind === "custom" ? this.engine.customR.objectGroup( x.uid ) : null;
        if ( g ) sel.push( ...g.children );
      }
    return this.outline.pipeline;
  }

  /**
   * Every shader the view may need, made now ( under the loading veil ) rather than when its piece first comes into
   * view, which held frames up to a second ( looking round, scrolling out ): the whole scene whatever's in view or
   * hidden ( each level of detail, pieces far off ), made ready in the background, then drawn once each way it's drawn
   * — plain, and outlined as a selection draws it ( the outline's own passes over the scene set up only by drawing ),
   * each casting the sun's shadows.
  **/
  async compileAll() {
    const reveal = () => {
      const shown: THREE.Object3D[] = [], culled: THREE.Object3D[] = [];
      this.engine.scene.traverse( ( o ) => {
        if ( !o.visible ) {
          o.visible = true;
          shown.push( o );
        }
        if ( o.frustumCulled ) {
          o.frustumCulled = false;
          culled.push( o );
        }
      } );
      return () => {
        for ( const o of shown  ) o.visible       = false;
        for ( const o of culled ) o.frustumCulled = true;
      };
    };
    // ( what's to be made is listed as the call starts: everything put back straight after, not drawn all meanwhile )
    let restore = reveal(), made: Promise<void>;
    try {
      made = this.engine.renderer.compileAsync( this.engine.scene, this.engine.camera );
    } finally {
      restore();
    }
    await made;
    restore        = reveal();
    const pipeline = this.outlined(), selected = this.outline!.selected;
    try {
      // ( something selected, so the outline's passes run )
      selected.push( ...this.engine.customR.pickables().slice( 0, 1 ) );
      // ( the sun's shadows drawn each time too: drawn only when something's changed otherwise )
      const shadow       = this.engine.daylight.sun.shadow;
      shadow.needsUpdate = true;
      pipeline.render();
      shadow.needsUpdate = true;
      this.engine.renderer.render( this.engine.scene, this.engine.camera );
    } finally {
      selected.length = 0;
      restore();
      redraw();
    }
  }

  /**
   * The Assets workspace shows its own scene ( pieces/assetScene.ts ) on a floor at the origin; the map's hidden, and each
   * keeps its own view.
  **/
  syncStage( s: ReturnType<typeof useEditor.getState> ) {
    const want = workspaceOf( s.tool ) === "assets";
    if ( want === this.engine.stage.shown ) return;
    const c    = this.engine.controls, keep: CameraView = { target: c.target.clone(), distance: c.distance, yaw: c.yaw, pitch: c.pitch, flySpeed: c.flySpeed };
    const show = ( v: CameraView ) => {
      Object.assign( c, { distance: v.distance, yaw: v.yaw, pitch: v.pitch, flySpeed: v.flySpeed ?? c.flySpeed } );
      c.target.copy( v.target );
      c.apply();
    };
    this.apply();
    if ( want ) {
      this.views.map = keep;
      if ( s.railEdit ) useEditor.setState( { railEdit: null } );
      this.engine.stage.show( new THREE.Vector3( 0, 0, 0 ) );
      for ( const g of [this.engine.terrainR.group, this.engine.objectsR.group] ) g.visible = false;
      // ( Blender's opening view: down on the origin from front right )
      show( this.views.assets ?? { target: new THREE.Vector3( 0, 0.5, 0 ), distance: 12, yaw: Math.PI * 0.25, pitch: -0.45, flySpeed: 4 } );
    } else {
      this.views.assets = keep;
      this.engine.stage.hide();
      for ( const g of [this.engine.terrainR.group, this.engine.objectsR.group] ) g.visible = true;
      if ( this.views.map ) show( this.views.map );
    }
  }
}
