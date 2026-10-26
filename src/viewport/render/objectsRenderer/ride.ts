// A rider's path from a spawn ( gravity and the ground, no tricks ): how far they fly and how fast they land.

import * as THREE from "three/webgpu";
import { toThree } from "../../../core/coords";
import type { Terrain } from "../../../terrain/terrain";

/**
 * Frictionless slide/fly simulation for the spawn path preview ( Unity space ).
**/
export function simulateRide( terrain: Terrain, start: [number, number, number], vel: [number, number, number], seconds = 8, dt = 1 / 60 ) {
  const p                    = new THREE.Vector3( ...start ), v = new THREE.Vector3( ...vel );
  const pts: THREE.Vector3[] = [toThree( [p.x, p.y, p.z] )];
  let airborne               = false, airtime = 0, maxAir = 0;
  for ( let t = 0; t < seconds; t += dt ) {
    v.y -= 9.81 * dt;
    p.addScaledVector( v, dt );
    const g = terrain.heightAt( p.x, p.z );
    if ( Number.isNaN( g ) ) break;
    if ( p.y <= g ) {
      p.y        = g;
      const n    = terrain.normalAt( p.x, p.z );
      const into = v.dot( n );
      if ( into < 0 ) v.addScaledVector( n, -into );
      if ( airborne ) maxAir = Math.max( maxAir, airtime );
      airborne = false;
      airtime  = 0;
    } else if ( p.y > g + 0.3 ) {
      airborne = true;
      airtime += dt;
    }
    if ( pts.length % 3 === 0 ) pts.push( toThree( [p.x, p.y, p.z] ) );
  }
  return { points: pts, maxAirtime: Math.max( maxAir, airtime ), endSpeed: v.length() };
}
