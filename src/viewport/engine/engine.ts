// The 3D view: its renderer, scene and camera, what's drawn, the frame loop and picking. Its parts ( the mouse, the
// keys, placing, the gizmo, the time of day… ) are each in a file beside this one.

import * as THREE from "three/webgpu";
import { toUnity, type V3 } from "../../core/coords";
import { ipc } from "../../core/ipc";
import { useEditor, type Selection } from "../../map/store";
import { onPaintChange } from "../../paint/ground";
import { onGrowPreview } from "../../terrain/mapSize";
import { repeatedChunks, useRepeatPreview } from "../../terrain/repeats";
import { imprintOf, type StampGrid } from "../../terrain/shapes/shapes";
import { terrain } from "../../terrain/terrain";
import { CameraController } from "../cameraControls";
import { CurveEditor } from "../edit/curve/curveEditor";
import { MeshPainter } from "../edit/meshPainter";
import { ModelEditor } from "../edit/model/modelEditor";
import { redraw, takeRedraw } from "../redraw";
import { CustomObjectsRenderer } from "../render/customRenderer";
import { ObjectsRenderer, PlaceholderLibrary } from "../render/objectsRenderer";
import { SceneLights } from "../render/sceneLights";
import { Stage } from "../render/stage";
import { TerrainRenderer, type GpuAccess } from "../render/terrainRenderer";
import { BlGizmo } from "../tools/gizmo/blGizmo";
import { LiftTool } from "../tools/liftTool";
import { RailTool } from "../tools/railTool";
import { ShapeTool } from "../tools/shapeTool";
import { TrailTool } from "../tools/trail/trailTool";
import { CameraMoves } from "./cameraMoves";
import { Daylight } from "./daylight";
import { GizmoControl } from "./gizmo";
import { GroundLook } from "./groundLook";
import { GrowPreviewMeshes } from "./growPreview";
import { ViewportInput } from "./input";
import { ViewportKeys } from "./keys";
import { LoadingVeil } from "./loadingVeil";
import { MapLights } from "./mapLights";
import { MapTrees } from "./mapTrees";
import { ViewportMenus } from "./menus";
import { Modelling } from "./modelling";
import { Pictures } from "./pictures";
import { Placing } from "./placing";
import { RailEditing } from "./railEditing";
import { StoreSync } from "./storeSync";
import { ViewLook } from "./viewLook";

// How far round a click ( pixels ) a thin thing missed by it is still picked: the nearest ring first.
const PICK_RINGS = [3, 6];

// Where the camera looks from ( orbit target, distance, turn ), with its own fly speed ( metres a second suit a
// piece, tens of them a mountain ).
export type CameraView = { target: THREE.Vector3; distance: number; yaw: number; pitch: number; flySpeed?: number };

export class Engine {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene  = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera( 55, 1, 0.1, 30000 );
  controls!: CameraController;
  ready:     Promise<void>;
  // kept once the view's been drawn the first time
  readonly firstDrawn: Promise<void>;
  private drewFirst: () => void = () => {};

  // its parts, each in a file of its own beside this one
  readonly input       = new ViewportInput( this ); // the mouse and pen, and the strokes they make
  readonly keys        = new ViewportKeys( this );  // the keys pressed over the view
  readonly nav         = new CameraMoves( this );   // the camera moved: framing, the numpad's views, the navigation gizmo
  readonly placing     = new Placing( this );       // things put down on the map, and their ghosts
  readonly gizmo       = new GizmoControl( this );  // the transform gizmo: where it sits, what its drags do
  readonly rails       = new RailEditing( this );   // a piece's grind rail being edited
  readonly menus       = new ViewportMenus( this ); // Object, Add, Move to Collection, and their operators
  readonly modelling   = new Modelling( this );     // operators on whole modelled pieces
  readonly look        = new ViewLook( this );      // the shading, the selection's outline, shaders made ready
  readonly daylight    = new Daylight( this );      // the sun, sky and reflections for the map's time of day
  readonly lights      = new MapLights( this );     // the map's lights, from its features and pieces
  readonly veil        = new LoadingVeil( this );   // the loading veil while a map's pieces are built
  readonly trees       = new MapTrees( this );      // the trees that came with the map
  readonly ground      = new GroundLook( this );    // the ground's textures and overlays
  readonly growPreview = new GrowPreviewMeshes();   // new ground being previewed ( Map Size )
  readonly pictures    = new Pictures( this );      // previews for the asset browser, captures for the self-tests
  readonly storeSync   = new StoreSync( this );     // the view following the editor's state

