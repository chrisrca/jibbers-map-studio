// A shape's height over the ground at a point, its bounds, and a kicker's arc and lip.

import { evalCurve, evalRepeated } from "../../../core/curve";
import { terrain } from "../../terrain";
import { stampSample } from "./stamp";
import type { CurveShape, Shape } from "./types";

const smooth = ( u: number ) => u * u * ( 3 - 2 * u );

const sat = ( x: number ) => ( x < 0 ? 0 : x > 1 ? 1 : x );

/**
 * World-space XZ bounds a shape can change.
**/
export function shapeBounds( s: Shape ): [number, number, number, number] {
  if ( s.kind === "circle" ) return [s.center[0] - s.radius, s.center[1] - s.radius, s.center[0] + s.radius, s.center[1] + s.radius];
  if ( s.kind === "stamp" ) {
    const r = ( Math.hypot( s.grid.w - 1, s.grid.h - 1 ) * s.grid.spacing ) / 2;
    return [s.center[0] - r, s.center[1] - r, s.center[0] + r, s.center[1] + r];
  }
  const h = s.width / 2;
  return [Math.min( s.start[0], s.end[0] ) - h, Math.min( s.start[1], s.end[1] ) - h, Math.max( s.start[0], s.end[0] ) + h, Math.max( s.start[1], s.end[1] ) + h];
}

/**
 * The shape's target height and blend at a world point, or null outside it. `ground` samples the terrain under the
 * shape ( for start/end/centre heights left on "ground" ).
**/
export function shapeAt( s: Shape, x: number, z: number, ground: ( x: number, z: number ) => number ): { h: number; blend: number } | null {
  if ( s.kind === "stamp" ) {
    const g  = s.grid;
    // world → stamp-local: the inverse of the turn its outline is drawn with ( shapeTool stampCorners )
    const a  = ( s.rotation * Math.PI ) / 180;
    const dx = x - s.center[0], dz = z - s.center[1];
    let lx   = dx * Math.cos( a ) - dz * Math.sin( a ), lz = dx * Math.sin( a ) + dz * Math.cos( a );
    if ( s.mirrorX ) lx = -lx;
    if ( s.mirrorZ ) lz = -lz;
    const u   = lx / g.spacing + ( g.w - 1 ) / 2, v = lz / g.spacing + ( g.h - 1 ) / 2;
    const val = stampSample( g, u, v );
    if ( val === null ) return null;
    if ( g.dist ) {
      // an imprint: exact under the object, the ground sloping up to it over the blend around it
      const d     = stampSample( { ...g, heights: g.dist }, u, v ) ?? Infinity;
      const blend = s.blend > 0 ? smooth( sat( 1 - d / s.blend ) ) : d <= 1e-6 ? 1 : 0;
      return blend > 0 ? { h: ( g.origin ?? 0 ) + val + s.heightOffset, blend } : null;
    }
    // an exact copy, moved as one piece: its surrounding ground level goes to the ground height under its centre
    // ( or, with "relative" off, it stays at exactly the height it was copied from )
    const base   = s.relative ? ground( s.center[0], s.center[1] ) : g.origin ?? 0;
    const h      = base + val + s.heightOffset;
    const edge   = Math.min( u, g.w - 1 - u, v, g.h - 1 - v ) * g.spacing; // metres in from the nearest edge
    const blendM = s.blend ?? ( ( s as { falloff?: number } ).falloff ?? 0.15 ) * Math.min( g.w - 1, g.h - 1 ) * g.spacing;
    const blend  = blendM > 0 ? smooth( sat( edge / blendM ) ) : 1;
    return { h, blend };
  }
  if ( s.kind === "circle" ) {
    const dx    = x - s.center[0], dz = z - s.center[1];
    const a     = ( s.tiltAngle * Math.PI ) / 180, dir = ( s.tiltDirection * Math.PI ) / 180;
    const slope = Math.tan( a );
    const rise  = slope * ( dx * Math.sin( dir ) + dz * Math.cos( dir ) );
    const dist  = Math.sqrt( dx * dx + dz * dz + rise * rise );
    if ( dist > s.radius ) return null;
    const base = s.height ?? ground( s.center[0], s.center[1] );
    const t    = sat( dist / s.radius );
    const h    = base + rise + evalCurve( s.radial, t ) * s.depth;
    let blend  = 1;
    if ( s.edgeBlend > 0 ) blend = Math.pow( smooth( sat( ( 1 - t ) / s.edgeBlend ) ), s.edgeFalloff );
    return { h, blend };
  }
  const ax  = s.start[0], az = s.start[1];
  const dx  = s.end[0] - ax, dz = s.end[1] - az;
  const len = Math.hypot( dx, dz );
  if ( len < 1e-3 ) return null;
  const fx = dx / len, fz = dz / len;
  const px = x - ax, pz = z - az;
  const ly = px * fx + pz * fz;
  if ( ly < 0 || ly > len ) return null;
  const lx = px * fz - pz * fx + s.width / 2; // right-hand side positive
  if ( lx < 0 || lx > s.width ) return null;
  const startH   = s.startHeight ?? ground( s.start[0], s.start[1] );
  const endH     = s.endHeight   ?? ground( s.end[0],   s.end[1]   );
  const t        = ly / len;
  const flatH    = startH + ( endH - startH ) * t;
  const kick     = s.heightMode === "bump" && s.lipAngle != null ? kickerArc( len, startH, endH, s.lipAngle ) : null;
  const prof     = kick ? 0 : evalRepeated( s.profile, t, s.repeats, s.repeatScaling, s.repeatFade );
  const curveH   = kick ? flatH + kick( t ) : s.heightMode === "bump" ? flatH + prof * s.bump : startH + ( endH - startH ) * prof;
  const ct       = lx / s.width;
  const crossVal = evalCurve( s.cross, ct ) * s.crossDepth;
  const tiltBias = evalCurve( s.tilt, t ) * s.tiltDepth * ( ct - 0.5 );
  const edgeC    = Math.min( ct, 1 - ct ), edgeT = Math.min( t, 1 - t );
  const sideFade = s.sideFlatten > 0 ? smooth( sat( edgeC / s.sideFlatten ) ) : 1;
  const h        = flatH + ( curveH + crossVal + tiltBias - flatH ) * sideFade;
  const edge     = s.edgeMode === "sides" ? edgeC : s.edgeMode === "ends" ? edgeT : Math.min( edgeT, edgeC );
  const blend    = s.edgeBlend > 0 ? Math.pow( smooth( sat( edge / s.edgeBlend ) ), s.edgeFalloff ) : 1;
  return { h, blend };
}

