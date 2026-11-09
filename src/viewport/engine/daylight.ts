// The map's time of day in the view: the sun, the sky light, the sky ( the game's own shader when the game's there ),
// reflections and fog.

import { positionWorldDirection, screenCoordinate, uniform, vec4, wgslFn } from "three/tsl";
import * as THREE from "three/webgpu";
import { useEditor, workspaceOf } from "../../map/store";
import { redraw } from "../redraw";
import { snowLook } from "../render/terrainRenderer/look";
import { gameSkyLook, mapGameTime, setLoadedGameSky, type GameSkyData } from "../render/gameSky";
import { DAY, dayLook, mapHour, skyTexture, type DayLook } from "../render/timeOfDay";
import type { Engine } from "./engine";

// The sun's shadow map's size ( texels a side ), and how far off it's put along its light
const SHADOW_MAP = 2048, SUN_AWAY = 1000;
const ZERO       = new THREE.Vector3(), UP = new THREE.Vector3( 0, 1, 0 );

/**
 * Shadows cast whole by all but cutout materials, as Unity's Lit casts them ( only alpha clipping cuts its shadow ).
 * three runs a material's colour in the shadow pass for its alpha whenever it has one; a piece with more than one
 * material then had its shadow's shader made again for each, every frame ( one shadow drawing per piece, its colour
 * swapped between them: 4 fps on a busy park ).
**/
function solidShadows( renderer: THREE.WebGPURenderer ) {
  type Nodes    = { colorNode: unknown; depthNode: unknown; positionNode: unknown };
  const r       = renderer as unknown as { _getShadowNodes( m: THREE.Material ): Nodes };
  const own     = r._getShadowNodes.bind( r );
  const solid   = new WeakMap<Nodes, Nodes>();
  r._getShadowNodes = ( m ) => {
    const n = own( m );
    if ( m.alphaTest > 0 || n.colorNode === null ) return n;
    let s   = solid.get( n );
    if ( !s ) solid.set( n, ( s = { ...n, colorNode: null } ) );
    return s;
  };
  // ( and each material of a piece with several drawn into the shadow as its own: they still differ in sides, and
  // three keeps one shadow drawing per piece unless told apart by the pass )
  type Draw         = ( o: THREE.Object3D, s: THREE.Scene, c: THREE.Camera, g: unknown, m: THREE.Material, gr: unknown, l: unknown, cc?: unknown, pass?: string | null ) => void;
  const draw        = renderer.renderObject.bind( renderer ) as Draw;
  renderer.renderObject = ( ( o, s, c, g, m, gr, l, cc = null, pass = null ) => {
    const shadowPass = ( s.overrideMaterial as { isShadowPassMaterial?: boolean } | null )?.isShadowPassMaterial;
    if ( pass === null && shadowPass && Array.isArray( ( o as THREE.Mesh ).material ) ) pass = `shadow${m.uuid}`;
    draw( o, s, c, g, m, gr, l, cc, pass );
  } ) as Draw as unknown as typeof renderer.renderObject;
}

// The game's sky shader, as a node.
type SkyNode = ReturnType<ReturnType<typeof wgslFn>>;

// The map's time of day in the view ( its fixed time; by day when it has none, and in the Assets workspace ).
export class Daylight {
  constructor( private engine: Engine ) {}

  readonly sun  = new THREE.DirectionalLight( 0xfff4e6, 2.6 );
  readonly hemi = new THREE.HemisphereLight( 0xcfe3ff, 0x5a6270, 0.8 );
  private pmrem:     THREE.PMREMGenerator | null = null;
  // what shiny surfaces reflect: made again into the same target as the time of day changes
  private envTarget: THREE.RenderTarget   | null = null;
  // the time of day shown ( its key: made again when it changes ), and how dark it is ( 0 day … 1 night )
  private dayKey              = "";
  night                       = 0;
  // the game's own sky ( read from the player's copy of the game ), drawn by its shader; null without it
  gameSky: GameSkyData | null = null;
  skyNode: SkyNode | null     = null;
  private skyConsts           = new Map<number, { value: THREE.Vector4 }>();
  // the map's sky and fog ( put back when the Assets workspace's plain background is left )
  sky: THREE.Texture | null   = null;
  fog: THREE.Fog     | null   = null;