  // what's drawn, and the tools in the view
  terrainR!: TerrainRenderer;
  objectsR!: ObjectsRenderer;
  readonly customR     = new CustomObjectsRenderer();
  // the map's lights ( its floodlights, snow cannons, pieces' own ), on once it's dark
  readonly sceneLights = new SceneLights();
  lib!:         PlaceholderLibrary;
  // Edit Mode on a modelled piece
  modelEd!:     ModelEditor;
  // Edit Mode on a curve piece
  curveEd!:     CurveEditor;
  // Texture Paint on a modelled piece
  meshPainter!: MeshPainter;
  /**
   * whichever Edit Mode is on ( a mesh's or a curve's )
  **/
  get editing() {
    return this.modelEd?.uid ? this.modelEd : this.curveEd?.uid ? this.curveEd : null;
  }
  // Blender's gizmo: Move / Rotate / Scale on the selection, and on what the tools pick
  blGizmo!:   BlGizmo;
  shapeTool!: ShapeTool;
  trailTool!: TrailTool;
  liftTool!:  LiftTool;
  // a piece's grind rail being edited ( Properties › Rail › Edit points )
  readonly railTool                 = new RailTool();
  // the mouse
  mouse                             = new THREE.Vector2();
  mouseInside                       = false;
  // the ground under the mouse
  cursorWorld: THREE.Vector3 | null = null;
  // project the view was last framed for ( see the layout listener )
  private framedDir: string | null  = null;
  private clock                     = new THREE.Timer();
  private unsub: ( () => void )[]   = [];
  onStats?: ( s: { fps: number; tiles: number; visible: number; triangles: number; cursor: V3 | null; slope: number | null } ) => void;
  private frames = 0;
  private fpsT   = 0;
  constructor( readonly host: HTMLElement ) {
    this.firstDrawn = new Promise( ( r ) => ( this.drewFirst = r ) );
    this.renderer   = new THREE.WebGPURenderer( { antialias: true, powerPreference: "high-performance" } );
    this.renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
    this.renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    host.appendChild( this.renderer.domElement );
    Object.assign( this.renderer.domElement.style, { display: "block", position: "absolute", inset: "0", width: "100%", height: "100%", touchAction: "none" } );
    this.renderer.domElement.tabIndex = 0;
    this.ready                        = this.init();
  }
  private async init() {
    await this.renderer.init();
    this.daylight.init();
    this.lights.reload();
    // ( the ground's shader made ahead, after the first frames: a new map's first ground doesn't wait for it )
    setTimeout( () => void this.terrainR?.warmUp( this.renderer, this.camera, this.scene ).catch( ( e ) => console.warn( "terrain warm-up", e ) ), 1500 );

    const { libraryDir, placeholders } = useEditor.getState();
    this.lib                           = new PlaceholderLibrary( libraryDir, placeholders );
    this.terrainR                      = new TerrainRenderer( terrain, ( p ) => this.ground.loadMask( p ) );
    const backend                      = ( this.renderer as unknown as { backend: { device?: GpuAccess["device"]; get( o: object ): { texture?: unknown } } } ).backend;
    if ( backend.device ) this.terrainR.gpu = { device: backend.device, textureOf: ( t ) => backend.get( t ).texture };
    this.modelEd = new ModelEditor( {
      camera: this.camera,
      host:   this.host,
      ray:    ( x, y ) => this.ray( x, y ),
      menu:   ( x, y, title, items ) => window.dispatchEvent( new CustomEvent( "viewport-menu", { detail: { x, y, title, items } } ) ),
      // other pieces first ( nearest ), else the ground
      surfaceAt: ( x, y, skip ) => {
        const hits = this.ray( x, y ).intersectObjects( [...this.objectsR.pickables(), ...this.customR.pickables()], false );
        const h    = hits.find( ( x2 ) => ( x2.object.userData as { uid?: string } ).uid !== skip );
        const t    = this.pickTerrain( x, y );
        if ( h && ( !t || h.distance < t.distanceTo( this.camera.position ) ) ) return h.point.clone();
        return t;
      },
    } );
    this.scene.add( this.modelEd.group );
    this.curveEd = new CurveEditor(
      {
        camera: this.camera,
        host:   this.host,
        ray:    ( x, y ) => this.ray( x, y ),
        menu:   ( x, y, title, items ) => window.dispatchEvent( new CustomEvent( "viewport-menu", { detail: { x, y, title, items } } ) ),
      },
      ( x, y ) => this.pickTerrain( x, y ),
    );
    this.scene.add( this.curveEd.group );
    this.meshPainter = new MeshPainter( { camera: this.camera, host: this.host, ray: ( x, y ) => this.ray( x, y ) } );
    this.customR.gpu = this.terrainR.gpu;
    this.objectsR    = new ObjectsRenderer( this.lib, terrain );
    this.scene.add( this.terrainR.group, this.objectsR.group, this.customR.group, this.placing.ghost );
    this.placing.ghost.visible = false;

    const dom      = this.renderer.domElement;
    this.controls  = new CameraController( this.camera, dom, terrain, ( x, y ) => this.pickTerrain( x, y ) );
    this.shapeTool = new ShapeTool( ( x, y ) => this.ray( x, y ), ( x, y ) => this.pickTerrain( x, y ) );
    this.trailTool = new TrailTool( ( x, y ) => this.ray( x, y ), ( x, y ) => this.pickTerrain( x, y ), () => this.camera, () => this.host.clientHeight );
    this.scene.add( this.trailTool.group );
    this.liftTool = new LiftTool( ( x, y ) => this.ray( x, y ), () => this.camera, () => this.host.clientHeight, ( o ) => !!this.lib.info( o.id )?.lift, ( o ) => !!this.lib.info( o.id )?.lift?.mast, ( uid ) => this.objectsR.liftPieceMeshes( uid ) );
    this.scene.add( this.liftTool.group );
    // ( the gizmo and the selection box go to the lift's piece picked )
    this.liftTool.onPicked   = () => this.syncObjects();
    this.objectsR.liftPicked = ( uid ) => this.liftTool.pickedOf( uid );
    this.scene.add( this.shapeTool.group, this.growPreview.group, this.railTool.group, this.stage.group, this.emptyFloor.group );
    this.unsub.push( onGrowPreview( ( p ) => this.growPreview.show( p ) )                        );
    this.unsub.push( onPaintChange( ( key ) => ( this.terrainR.paintChanged( key ), redraw() ) ) );
    this.unsub.push( useRepeatPreview.subscribe( () => this.syncRepeats() )                      );
    this.controls.onRiderExit = () => useEditor.setState( { cameraMode: "orbit" } );

    this.gizmo.wire();

    this.input.attach();
    window.addEventListener( "keydown", this.keys.onKey, true );
    // ( the mouse and keys change what's shown: hover highlights, the brush ring, a tool's preview… )
    const input = ["pointerdown", "pointermove", "pointerup", "pointerleave", "wheel", "keydown", "keyup"] as const;
    for ( const t of input ) window.addEventListener( t, redraw, true );
    this.unsub.push( () => input.forEach( ( t ) => window.removeEventListener( t, redraw, true ) ) );

    const ro = new ResizeObserver( () => ( this.needsResize = true ) );
    ro.observe( this.host );
    this.unsub.push( () => ro.disconnect() );
    this.resize();

    this.unsub.push(
      useEditor.subscribe( ( s, prev ) => this.storeSync.onChange( s, prev ) ),
    );
    // a different project ( or a new map ) replaces the chunk set: rebuild tiles and reframe
    this.unsub.push(
      terrain.onLayout( () => {
        // a newly opened map gets framed; growing or shrinking the current one keeps the view
        const dir      = useEditor.getState().projectDir;
        const fresh    = dir !== this.framedDir;
        this.framedDir = dir;
        this.veil.terrainBuilding++;
        this.terrainR.rebuild().finally( () => this.veil.terrainBuilding-- ).then( () => {
          this.syncObjects();
          if ( fresh ) this.nav.frameAll();
        } );
      } ),
    );
    // the map's own time of day from the start ( a map opened set to night is dark straight away, not once its
    // time is changed )
    this.daylight.applyTime();
    // the game's own sky, once it's been read from the game
    void ipc.gameSky().then( ( s ) => s && this.daylight.useGameSky( s ) ).catch( ( e ) => console.warn( "game sky", e ) );
    // and its snow
    void ipc.gameTerrain().then( ( t ) => t && this.ground.useGameSnow( t ) ).catch( ( e ) => console.warn( "game snow", e ) );
    this.renderer.setAnimationLoop( () => this.frame() );
    const watch = setInterval( () => this.veil.watch(), 100 );
    this.unsub.push( () => clearInterval( watch ) );
  }

