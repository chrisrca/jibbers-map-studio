// The game's own sky, read from the player's copy of the game ( src-tauri gamelook/sky.rs: its sky shader translated to
// WGSL, its sky states, the gameplay scene's environment settings and its sky material ): drawn by the game's shader,
// lit as the game lights it. The sums are the game's EnvironmentManager's:
//  - the time t ( 0..1 ) runs the sun round once; the day is t < nightStartT, the sun's angle θ = π·t/nightStartT by day,
//    π·( 1 + ( t − nightStartT )/( 1 − nightStartT ) ) by night;
//  - the sun is ( 0, sin θ, −cos θ ) turned about z by 90° − sunPeakAngle, then about y by sunYAngle ( the map's sun
//    angle ); the moon is opposite;
//  - the sky's colours, horizon, sun and light are its sky states blended ( by θ/2π, between the two either side );
//  - the light goes from the moon's to the sun's as the sun comes up through twilightWidth past the set depth;
//  - the sky turns to night ( _DayNightBlend ) as the sun goes down past half the set depth;
//  - a map's hour h is t = frac( ( h − 12·( 1 − nightStartT ) ) / 24 ).

import * as THREE from "three/webgpu";
import type { MapSettings } from "../../core/types";

type C4        = [number, number, number, number];
// the sky shader's constants by name
type Constants = Record<string, number | C4>;

export interface SkyState {
  name:             string;
  time:             number;
  dayTop:           C4;
  dayMiddle:        C4;
  dayBottom:        C4;
  gradientExponent: number;
  ambientSky:       C4;
  ambientEquator:   C4;
  ambientGround:    C4;
  horizonColor:     C4;
  horizonIntensity: number;
  horizonWidth:     number;
  sunColor:         C4;
  sunEmission:      number;
  sunSize:          number;
  lightColor:       C4;
  lightEmission:    number;
  lightTemperature: number;
}

export interface GameSkyData {
  version:  number;
  // the game's sky shader as one WGSL function: shade( v0: pixel, v1: view direction ( Unity space ), cN: its constants )
  wgsl:     string;
  // each shader property's constant: [register, component, size]
  regs:     Record<string, [number, number, number]>;
  // each property's kind ( colours are uploaded in linear light, as Unity does )
  props:    Record<string, "color" | "vector" | "float" | "texture">;
  // the gameplay scene's sky material
  material: Record<string, number | C4>;
  config:   { gradientMode: number; useSeparateAmbient: boolean; states: SkyState[] };
  env: {
    sunYAngle:                number;
    sunPeakAngle:             number;
    sunSizeMultiplier:        number;
    dayNightT:                number;
    nightStartT:              number;
    twilightWidth:            number;
    moonLightColor:           C4;
    lightIntensityMultiplier: number;
    moonEmission:             number;
    moonPhase:                number;
    starOrbitSpeed:           number;
    ambientIntensity:         number;
    ambientSaturation:        number;
    ambientMin:               number;
  };
}

// The game's moon light ( EnvironmentManager's own, not in its scene: the Environment menu's Moon Light Intensity ).
const MOON_LIGHT     = 0.1;
// The game's cloud coverage as it starts ( its Environment menu's, over the sky material's ).
const CLOUD_COVERAGE = 0.8;

const clamp01    = ( x: number ) => Math.max( 0, Math.min( 1, x ) );
const smoothstep = ( a: number, b: number, x: number ) => {
  const t = clamp01( ( x - a ) / ( b - a ) );
  return t * t * ( 3 - 2 * t );
};
const lerp  = ( a: number, b: number, f: number ) => a + ( b - a ) * f;
const lerp4 = ( a: C4,     b: C4,     f: number ): C4 => [lerp( a[0], b[0], f ), lerp( a[1], b[1], f ), lerp( a[2], b[2], f ), lerp( a[3], b[3], f )];
/**
 * Unity's colour as uploaded in linear light ( alpha as it is )
**/
const linear = ( c: C4 ): C4 => {
  const l = new THREE.Color().setRGB( c[0], c[1], c[2], THREE.SRGBColorSpace );
  return [l.r, l.g, l.b, c[3]];
};

// The game's sky as read ( the view sets it once it has it ): what the Map tab's hour goes by.
export let loadedGameSky: GameSkyData | null = null;
export function setLoadedGameSky( s: GameSkyData | null ) {
  loadedGameSky = s;
}

/**
 * The hour on the game's clock a map's fixed at ( its old 0..1 time, when it has no hour, read as the game does ).
**/
export function mapClockHour( map: MapSettings ): number {
  if ( map.dayTimeHours >= 0 ) return map.dayTimeHours;
  // ( the game's: its time 0 is 12·( 1 − nightStartT ) o'clock )
  const n = loadedGameSky?.env.nightStartT ?? 0.626;
  const h = clamp01( map.dayTime ) * 24 + 12 * ( 1 - n );
  return ( ( h % 24 ) + 24 ) % 24;
}