  /**
   * By day to start with: the sky, what shiny surfaces reflect, the fog and the sun.
  **/
  init() {
    const { renderer, scene }  = this.engine;
    // a sky like the game's: deep blue overhead, paling to a hazy horizon, which the far terrain fades into
    scene.background           = skyTexture();
    // what shiny surfaces reflect: the sky, blurred for rough ones ( the game's features are partly metal and
    // glossy paint: with nothing to reflect, they drew black )
    this.pmrem                 = new THREE.PMREMGenerator( renderer );
    this.envTarget             = this.pmrem.fromEquirectangular( scene.background as THREE.Texture );
    scene.environment          = this.envTarget.texture;
    // ( a little under full: the editor's sky is brighter all round than the game's, and glossy paint went pale )
    scene.environmentIntensity = 0.7;
    scene.fog                  = new THREE.Fog( DAY.horizon.clone(), 3000, 16000 );
    // low-ish sun from the side so slopes and grooves read clearly ( the map's time of day, when it's fixed: applyTime )
    this.sun.position.copy( DAY.sunDir ).multiplyScalar( 1000 );
    this.sunWay.copy( DAY.sunDir ).normalize();
    // the sun's shadows, soft and as dark as the game's ( its sun's shadow strength, as read from it ); a box of them
    // about where the view looks ( followShadow )
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFShadowMap;
    const shadow               = this.sun.shadow;
    this.sun.castShadow        = true;
    shadow.mapSize.set( SHADOW_MAP, SHADOW_MAP );
    shadow.intensity           = 0.64;
    shadow.radius              = 2;
    shadow.bias                = -0.0004;
    shadow.normalBias          = 0.04;
    shadow.camera.near         = 1;
    shadow.camera.far          = SUN_AWAY * 2;
    solidShadows( renderer );
    scene.add( this.sun, this.sun.target, this.hemi );
  }

  /**
   * The sun's shadows about `focus` ( what the view looks at ): the game draws them out to 75 m from its camera; the
   * editor's view is often further off, so they reach further with the camera's distance, to a limit. Drawn again only
   * when `changed` ( something in the view may have: the camera moving alone leaves them be; at most 30 times a
   * second while it changes every frame ), the sun's moved, or the view's gone far enough for its box to move: in
   * steps of a quarter of it ( and its size in steps of a quarter more ), each whole texels of the shadow map, so the
   * edges of shadows don't crawl. Its half-width.
  **/
  followShadow( camera: THREE.Camera, focus: THREE.Vector3, changed: boolean ): number {
    const reach  = 75 * 1.25 ** Math.ceil( Math.log( THREE.MathUtils.clamp( camera.position.distanceTo( focus ) * 0.75, 75, 250 ) / 75 ) / Math.log( 1.25 ) - 1e-9 );
    const step   = reach / 4, half = reach + step;
    // ( the middle in the sun's own frame, snapped to the step there )
    const dir    = this.sunWay;
    const look   = this.sunLook.lookAt( dir, ZERO, UP );
    const local  = this.sunAt.copy( focus ).applyMatrix4( this.sunInv.copy( look ).invert() );
    local.set( Math.round( local.x / step ) * step, Math.round( local.y / step ) * step, Math.round( local.z / step ) * step );
    const key    = `${half}|${local.x},${local.y},${local.z}|${dir.x},${dir.y},${dir.z}`;
    const shadow = this.sun.shadow;
    shadow.autoUpdate = false;
    // ( changing every frame, a drag or a brush: drawn again 30 times a second, and once it stops, not each frame )
    const now    = performance.now();
    if ( key === this.shadowKey ) {
      if ( changed && now - this.shadowAt < 33 ) {
        this.shadowOwed = true;
        redraw();
      }
      if ( !changed && !this.shadowOwed || changed && now - this.shadowAt < 33 ) return half;
    }
    this.shadowAt      = now;
    this.shadowOwed    = false;
    this.shadowKey     = key;
    shadow.needsUpdate = true;
    const cam          = shadow.camera as THREE.OrthographicCamera;
    if ( cam.right !== half ) {
      cam.left   = cam.bottom = -half;
      cam.right  = cam.top    = half;
      cam.updateProjectionMatrix();
    }
    const centre = local.applyMatrix4( look );
    this.sun.target.position.copy( centre );
    this.sun.position.copy( centre ).addScaledVector( dir, SUN_AWAY );
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    return half;
  }
  private shadowKey  = "";
  private shadowAt   = 0;
  private shadowOwed = false;
  // the way to the sun ( the time of day's )
  private sunWay  = new THREE.Vector3( 0, 1, 0 );
  private sunAt   = new THREE.Vector3();
  private sunLook = new THREE.Matrix4();
  private sunInv  = new THREE.Matrix4();