  // ---------------------------------------------------------------- loading

  async loadTerrain() {
    // ( covered from the start: the terrain being built comes first )
    if ( useEditor.getState().projectDir ) this.veil.cover();
    this.veil.terrainBuilding++;
    try {
      await this.ready;
      await this.terrainR.rebuild();
    } finally {
      this.veil.terrainBuilding--;
    }
    this.syncObjects();
    this.nav.frameAll();
    // framed for this map: a later change of its terrain layout ( detail added under a ramp, the map grown ) keeps the
    // view — not knowing it had been framed, the first such change framed the whole map again mid-edit
    this.framedDir = useEditor.getState().projectDir;
    this.syncCustom();
  }

  syncCustom() {
    const s = useEditor.getState();
    this.customR.setProject( s.projectDir );
    this.customR.sync( s.customObjects, s.selection );
  }

  // ---------------------------------------------------------------- frame loop

  // Skips rendering while something covers the viewport ( the Game tab, the real-mountain import ), by what covers it.
  private pauses = new Set<string>();

  get paused() {
    return this.pauses.size > 0;
  }

  setPaused( why: string, on: boolean ) {
    if ( on ) this.pauses.add( why );
    else this.pauses.delete( why );
  }

  // when the last frames were drawn ( performance.now ), for the lag watcher
  frameStamps: number[] = [];

