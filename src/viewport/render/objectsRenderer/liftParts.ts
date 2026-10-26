// What a drawn lift is made of: its stations, masts and cable, its chairs or hangers going round, and the wheels that
// roll with the cable.

import * as THREE from "three/webgpu";
import type { V3 } from "../../../core/coords";
import type { ObjectEntry, PlaceholderInfo } from "../../../core/types";

// A lift drawn: its pieces and cable, and what its cable carries going round ( when the game's look has them ).
export interface LiftDraw {
  key:      string;
  g:        THREE.Group;
  // each piece's look ( base, top, mast, carrier ): its instances, kept as the lift's edited ( only moved )
  looks:    Map<string, THREE.InstancedMesh[]>;
  carriers: Carriers | null;
  // its cable's speed ( m/s, signed ) and where it runs, for what moves with it
  speed:    number;
  box:      THREE.Box3 | null;
  // each piece's wheels the game turns as the cable runs
  wheels:   Map<string, Wheel[]>;
}

// A wheel on one of a lift's pieces, placed ( `place`: the piece, then the part in it ), turning about its pivot and
// axis ( the piece's frame, Unity space ) `cycles` whole turns per 1000 m of cable. A mesh of its own, not an instance:
// three makes a shader for each instanced mesh, where plain ones with the same material share one ( a T-bar's 38 wheels
// as instances held the view up a second the first time they were close ).
export interface Wheel {
  mesh:   THREE.Mesh;
  place:  THREE.Matrix4;
  pivot:  THREE.Vector3;
  axis:   THREE.Vector3;
  cycles: number;
}

/**
 * A station's wheel the cable comes in or goes out on turned so its rim goes the cable's way there ( `ends`: the
 * station's, Unity space ). The game turns each as baked, and bakes a rope tow's pulley against its rope.
**/
export function rollWithCable( w: Wheel, geo: THREE.BufferGeometry, ends: { at: V3; dir: V3 }[] ) {
  const S      = new THREE.Matrix4().makeScale( 1, 1, -1 );
  // ( the wheel's frame in the lift's Unity space )
  const toLift = S.clone().multiply( w.place ).multiply( S );
  const pos    = geo.attributes.position, v = new THREE.Vector3();
  let rim      = 0;
  for ( let i = 0; i < pos.count; i++ ) {
    v.set( pos.getX( i ), pos.getY( i ), -pos.getZ( i ) ).sub( w.pivot );
    rim = Math.max( rim, v.addScaledVector( w.axis, -v.dot( w.axis ) ).length() );
  }
  rim        *= toLift.getMaxScaleOnAxis();
  const pivot = w.pivot.clone().applyMatrix4( toLift );
  const axis  = w.axis.clone().transformDirection( toLift ).multiplyScalar( toLift.determinant() < 0 ? -1 : 1 );
  for ( const e of ends ) {
    const r = new THREE.Vector3( ...e.at ).sub( pivot ), along = r.dot( axis );
    r.addScaledVector( axis, -along );
    if ( Math.abs( along ) > rim * 0.5 + 0.05 || Math.abs( r.length() - rim ) > rim * 0.25 + 0.05 ) continue;
    if ( axis.clone().multiplyScalar( Math.sign( w.cycles ) ).cross( r ).dot( new THREE.Vector3( ...e.dir ) ) < 0 ) w.cycles = -w.cycles;
    return;
  }
}

// A lift's chairs or hangers: spaced evenly round the cable's loop ( Unity space, closed ), going round at `speed`
// ( m/s, up the line on the side going up; backwards when reversed ).
export interface Carriers {
  loop:      V3[];
  // the distance round the loop at each of its points
  at:        number[];
  n:         number;
  speed:     number;
  scale:     THREE.Vector3;
  templates: THREE.Mesh[];
  meshes:    THREE.InstancedMesh[];
  box:       THREE.Box3;
  // a T-bar's reach, shown while it's picked: from each bar ( `bottom`, below where it hangs from ) down as far as its
  // rope reels out ( `reach`: its Extension — the game's rope length for a rider ), a cross at the end
  guide:     { line: THREE.LineSegments; bottom: number; reach: number } | null;
}

/**
 * A lift setting ( a number ), or its default.
**/
export function liftNumber( o: ObjectEntry, info: PlaceholderInfo | undefined, name: string, fallback: number ) {
  const v = o.params?.[name];
  if ( v && ( v.type === "Float" || v.type === "Int" ) ) return Number( v.value );
  const d = info?.parameters.find( ( p ) => p.name === name )?.default;
  return typeof d === "number" ? d : fallback;
}