  /**
   * The game's sky drawn by its own shader ( its constants set by the time: applyTime ).
  **/
  useGameSky( sky: GameSkyData ) {
    this.gameSky = sky;
    setLoadedGameSky( sky );
    const fn                              = wgslFn( sky.wgsl );
    const head                            = /fn shade\(([^)]*)\)/.exec( sky.wgsl )?.[1] ?? "";
    const dir                             = positionWorldDirection;
    // ( the pixel, and the way the view looks in Unity's axes: z the other way )
    const params: Record<string, unknown> = { v0: vec4( screenCoordinate.x, screenCoordinate.y, 0, 1 ), v1: vec4( dir.x, dir.y, dir.z.negate(), 0 ) };
    for ( const m of head.matchAll( /c(\d+):/g ) ) {
      const u = uniform( new THREE.Vector4() );
      this.skyConsts.set( Number( m[1] ), u );
      params[`c${m[1]}`] = u;
    }
    this.skyNode = ( fn as unknown as ( p: Record<string, unknown> ) => SkyNode )( params );
    this.dayKey  = "";
    this.applyTime();
  }

  /**
   * The look for the map's time: the game's own ( its sky shader's constants set ), or the studio's likeness.
  **/
  private lookFor( st: ReturnType<typeof useEditor.getState> ): { key: string; look: DayLook } {
    const assets = workspaceOf( st.tool ) === "assets";
    const sky    = this.gameSky;
    if ( sky && !assets ) {
      const { t, sunAngle } = mapGameTime( sky, st.map );
      const key             = `game|${t.toFixed( 4 )}|${sunAngle.toFixed( 2 )}`;
      if ( key === this.dayKey ) return { key, look: { night: this.night } as DayLook };
      const g = gameSkyLook( sky, t, sunAngle );
      for ( const [reg, u] of this.skyConsts ) u.value.copy( g.constants.get( reg ) ?? new THREE.Vector4() );
      // Unity's lights don't divide by π: three's do
      const toView = ( v: THREE.Vector3 ) => new THREE.Vector3( v.x, v.y, -v.z ).normalize();
      return {
        key,
        look: {
          sunDir:        toView( g.lightDir ),
          sunColor:      g.lightColor,
          sunIntensity:  Math.PI * g.lightIntensity,
          hemiSky:       g.ambientSky,
          hemiGround:    g.ambientGround,
          hemiIntensity: Math.PI,
          zenith:        g.top,
          mid:           g.middle,
          horizon:       g.bottom,
          envIntensity:  0.7 * ( 1 - g.night ) + 0.3 * g.night,
          night:         g.night,
          stars:         false,
        },
      };
    }
    const h = assets ? null : mapHour( st.map );
    return { key: h === null ? "day" : `${h.toFixed( 3 )}|${( st.map?.sunAngle ?? 0 ).toFixed( 2 )}`, look: h === null ? DAY : dayLook( h, st.map?.sunAngle ?? 0 ) };
  }

  applyTime() {
    const st            = useEditor.getState();
    const { key, look } = this.lookFor( st );
    this.night          = look.night;
    if ( key === this.dayKey ) return;
    this.dayKey = key;
    this.sun.position.copy( look.sunDir ).multiplyScalar( 1000 );
    this.sunWay.copy( look.sunDir ).normalize();
    snowLook.sunView.value.copy( look.sunDir ).normalize();
    this.sun.color.copy( look.sunColor );
    this.sun.intensity = look.sunIntensity;
    this.hemi.color.copy( look.hemiSky );
    this.hemi.groundColor.copy( look.hemiGround );
    this.hemi.intensity = look.hemiIntensity;
    // ( the same sky and reflections, painted again: new ones would have every material made again )
    this.sky ??= this.engine.scene.background instanceof THREE.Texture ? this.engine.scene.background : null;
    this.sky = skyTexture( look, ( this.sky as THREE.CanvasTexture | null ) ?? undefined );
    if ( this.pmrem && this.envTarget ) this.pmrem.fromEquirectangular( this.sky, this.envTarget );
    this.engine.scene.environmentIntensity = look.envIntensity;
    this.fog?.color.copy( look.horizon );
    this.engine.look.apply();
    redraw();
  }
}