  private lastView = "";

  private lastDrawn = 0;

  /**
   * Whether this frame needs drawing: something asked ( an edit, the mouse, a key, something loaded… ), the camera
   * moved, a stroke or drag is under way, or it's been a second ( anything that changed without asking ).
  **/
  private needsDrawing() {
    const e       = this.camera.matrixWorld.elements, p = this.camera.projectionMatrix.elements, c = this.renderer.domElement;
    const view    = `${e.join( "," )}|${p[0]},${p[5]},${p[10]}|${c.width}x${c.height}`;
    const moved   = view !== this.lastView;
    this.lastView = view;
    const busy    = this.veil.loading || !!this.input.stroke || !!this.input.paintStroke || !!this.input.scatterStroke || this.blGizmo.dragging || !!this.input.sizeDrag || this.meshPainter.painting;
    return takeRedraw() || moved || busy || performance.now() - this.lastDrawn > 1000;
  }

  private frame() {
    if ( this.paused ) return;
    this.frameStamps.push( performance.now() );
    if ( this.frameStamps.length > 1200 ) this.frameStamps.splice( 0, 600 );
    if ( this.needsResize ) {
      this.needsResize = false;
      this.resize();
    }
    if ( terrain.flush() ) redraw(); // sculpt dabs since the last frame → one upload per changed tile
    this.input.updateBrushLook();
    this.clock.update();
    const dt = Math.min( 0.1, this.clock.getDelta() );
    this.controls.tick( dt );
    if ( !this.stage.shown ) this.terrainR.update( this.camera );
    else this.stage.follow( this.camera );
    const empty = !this.stage.shown && terrain.chunks.length === 0;
    if ( empty !== this.emptyFloor.shown ) {
      if ( empty ) this.emptyFloor.show( new THREE.Vector3() );
      else this.emptyFloor.hide();
      this.look.apply();
    }
    if ( empty ) this.emptyFloor.follow( this.camera );
    this.blGizmo.look.update();
    this.trailTool?.frame();
    this.liftTool?.frame();
    // ( the map's lights, once it's dark: the nearest few )
    if ( this.sceneLights.update( this.camera, this.daylight.night ) ) redraw();
    // ( the lifts' chairs going round )
    if ( this.objectsR.animate( this.camera ) ) redraw();
    this.customR.paint.update();
    if ( this.input.stroke ) this.input.stroke.hold( dt * 1000, this.input.strokePressure );
    this.meshPainter.hold( dt * 1000 );
    // drawn when something may have changed ( viewport/redraw.ts ); a still view isn't drawn again
    if ( this.needsDrawing() ) {
      this.lastDrawn = performance.now();
      // ( what's selected is outlined, as Blender does )
      if ( this.stage.shown || useEditor.getState().selection.some( ( x ) => x.kind === "custom" ) ) this.look.outlined().render();
      else this.renderer.render( this.scene, this.camera );
      this.drewFirst();
    }

    this.frames++;
    this.fpsT += dt;
    if ( this.fpsT > 0.5 ) {
      const c = this.cursorWorld;
      this.onStats?.( {
        fps: this.frames / this.fpsT,
        ...this.terrainR.stats,
        cursor: c ? toUnity( c ) : null,
        slope:  c ? terrain.slopeAt( c.x, -c.z ) : null,
      } );
      this.frames = 0;
      this.fpsT   = 0;
    }
  }

