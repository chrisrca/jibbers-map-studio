// The map's time of day in the view: the sun, the sky light, the sky ( the game's own shader when the game's there ),
// reflections and fog.

import { positionWorldDirection, screenCoordinate, uniform, vec4, wgslFn } from "three/tsl";
import * as THREE from "three/webgpu";
import { useEditor, workspaceOf } from "../../map/store";
import { redraw } from "../redraw";
import { gameSkyLook, mapGameTime, setLoadedGameSky, type GameSkyData } from "../render/gameSky";
import { DAY, dayLook, mapHour, skyTexture, type DayLook } from "../render/timeOfDay";
import type { Engine } from "./engine";

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
    scene.add( this.sun, this.hemi );
  }

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
