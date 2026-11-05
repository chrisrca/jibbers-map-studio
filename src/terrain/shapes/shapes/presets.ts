// Map-Tools' formation presets ( Basic, Mountain, Hill, Rocks, Crater ) and the user's own, a formation fitted to its
// outline ( FormationBuilder.FitObject ), and formations from before the studio had Map-Tools' settings brought over.

import { formationBounds, formationChunk, peakPoint } from "./formation";
import { easeInOut, newFormation, type FormationShape } from "./types";

// A formation's settings: everything but its outline and which one it is.
export type FormationSettings = Omit<FormationShape, "uid" | "kind" | "points" | "fitted" | "enabled" | "noiseMirror" | "v">;

export function formationSettings( s: FormationShape ): FormationSettings {
  const { uid: _u, kind: _k, points: _p, fitted: _f, enabled: _e, noiseMirror: _m, v: _v, ...rest } = s;
  return structuredClone( rest );
}

// ( Formation.Presets' Common )
function common( f: FormationShape ) {
  f.profile       = easeInOut();
  f.baseY         = 0;
  f.peakWidth     = 100;
  f.lacunarity    = 2;
  f.gain          = 0.5;
  f.onPeak        = 0.35;
  f.snow.lineLow  = -1;
  f.snow.lineHigh = -1;
}

// Formation.Presets, as Map-Tools has them.
export const FORMATION_PRESETS: { name: string; apply( f: FormationShape ): void }[] = [
  {
    name:  "Basic",
    apply: ( f ) => {
      common( f );
      Object.assign( f, { mode: "add", height: 55, edgeBlend: 14, style: "smooth", roughness: 12, featureSize: 60, detail: 4, warp: 0.25, onPeak: 0.4, smooth: 0.2, smoothSteps: 2 } );
      f.thermal.on   = false;
      f.hydraulic.on = false;
      f.snow.on      = false;
    },
  },
  {
    name:  "Mountain",
    apply: ( f ) => {
      common( f );
      Object.assign( f, { mode: "add", height: 70, edgeBlend: 14, style: "ridged", roughness: 26, featureSize: 55, detail: 6, warp: 0.5, onPeak: 0.35, smooth: 0.15, smoothSteps: 1 } );
      f.thermal   = { on: true, iterations: 50, repose: 36, amount: 0.5 };
      f.hydraulic = { on: true, lifetime: 350, inertia: 0.05, droplets: 0.7, evaporate: 0.01, capacity: 4, erode: 0.3, deposit: 0.3, radius: 3 };
      f.snow      = { ...f.snow, on: true, depth: 1.2, rockFrom: 30, rockFull: 54, crevices: 0.6, soften: 2, addsHeight: 0.4, rock: 1 };
    },
  },
  {
    name:  "Hill",
    apply: ( f ) => {
      common( f );
      Object.assign( f, { mode: "add", height: 35, edgeBlend: 20, style: "smooth", roughness: 6, featureSize: 80, detail: 4, warp: 0.3, onPeak: 0.5, smooth: 0.5, smoothSteps: 4 } );
      f.thermal      = { on: true, iterations: 25, repose: 42, amount: 0.4 };
      f.hydraulic.on = false;
      f.snow         = { ...f.snow, on: true, depth: 1.6, rockFrom: 34, rockFull: 60, crevices: 0.4, soften: 4, addsHeight: 0.5, rock: 0 };
    },
  },
  {
    name:  "Rocks",
    apply: ( f ) => {
      common( f );
      Object.assign( f, { mode: "add", height: 22, edgeBlend: 6, style: "ridged", roughness: 14, featureSize: 25, detail: 6, warp: 0.8, onPeak: 0.2, smooth: 0.05, smoothSteps: 1 } );
      f.thermal      = { on: true, iterations: 20, repose: 46, amount: 0.4 };
      f.hydraulic.on = false;
      f.snow         = { ...f.snow, on: true, depth: 0.25, rockFrom: 20, rockFull: 42, crevices: 0.7, soften: 1, addsHeight: 0, rock: 1 };
    },
  },
  {
    name:  "Crater",
    apply: ( f ) => {
      common( f );
      Object.assign( f, { mode: "carve", height: -30, edgeBlend: 16, style: "smooth", roughness: 6, featureSize: 50, detail: 4, warp: 0.3, onPeak: 0.4, smooth: 0.3, smoothSteps: 3 } );
      f.thermal      = { on: true, iterations: 30, repose: 34, amount: 0.5 };
      f.hydraulic.on = false;
      f.snow         = { ...f.snow, on: true, depth: 0.9, rockFrom: 26, rockFull: 50, crevices: 0.5, soften: 2, addsHeight: 0.3, rock: 1 };
    },
  },
];