  // Resizing a WebGPU canvas clears it, so applying sizes straight from the ResizeObserver
  // shows blank frames while a splitter is dragged. Instead the canvas is CSS-stretched to the
  // host immediately and its pixel size is updated at the start of the next frame, right
  // before that frame renders.
  private needsResize = true;

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if ( !w || !h ) return;
    const dpr = this.renderer.getPixelRatio();
    const c   = this.renderer.domElement;
    if ( c.width !== Math.floor( w * dpr ) || c.height !== Math.floor( h * dpr ) ) this.renderer.setSize( w, h, false );
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- picking

  ray( x: number, y: number ) {
    const ndc = new THREE.Vector2( ( x / this.host.clientWidth ) * 2 - 1, -( y / this.host.clientHeight ) * 2 + 1 );
    const rc  = new THREE.Raycaster();
    rc.setFromCamera( ndc, this.camera );
    return rc;
  }

  local( e: { clientX: number; clientY: number } ) {
    const r = this.host.getBoundingClientRect();
    return new THREE.Vector2( e.clientX - r.left, e.clientY - r.top );
  }

  pickTerrain( x: number, y: number ) {
    const rc = this.ray( x, y );
    if ( this.stage.shown ) return this.stage.pick( rc.ray );
    if ( this.emptyFloor.shown ) return this.emptyFloor.pick( rc.ray );
    return terrain.raycast( rc.ray.origin, rc.ray.direction );
  }

  /**
   * What's clicked at a screen point: the thing under it, else ( as Blender picks ) the nearest within a few pixels, so
   * thin things ( a fence's bars, a rail seen from afar ) don't have to be hit exactly.
  **/
  pickObject( x: number, y: number ): Selection | null {
    const pickables = [...this.objectsR.pickables(), ...this.customR.pickables()];
    const at        = ( px: number, py: number ): Selection | null => {
      const hits = this.ray( px, py ).intersectObjects( pickables, false );
      if ( !hits.length ) return null;
      const tHit = this.pickTerrain( px, py );
      for ( const h of hits ) {
        if ( tHit && h.distance > tHit.distanceTo( this.camera.position ) + 0.5 ) break;
        const ud = h.object.userData as { kind?: Selection["kind"]; uid?: string };
        if ( ud.kind && ud.uid && !useEditor.getState().locked[ud.uid] ) return { kind: ud.kind, uid: ud.uid };
      }
      return null;
    };
    const hit = at( x, y );
    if ( hit ) return hit;
    for ( const r of PICK_RINGS )
      for ( let k = 0; k < 8; k++ ) {
        const near = at( x + Math.cos( ( k * Math.PI ) / 4 ) * r, y + Math.sin( ( k * Math.PI ) / 4 ) * r );
        if ( near ) return near;
      }
    return null;
  }

  /**
   * What's under a screen point: a piece's surface, else the floor ( or the ground ).
  **/
  pointAt( x: number, y: number ) {
    const hits = this.ray( x, y ).intersectObjects( this.customR.pickables(), false );
    const t    = this.pickTerrain( x, y );
    if ( hits[0] && ( !t || hits[0].distance < t.distanceTo( this.camera.position ) ) ) return hits[0].point.clone();
    return t;
  }

  /**
   * The object surface under a screen position: which custom object, which of its parts, which material slot.
  **/
  surfaceAt( clientX: number, clientY: number ): { kind: "custom"; uid: string; partIndex: number; slot: number } | { kind: "feature" } | null {
    const p    = this.local( { clientX, clientY } );
    const hits = this.ray( p.x, p.y ).intersectObjects( [...this.objectsR.pickables(), ...this.customR.pickables()], false );
    const tHit = this.pickTerrain( p.x, p.y );
    const h    = hits[0];
    if ( !h || ( tHit && h.distance > tHit.distanceTo( this.camera.position ) + 0.5 ) ) return null;
    const ud = h.object.userData as { kind?: string; uid?: string; partIndex?: number };
    if ( ud.kind === "custom" && ud.uid ) return { kind: "custom", uid: ud.uid, partIndex: ud.partIndex ?? 0, slot: h.face?.materialIndex ?? 0 };
    return ud.kind === "object" ? { kind: "feature" } : null;
  }