/**
 * The game's time for a map: its fixed time ( its hour, or the old 0..1 value as it is ), or the gameplay scene's own.
**/
export function mapGameTime( sky: GameSkyData, map: MapSettings | null | undefined ): { t: number; sunAngle: number } {
  const e = sky.env;
  if ( !map?.overrideTime ) return { t: e.dayNightT, sunAngle: e.sunYAngle };
  const t = map.dayTimeHours >= 0 ? hourToT( sky, map.dayTimeHours ) : clamp01( map.dayTime );
  return { t, sunAngle: map.sunAngle };
}

/**
 * An hour on the game's clock as its time ( the game's EnvironmentManager: the clock's 0 is nightStartT's dawn ).
**/
export function hourToT( sky: GameSkyData, h: number ) {
  const x = ( h - 12 * ( 1 - sky.env.nightStartT ) ) / 24;
  return x - Math.floor( x );
}

/**
 * The sky states either side of `phase` blended ( the game's: sorted by time, round the end, linear ).
**/
function blendState( states: SkyState[], phase: number ): SkyState {
  const s = [...states].sort( ( a, b ) => a.time - b.time );
  if ( s.length === 1 ) return s[0];
  for ( let i = 0; i < s.length; i++ ) {
    const a = s[i], b = s[( i + 1 ) % s.length];
    let ta  = a.time, tb = b.time, x = phase;
    if ( tb < ta ) {
      tb += 1;
      if ( x < ta ) x += 1;
    }
    if ( x >= ta && x <= tb ) {
      const f   = tb > ta ? clamp01( ( x - ta ) / ( tb - ta ) ) : 0;
      const out = { ...a } as unknown as Record<string, unknown>;
      for ( const k of Object.keys( a ) as ( keyof SkyState )[] ) {
        const va = a[k], vb = b[k];
        if ( typeof va === "number" && typeof vb === "number" ) out[k] = lerp( va, vb, f );
        else if ( Array.isArray( va ) && Array.isArray( vb ) ) out[k] = lerp4( va as C4, vb as C4, f );
      }
      return out as unknown as SkyState;
    }
  }
  return s[0];
}

/**
 * A colour temperature's tint ( Unity's correlated colour temperature to RGB, near enough: white at 6570 K ).
**/
function kelvin( k: number ): THREE.Color {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow( t - 60, -0.1332047592 );
  const g = t <= 66 ? 99.4708025861 * Math.log( t ) - 161.1195681661 : 288.1221695283 * Math.pow( t - 60, -0.0755148492 );
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log( t - 10 ) - 305.0447927307;
  const c = new THREE.Color().setRGB( clamp01( r / 255 ), clamp01( g / 255 ), clamp01( b / 255 ), THREE.SRGBColorSpace );
  return c;
}

export interface GameSkyLook {
  // each shader constant's value, by register
  constants:      Map<number, THREE.Vector4>;
  // towards the sun, Unity space ( the moon is the other way )
  sun:            THREE.Vector3;
  // what lights the map: towards the sun by day, the moon by night ( Unity space )
  lightDir:       THREE.Vector3;
  // the light's colour ( linear ) and Unity's intensity
  lightColor:     THREE.Color;
  lightIntensity: number;
  // Unity's ambient: sky, equator, ground ( linear )
  ambientSky:     THREE.Color;
  ambientEquator: THREE.Color;
  ambientGround:  THREE.Color;
  // the fog's colour ( the sky's bottom: linear )
  fog:            THREE.Color;
  // the sky's top, middle and bottom ( linear ), for reflections
  top:            THREE.Color;
  middle:         THREE.Color;
  bottom:         THREE.Color;
  // 0 day … 1 night
  night:          number;
}

