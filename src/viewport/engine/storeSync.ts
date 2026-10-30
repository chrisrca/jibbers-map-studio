// The view following the editor's state: on each change, what it touches redrawn or made again ( the objects
// and pieces, the gizmo, Edit Mode, the stage, the tools, the time of day, a rail being edited… ).

import { useEditor, workspaceOf, type EditorState } from "../../map/store";
import { pieceTexture, prepare } from "../../texture/meshPaint";
import { redraw } from "../redraw";
import type { Engine } from "./engine";

export class StoreSync {
  constructor( private engine: Engine ) {}

  /**
   * The editor's state changed from `prev` to `s`.
  **/
  onChange( s: EditorState, prev: EditorState ) {
    redraw();
    if ( s.objects       !== prev.objects       || s.spawns !== prev.spawns || s.selection !== prev.selection || s.chunkExtras !== prev.chunkExtras || s.hiddenInView !== prev.hiddenInView ) this.engine.syncObjects();
    if ( s.chunkExtras   !== prev.chunkExtras   ) this.engine.syncRepeats();
    if ( s.objects       !== prev.objects       || s.customObjects !== prev.customObjects ) this.engine.lights.sync();
    if ( s.map           !== prev.map           || s.tool !== prev.tool ) this.engine.daylight.applyTime();
    // ( the game's look read again, with the asset list: its lights too )
    if ( s.assetLibrary  !== prev.assetLibrary  ) this.engine.lights.reload();
    if ( s.selection     !== prev.selection     || s.tool !== prev.tool || s.locked !== prev.locked || s.modelTool !== prev.modelTool || s.modelEdit !== prev.modelEdit || s.materialMode !== prev.materialMode || s.view3d !== prev.view3d || ( ( s.customObjects !== prev.customObjects || s.trails !== prev.trails || s.trailHandle !== prev.trailHandle ) && !this.engine.blGizmo?.dragging ) ) this.engine.gizmo.sync();
    // a painted piece whose shape changed: its paint carried across to the new shape
    if ( s.customObjects !== prev.customObjects )
      for ( const o of s.customObjects ) {
        if ( !o.model?.paint || !pieceTexture( o.uid ) ) continue;
        const was = prev.customObjects.find( ( x ) => x.uid === o.uid );
        if ( was?.model !== o.model && !this.engine.meshPainter?.painting ) queueMicrotask( () => {
          const now = useEditor.getState().customObjects.find( ( x ) => x.uid === o.uid );
          if ( now?.model?.paint ) prepare( now as typeof now & { model: NonNullable<typeof now.model> } );
        } );
      }
    // Edit Mode follows its piece ( an undo, a move ) and ends with the workspace or the piece
    if ( this.engine.modelEd?.uid ) {
      if ( s.tool !== "model" || !s.customObjects.some( ( o ) => o.uid === this.engine.modelEd.uid && o.model && !o.model.curve ) ) this.engine.modelEd.exit();
      else if ( s.customObjects !== prev.customObjects && !this.engine.modelEd.modal ) this.engine.modelEd.sync();
    }
    if ( this.engine.curveEd?.uid ) {
      if ( s.tool !== "model" || !s.customObjects.some( ( o ) => o.uid === this.engine.curveEd.uid && o.model?.curve ) ) this.engine.curveEd.exit();
      else if ( s.customObjects !== prev.customObjects && !this.engine.curveEd.modal ) this.engine.curveEd.sync();
    }
    if ( s.placeId       !== prev.placeId       ) this.engine.placing.updateGhostGeometry();
    if ( s.projectDir    !== prev.projectDir    && s.projectDir ) this.engine.veil.arm();
    if ( s.customObjects !== prev.customObjects || s.projectDir !== prev.projectDir || s.selection !== prev.selection ) this.engine.syncCustom();
    if ( s.tool          !== prev.tool          ) this.engine.look.syncStage( s );
    // ( the Assets workspace navigates as Blender does )
    this.engine.controls.blender = workspaceOf( s.tool ) === "assets";
    // the Outliner's eye ( H ): hidden in the view ( each workspace's scene has its own )
    if ( s.hiddenInView !== prev.hiddenInView || s.customObjects !== prev.customObjects )
      this.engine.customR.showOnly( Object.keys( s.hiddenInView ).length ? new Set( s.customObjects.filter( ( o ) => !s.hiddenInView[o.uid] ).map( ( o ) => o.uid ) ) : null );
    if ( s.view3d      !== prev.view3d      || s.materialMode !== prev.materialMode ) this.engine.look.apply();
    if ( s.terrainView !== prev.terrainView ) this.engine.ground.applyTerrainView();
    if ( s.shapes      !== prev.shapes      || s.selection !== prev.selection || s.tool !== prev.tool || s.locked !== prev.locked ) this.engine.shapeTool?.sync();
    if ( s.trails      !== prev.trails      || s.selection !== prev.selection || s.tool !== prev.tool || s.trailHandle !== prev.trailHandle ) this.engine.trailTool?.sync();
    if ( s.objects     !== prev.objects     || s.selection !== prev.selection || s.tool !== prev.tool ) this.engine.liftTool?.sync();
    // ( a handle's for the gizmo while its point or run is picked )
    if ( s.trailHandle && ( s.selection !== prev.selection || s.tool !== "trail" ) ) useEditor.setState( { trailHandle: null } );
    // ( into Terrain Mode: the trails' looks made ready before the Trails tool is picked )
    if ( workspaceOf( s.tool ) === "sculpting" && workspaceOf( prev.tool ) !== "sculpting" ) this.engine.trailTool?.warmUp( this.engine.renderer, this.engine.camera, this.engine.scene );
    // picking something else ends editing a rail
    // editing a rail's points: scale does nothing to a point, so it's Move; the gizmo set up for Move or Rotate
    // ( the switch comes back through here )
    if ( s.railEdit && s.gizmoMode === "scale" ) useEditor.setState( { gizmoMode: "translate" } );
    else if ( s.gizmoMode !== prev.gizmoMode ) {
      if ( s.railEdit ) this.engine.rails.sync();
      else this.engine.gizmo.sync();
    }
    // ( that change comes back through here: the rest is done then )
    if ( s.railEdit && s.selection !== prev.selection && !s.selection.some( ( x ) => x.uid === s.railEdit!.uid ) ) useEditor.setState( { railEdit: null } );
    else {
      if ( s.railEdit    !== prev.railEdit || ( s.railEdit && s.customObjects !== prev.customObjects ) || s.tool !== prev.tool ) this.engine.rails.sync();
      // done editing one: its parts fitted again round where the rail now runs ( a rail drawn by hand leaves its tube )
      if ( prev.railEdit && prev.railEdit.uid !== s.railEdit?.uid ) void this.engine.rails.refitParts( prev.railEdit.uid );
    }
  }
}