/**
 * `s` with its settings replaced by `settings` ( its outline kept ), named after them.
**/
export function withSettings( s: FormationShape, settings: FormationSettings ): FormationShape {
  return { ...s, ...structuredClone( settings ) };
}

/**
 * `s` with the preset's settings, fitted to its outline ( as a fresh formation gets them: what the preset leaves is a
 * new formation's ).
**/
export function applyPreset( s: FormationShape, name: string ): FormationShape {
  const p = FORMATION_PRESETS.find( ( x ) => x.name === name );
  if ( !p ) return s;
  const t = newFormation( s.points );
  p.apply( t );
  return fitFormation( withSettings( s, { ...formationSettings( t ), name: p.name } ) );
}

/**
 * Height, feature size, roughness, peak width, edge blend, base and the droplets' lifetime scaled to the outline's
 * size ( its deepest point's distance in; Fit to Marked Area ), the height kept under 90% of the ground's range.
**/
export function fitFormation( s: FormationShape ): FormationShape {
  const c      = formationChunk( s );
  const reach  = s.points.length >= 3 ? peakPoint( s.points ).reach : 0;
  const radius = reach > 0.5 ? reach : c ? 0.12 * Math.min( c.size[0], c.size[2] ) : 50;
  if ( radius < 1 ) return s;
  const f    = radius / Math.max( s.peakWidth, 0.01 );
  const most = ( c ? c.size[1] : 100 ) * 0.9, h = s.height * f;
  return {
    ...s,
    height:      Math.sign( h ) * Math.min( Math.abs( h ), most ),
    peakWidth:   radius,
    featureSize: s.featureSize * f,
    roughness:   s.roughness * f,
    edgeBlend:   s.edgeBlend * f,
    baseY:       s.baseY * f,
    hydraulic:   { ...s.hydraulic, lifetime: Math.min( 4000, Math.max( 8, Math.round( s.hydraulic.lifetime * f ) ) ) },
    fitted:      true,
  };
}

// ---- the user's own, kept with the studio ( every map has them )

const KEY = "jibbers.formationPresets.v1";

export function savedPresets(): { name: string; settings: FormationSettings }[] {
  try {
    return JSON.parse( localStorage.getItem( KEY ) ?? "[]" );
  } catch {
    return [];
  }
}

/**
 * The formation's settings kept as a preset under its name ( one already by that name replaced ).
**/
export function savePreset( s: FormationShape ) {
  const name = s.name.trim() || "Formation";
  const list = savedPresets().filter( ( p ) => p.name !== name );
  try {
    localStorage.setItem( KEY, JSON.stringify( [...list, { name, settings: formationSettings( { ...s, name } ) }].sort( ( a, b ) => a.name.localeCompare( b.name ) ) ) );
  } catch ( e ) {
    console.warn( "formation preset not kept", e );
  }
}

export function deletePreset( name: string ) {
  try {
    localStorage.setItem( KEY, JSON.stringify( savedPresets().filter( ( p ) => p.name !== name ) ) );
  } catch ( e ) {
    console.warn( "formation preset not taken out", e );
  }
}

// ---- formations from before

interface OldFormation {
  peakWidth:   number;
  smooth:      number;
  smoothSteps: number;
  hydraulic?:  FormationShape["hydraulic"];
}

/**
 * A formation saved before the studio had Map-Tools' settings, brought over as near as they go ( its old smoothing in
 * metres made a pass strength, its droplets' lifetime and radius in its old, coarser samples made the ground's ).
**/
export function migrateFormation( s: FormationShape ): FormationShape {
  if ( s.v === 2 ) return s;
  const o              = s as unknown as OldFormation;
  const d              = newFormation( s.points );
  const [x0, z0, x1, z1] = formationBounds( s );
  const oldSp          = Math.max( 0.5, Math.max( x1 - x0, z1 - z0, 1 ) / 192 ), k = oldSp / ( 1000 / 4096 );
  const hy             = o.hydraulic ?? d.hydraulic;
  return {
    ...d, ...s,
    peakWidth:   o.peakWidth > 0 ? o.peakWidth : Math.max( 1, Math.min( x1 - x0, z1 - z0 ) / 2 ),
    profile:     easeInOut(),
    smooth:      o.smooth > 0 ? 0.5 : 0,
    smoothSteps: Math.max( 1, Math.round( o.smoothSteps ) ),
    hydraulic:   { ...hy, lifetime: Math.min( 4000, Math.max( 8, Math.round( hy.lifetime * k ) ) ), radius: Math.min( 4, Math.max( 1, Math.round( hy.radius * k ) ) ) },
    snow:        d.snow,
    fitted:      true,
    v:           2,
  };
}
