// The map's time of day in the view where the game's own sky can't be read ( no game installed: gameSky.ts is the
// game's ): where the sun is, how bright and what colour, the sky and haze, and how dark it's got ( the lights come
// on ) — up at six, highest at noon, down at six, turned by the sun angle. The look the reflections are painted from
// either way.

import * as THREE from "three/webgpu";
import type { MapSettings } from "../../core/types";

export interface DayLook {
  // towards the sun ( or the moon, at night ), view space
  sunDir:        THREE.Vector3;
  sunColor:      THREE.Color;
  sunIntensity:  number;
  hemiSky:       THREE.Color;
  hemiGround:    THREE.Color;
  hemiIntensity: number;
  // the sky: overhead, part way up, at the horizon ( the haze )
  zenith:        THREE.Color;
  mid:           THREE.Color;
  horizon:       THREE.Color;
  envIntensity:  number;
  // 0 day … 1 night: how much the lights show
  night:         number;
  // stars painted in, by night ( not where the game's own sky draws them: only reflections are painted then )
  stars?:        boolean;
}

/**
 * The hour the map's fixed at, or null ( the game runs its own day: the view shows it by day ).
**/
export function mapHour( map: MapSettings | null | undefined ): number | null {
  if ( !map?.overrideTime ) return null;
  if ( map.dayTimeHours >= 0 ) return ( ( map.dayTimeHours % 24 ) + 24 ) % 24;
  // ( the old 0..1 value: through the day from midnight )
  return ( ( map.dayTime % 1 ) + 1 ) % 1 * 24;
}

const smooth = ( a: number, b: number, x: number ) => {
  const t = Math.max( 0, Math.min( 1, ( x - a ) / ( b - a ) ) );
  return t * t * ( 3 - 2 * t );
};
const mixC = ( a: number, b: number, t: number ) => new THREE.Color( a ).lerp( new THREE.Color( b ), t );

// By day, as the view has always been ( the editor's own low sun from the side, so slopes read ).
export const DAY: DayLook = {
  sunDir:        new THREE.Vector3( -0.8, 0.75, 0.45 ).normalize(),
  sunColor:      new THREE.Color( 0xfff4e6 ),
  sunIntensity:  2.6,
  hemiSky:       new THREE.Color( 0xcfe3ff ),
  hemiGround:    new THREE.Color( 0x5a6270 ),
  hemiIntensity: 0.8,
  zenith:        new THREE.Color( 0x2a6cc4 ),
  mid:           new THREE.Color( 0x63a1de ),
  horizon:       new THREE.Color( 0xcfdeeb ),
  envIntensity:  0.7,
  night:         0,
};

/**
 * The look at `hour` ( 0..24 ) with the sun turned `sunAngle` degrees.
**/
export function dayLook( hour: number, sunAngle: number ): DayLook {
  // the sun's height: up at six, highest ( 62° ) at noon, down at eighteen, as far below at midnight
  const elev   = 62 * Math.sin( ( Math.PI * ( hour - 6 ) ) / 12 );
  // and round: from the sun angle, a quarter turn either side through the day
  const az     = ( ( sunAngle + ( hour - 12 ) * 15 ) * Math.PI ) / 180;
  const night  = smooth( 4,  -6, elev );
  const golden = smooth( 22, 2,  elev ) * ( 1 - night );
  // by night the moon: high, opposite, faint and blue
  const e      = ( Math.max( elev, 0 ) * Math.PI ) / 180, me = ( 35 * Math.PI ) / 180;
  const sunU   = new THREE.Vector3( Math.sin( az ) * Math.cos( e ),   Math.sin( e ),  Math.cos( az ) * Math.cos( e )   );
  const moonU  = new THREE.Vector3( -Math.sin( az ) * Math.cos( me ), Math.sin( me ), -Math.cos( az ) * Math.cos( me ) );
  const dirU   = night > 0.5 ? moonU : sunU;
  const day    = ( a: number, g: number, n: number ) => mixC( mixC( a, g, golden ).getHex(), n, night );
  return {
    sunDir:        new THREE.Vector3( dirU.x, Math.max( 0.05, dirU.y ), -dirU.z ).normalize(),
    sunColor:      day( 0xfff4e6, 0xffb070, 0x9fb4ff ),
    // ( by night a moon bright enough to see the snow by, as the game's is )
    sunIntensity:  2.6 * ( 1 - night ) * ( 1 - golden * 0.45 ) + 0.6 * night,
    hemiSky:       day( 0xcfe3ff, 0xc8b8c8, 0x2a3a66 ),
    hemiGround:    day( 0x5a6270, 0x5a5050, 0x0c1020 ),
    hemiIntensity: 0.8 * ( 1 - night ) + 0.8 * night,
    zenith:        day( 0x2a6cc4, 0x34507a, 0x050a18 ),
    mid:           day( 0x63a1de, 0x8a8fae, 0x0b1630 ),
    horizon:       day( 0xcfdeeb, 0xf0b48a, 0x1c2a44 ),
    envIntensity:  0.7 * ( 1 - night ) + 0.3 * night,
    night,
  };
}

/**
 * The sky all round for a look ( equirectangular: top row straight up, the middle row the horizon ); `into` an earlier
 * one painted again ( the same texture: what's drawn with it isn't made again ).
**/
export function skyTexture( look: DayLook = DAY, into?: THREE.CanvasTexture ) {
  const c    = ( into?.image as HTMLCanvasElement | undefined ) ?? document.createElement( "canvas" );
  // ( 2:1, as panoramas are: what reflections are made from expects it )
  c.width    = 512;
  c.height   = 256;
  const g    = c.getContext( "2d" )!;
  const css  = ( col: THREE.Color ) => `#${col.getHexString()}`;
  const grad = g.createLinearGradient( 0, 0, 0, 256 );
  grad.addColorStop( 0,   css( look.zenith  ) );
  grad.addColorStop( 0.3, css( look.mid     ) );
  grad.addColorStop( 0.5, css( look.horizon ) );
  // below the horizon ( only seen past the map's edge ): the haze carries on
  grad.addColorStop( 1,   css( look.horizon ) );
  g.fillStyle = grad;
  g.fillRect( 0, 0, 512, 256 );
  // stars, by night
  if ( look.night > 0.3 && look.stars !== false ) {
    let seed    = 7;
    const rnd   = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
    g.fillStyle = `rgba(255, 255, 255, ${0.8 * look.night})`;
    for ( let k = 0; k < 260; k++ ) g.fillRect( rnd() * 512, rnd() * 110, rnd() < 0.15 ? 2 : 1, 1 );
  }
  if ( into ) {
    into.needsUpdate = true;
    return into;
  }
  const t      = new THREE.CanvasTexture( c );
  t.mapping    = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