/**
 * A kicker's face set by its lip angle: a circular arc that leaves the slope ( from `startH` to `endH` over `len`
 * metres ) parallel to it and turns up to `lipDeg` above level. Returns the height above the slope line at t = 0..1.
**/
export function kickerArc( len: number, startH: number, endH: number, lipDeg: number ): ( t: number ) => number {
  // a circular arc in the vertical plane of the run, tangent to the slope at the start ( angle a ) and at `lip` at the
  // end: x( phi ) = R ( sin phi - sin a ), y( phi ) = R ( cos a - cos phi ), with R chosen so x reaches `len` at the lip
  const a   = Math.atan2( endH - startH, len );
  const lip = Math.max( a + ( 1 * Math.PI ) / 180, Math.min( ( 80 * Math.PI ) / 180, ( lipDeg * Math.PI ) / 180 ) );
  const r   = len / ( Math.sin( lip ) - Math.sin( a ) );
  return ( t ) => {
    const x   = Math.min( 1, Math.max( 0, t ) ) * len;
    const phi = Math.asin( Math.min( 1, Math.sin( a ) + x / r ) );
    return r * ( Math.cos( a ) - Math.cos( phi ) ) - ( endH - startH ) * t; // above the straight slope line
  };
}

/**
 * The lip angle ( degrees ) that puts curve shape `s`'s lip `height` above the slope line ( see kickerArc ).
**/
export function lipAngleFor( s: CurveShape, height: number, ground: ( x: number, z: number ) => number ) {
  const len = Math.hypot( s.end[0] - s.start[0], s.end[1] - s.start[1] );
  if ( len < 1e-3 ) return s.lipAngle ?? 25;
  const startH = s.startHeight ?? ground( s.start[0], s.start[1] ), endH = s.endHeight ?? ground( s.end[0], s.end[1] );
  const a      = Math.atan2( endH - startH, len );
  // the arc's lip is len·tan( ( a + lip ) / 2 ) above its start, the slope line len·tan( a )
  const lip    = 2 * Math.atan( height / len + Math.tan( a ) ) - a;
  return Math.max( ( a * 180 ) / Math.PI + 1, Math.min( 80, ( lip * 180 ) / Math.PI ) );
}

/**
 * A curve shape's height at its lip/end above the slope line ( what "Height" means for a kicker set by angle ).
**/
export function kickerHeight( s: CurveShape, ground: ( x: number, z: number ) => number ) {
  const len = Math.hypot( s.end[0] - s.start[0], s.end[1] - s.start[1] );
  if ( s.lipAngle == null || len < 1e-3 ) return s.bump;
  const startH = s.startHeight ?? ground( s.start[0], s.start[1] ), endH = s.endHeight ?? ground( s.end[0], s.end[1] );
  return kickerArc( len, startH, endH, s.lipAngle )( 1 );
}

/**
 * Height a shape would produce at a point, for previews ( the ground as it is now underneath ).
**/
export function shapeHeightAt( s: Shape, x: number, z: number ): number | null {
  const r = shapeAt( s, x, z, ( gx, gz ) => terrain.heightAt( gx, gz ) );
  return r ? r.h : null;
}