  /**
   * A point ( view space ) on the screen: x, y in pixels, and whether it's in front of the camera.
  **/
  screenOf( v: THREE.Vector3 ): [number, number, boolean] {
    const p = v.clone().project( this.camera );
    return [( p.x * 0.5 + 0.5 ) * this.host.clientWidth, ( -p.y * 0.5 + 0.5 ) * this.host.clientHeight, p.z < 1];
  }

  /**
   * The ground in the middle of the view ( Unity XZ ), e.g. for a symmetry centre.
  **/
  groundAtViewCentre(): [number, number] | null {
    const hit = this.pickTerrain( this.host.clientWidth / 2, this.host.clientHeight / 2 );
    if ( !hit ) return null;
    const u = toUnity( hit );
    return [Math.round( u[0] * 10 ) / 10, Math.round( u[2] * 10 ) / 10];
  }

  /**
   * Whether the cursor is over the terrain ( for overlays that follow it ).
  **/
  cursorOnTerrain() {
    return this.mouseInside && !!this.cursorWorld;
  }

  /**
   * The terrain point under the mouse ( Unity coords ), while the mouse is over the viewport.
  **/
  cursorUnity(): V3 | null {
    return this.mouseInside && this.cursorWorld ? toUnity( this.cursorWorld ) : null;
  }

  /**
   * Texture Paint's brush on the screen: its radius in pixels over the selected piece at a point, or null.
  **/
  meshBrushPx( x: number, y: number ) {
    return this.meshPainter.radiusAt( x, y );
  }

  /**
   * A custom object's top surface as an imprint grid ( terrain/shapes/shapes.ts imprintOf ), for pressing it into the terrain.
  **/
  imprintGrid( uid: string ): { center: [number, number]; grid: StampGrid } | null {
    const g = this.customR.objectGroup( uid );
    if ( !g || !g.children.length ) return null;
    g.updateMatrixWorld( true );
    // its triangles in the map's coordinates ( three → Unity: z flips )
    const tris: number[] = [];
    const v              = new THREE.Vector3();
    for ( const m of g.children ) {
      const mesh = m as THREE.Mesh;
      const pos  = mesh.geometry?.getAttribute( "position" );
      if ( !pos ) continue;
      const idx = mesh.geometry.getIndex();
      for ( let k = 0, n = idx ? idx.count : pos.count; k < n; k++ ) {
        v.fromBufferAttribute( pos, idx ? idx.getX( k ) : k ).applyMatrix4( mesh.matrixWorld );
        tris.push( v.x, v.y, -v.z );
      }
    }
    return imprintOf( tris, Math.min( ...terrain.chunks.map( ( c ) => c.spacing ) ), 4 );
  }

  // its floor at the origin ( the map hidden )
  readonly stage = new Stage();

  // a map with no terrain yet ( a new one ): the same floor in Design, its ground until there's terrain
  readonly emptyFloor = new Stage();

  // ---------------------------------------------------------------- the map's contents

  syncObjects() {
    const s    = useEditor.getState();
    // ( what's hidden in the view isn't drawn: it comes back as it was when shown )
    const seen = <T extends { uid: string }>( list: T[] ) => ( Object.keys( s.hiddenInView ).length ? list.filter( ( x ) => !s.hiddenInView[x.uid] ) : list );
    this.objectsR?.sync( seen( s.objects ), seen( s.spawns ), s.selection );
    this.trees.sync();
    if ( !this.blGizmo?.dragging ) this.gizmo.sync();
  }

  /**
   * Repeated chunks' copies in the view ( when Preview Repeats is on ).
  **/
  syncRepeats() {
    this.terrainR?.setRepeats( useRepeatPreview.getState().on ? repeatedChunks() : [] );
    redraw();
  }

  rideInfo() {
    return this.objectsR?.rideInfo ?? null;
  }

  dispose() {
    this.renderer.setAnimationLoop( null );
    this.unsub.forEach( ( u ) => u() );
    this.input.detach();
    window.removeEventListener( "keydown", this.keys.onKey, true );
    this.terrainR?.dispose();
    this.customR.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