/**
 * The game's sky and light at time `t` with the sun turned `sunYAngle`.
**/
export function gameSkyLook( sky: GameSkyData, t: number, sunYAngle: number ): GameSkyLook {
  const e     = sky.env, m = sky.material;
  const n     = e.nightStartT;
  const theta = t < n ? ( Math.PI * t ) / n : Math.PI * ( 1 + ( t - n ) / ( 1 - n ) );
  // ( Unity's Quaternion.Euler( 0, y, 0 ) * AngleAxis( 90 − peak, forward ), on ( 0, sin θ, −cos θ ) )
  const q     = new THREE.Quaternion()
    .setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), THREE.MathUtils.degToRad( sunYAngle ) )
    .multiply( new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 0, 1 ), THREE.MathUtils.degToRad( 90 - e.sunPeakAngle ) ) );
  const unityRot          = ( v: THREE.Vector3 ) => unityTurn( q, v );
  const sun               = unityRot( new THREE.Vector3( 0, Math.sin( theta ), -Math.cos( theta ) ) );
  const moon              = sun.clone().negate();
  const axis              = unityRot( new THREE.Vector3( 1, 0, 0 ) );
  const st                = blendState( sky.config.states, theta / ( 2 * Math.PI ) );
  const dip               = Math.sin( THREE.MathUtils.degToRad( Number( m._BodyDip ?? 15 ) ) );
  const tw                = e.twilightWidth;
  // the light: the moon's to the sun's as the sun comes up
  const toSun             = smoothstep( -dip - tw / 2, -dip + tw / 2, sun.y );
  const lc                = lerp4( e.moonLightColor, st.lightColor, toSun );
  const lightColor        = new THREE.Color().setRGB( lc[0], lc[1], lc[2], THREE.SRGBColorSpace ).multiply( kelvin( st.lightTemperature > 0 ? st.lightTemperature : 6500 ) );
  const day               = sun.y >= -dip;
  const lightIntensity    = e.lightIntensityMultiplier * ( day ? smoothstep( 0, 1, ( sun.y + dip ) / tw ) * st.lightEmission : smoothstep( 0, 1, ( -sun.y - dip ) / tw ) * MOON_LIGHT );
  const night             = smoothstep( -dip / 2 + tw, -dip / 2 - tw, sun.y );
  // the sky's colours ( its middle: between bottom and top by the gradient, or its own )
  const middle            = sky.config.gradientMode === 1 ? st.dayMiddle : lerp4( st.dayBottom, st.dayTop, clamp01( Math.pow( 0.5, st.gradientExponent ) ) );
  // the shader's constants: the material's, then what the game sets from the time
  const values: Constants = { ...m };
  Object.assign( values, {
    _TopColor:         st.dayTop,
    _MiddleColor:      middle,
    _BottomColor:      st.dayBottom,
    _GradientExponent: st.gradientExponent,
    _HorizonColor:     st.horizonColor,
    _HorizonIntensity: st.horizonIntensity,
    _HorizonWidth:     st.horizonWidth,
    _SunColor:         st.sunColor,
    _SunSize:          st.sunSize * e.sunSizeMultiplier,
    _SunEmission:      st.sunEmission,
    _SunDirection:     [sun.x, sun.y, sun.z, 0],
    _MoonDirection:    [moon.x, moon.y, moon.z, 0],
    _MoonEmission:     e.moonEmission,
    _MoonPhase:        e.moonPhase,
    _CelestialAxis:    [axis.x, axis.y, axis.z, 0],
    _CelestialAngle:   theta * e.starOrbitSpeed,
    _DayNightBlend:    night,
    _CloudOffset:      [0, 0, 0, 0],
    // ( the game's settings over the material: its Environment menu's Clouds Coverage, 0.8 as it starts )
    _CloudCoverage:    CLOUD_COVERAGE,
  } );
  const constants = new Map<number, THREE.Vector4>();
  const at        = ( reg: number ) => {
    let v = constants.get( reg );
    if ( !v ) constants.set( reg, ( v = new THREE.Vector4() ) );
    return v;
  };
  // ( Unity's _Time: still, so the clouds stay put )
  at( 15 ).set( 0, 0, 0, 0 );
  for ( const [name, [reg, comp, dim]] of Object.entries( sky.regs ) ) {
    const raw = values[name];
    if ( raw === undefined ) continue;
    const vals = typeof raw === "number" ? [raw] : sky.props[name] === "color" ? linear( raw ) : raw;
    const v    = at( reg );
    for ( let k = 0; k < dim; k++ ) v.setComponent( comp + k, vals[k] ?? 0 );
  }
  // ( as the game works it out: on the colours as stored, sRGB; Unity takes the result into linear light )
  const amb = ( c: C4, scale = 1 ) => {
    const y   = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const s   = clamp01( e.ambientSaturation );
    const out = [0, 1, 2].map( ( k ) => Math.max( lerp( y, c[k], s ) * e.ambientIntensity, e.ambientMin * scale ) );
    return new THREE.Color().setRGB( out[0], out[1], out[2], THREE.SRGBColorSpace );
  };
  const toLinear = ( c: C4 ) => new THREE.Color().setRGB( c[0], c[1], c[2], THREE.SRGBColorSpace );
  return {
    constants,
    sun,
    lightDir: day ? sun.clone() : moon.clone(),
    lightColor,
    lightIntensity,
    ambientSky:     amb( st.ambientSky     ),
    ambientEquator: amb( st.ambientEquator ),
    ambientGround:  amb( st.ambientGround, 0.6 ),
    fog:            toLinear( st.dayBottom ),
    top:            toLinear( st.dayTop    ),
    middle:         toLinear( middle       ),
    bottom:         toLinear( st.dayBottom ),
    night,
  };
}

/**
 * A vector turned by a turn written in Unity's terms ( left-handed: the same sums, as Unity does them ).
**/
function unityTurn( q: THREE.Quaternion, v: THREE.Vector3 ) {
  // ( a quaternion's rotation formula doesn't care about handedness: the numbers are Unity's )
  return v.clone().applyQuaternion( q );
}
