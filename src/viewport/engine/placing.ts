// Putting things on the map: the game's objects and lifts, library pieces dragged in ( with their ghost ), spawns.

import * as THREE from "three/webgpu";
import { quatToUnityEuler, toUnity, type V3 } from "../../core/coords";
import { type ObjectEntry } from "../../core/types";
import { newUid, paramDefault, useEditor } from "../../map/store";
import { primitive } from "../../model/mesh";
import { newModelObject } from "../../model/objects";
import { withAutoMasts } from "../../pieces/lift";
import { terrain } from "../../terrain/terrain";
import type { Engine } from "./engine";

// Things put down on the map, and the ghosts that show where.
export class Placing {
  constructor( private engine: Engine ) {}

  // the Place tool's game object, following the mouse ( a box until its model has loaded )
  ghost = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>( new THREE.BoxGeometry( 1, 1, 1 ), new THREE.MeshStandardNodeMaterial( { color: 0x38bdf8, transparent: true, opacity: 0.5 } ) );
  // Called when the place tool clicks the terrain with a library item chosen ( Unity coords ).
  onPlaceEntry: ( ( id: string, at: V3, rot: V3 ) => void ) | null = null;
  // The library piece being placed, measured at rest: how far its lowest point is below its origin, and its
  // footprint ( half the larger of width/length ). Kept after the ghost goes, for the drop that follows.
  private ghostFit = { bottom: 0, half: 1 };
  // A piece dragged in from the asset browser and held still: its spot is kept, and from then on the mouse turns it
  // to face the way it is from there ( Ctrl: in 15° steps ) until it's let go. `aimLine` ( screen points ) for the view.
  private libAim: { hit: THREE.Vector3; facing: THREE.Vector3 | null } | null = null;
  aimLine:  { from: [number, number]; to: [number, number] } | null = null;
  // The library item being dragged in or placed: the real piece, following the cursor.
  libGhost: THREE.Object3D | null = null;

  /**
   * The Add Cube tool: a cube sitting where it's clicked, selected.
  **/
  addCubeAt( at: THREE.Vector3 ) {
    const mesh = primitive( "cube" ), u = toUnity( at );
    const o    = newModelObject( newUid(), mesh, [u[0], u[1] + 1, u[2]] );
    useEditor.getState().addCustom( o, "Cube" );
    useEditor.getState().setSelection( [{ kind: "custom", uid: o.uid }] );
  }

  /**
   * Yaw faces away from the camera ( so features run "into" the view ); pitch follows the slope if aligning.
  **/
  placementRotation( hit: THREE.Vector3 ) {
    const fwd = new THREE.Vector3().subVectors( hit, this.engine.camera.position ).setY( 0 ).normalize();
    const q   = new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 0, -1 ), fwd );
    if ( useEditor.getState().alignToSurface ) {
      const n      = terrain.normalAt( hit.x, -hit.z );
      const nThree = new THREE.Vector3( n.x, n.y, -n.z );
      const up     = new THREE.Vector3( 0,   1,   0    ).applyQuaternion( q );
      q.premultiply( new THREE.Quaternion().setFromUnitVectors( up, nThree ) );
    }
    return q;
  }

  /**
   * One of the game's objects ( a lift… ) dropped at a screen point from the asset bar: put down on the ground there
   * ( the floor of an empty map ), as the Place tool would. Whether it was.
  **/
  dropObject( id: string, clientX: number, clientY: number ): boolean {
    const l   = this.engine.local( { clientX, clientY } );
    // ( held still a moment before letting go: where it was held )
    const hit = this.libAim?.hit.clone() ?? this.engine.pickTerrain( l.x, l.y );
    if ( !hit ) return false;
    this.placeObject( id, hit );
    return true;
  }

  /**
   * What follows the mouse as a lift's card is dragged in: its base station's model.
  **/
  async liftGhost( id: string ): Promise<THREE.Object3D> {
    const g   = new THREE.Group(), info = this.engine.lib.info( id )?.lift;
    const geo = info ? await this.engine.lib.file( info.base.file ) : null;
    if ( geo ) g.add( new THREE.Mesh( geo, new THREE.MeshStandardNodeMaterial( { color: 0x9aa4b2, roughness: 0.6 } ) ) );
    return g;
  }

  placeObject( id: string, hit: THREE.Vector3 ) {
    const st                            = useEditor.getState();
    const info                          = this.engine.lib.info( id );
    const params: ObjectEntry["params"] = {};
    for ( const p of info?.parameters ?? [] ) params[p.name] = paramDefault( p );
    if ( info?.lift ) return st.addObject( this.newLift( id, hit, params ) );
    const s = st.defaultPlaceholderScale;
    st.addObject( {
      uid: newUid(),
      id,
      position: toUnity( hit ),
      rotation: quatToUnityEuler( this.placementRotation( hit ) ),
      scale: [s, s, s],
      params,
    } );
  }

  /**
   * A lift put down at `hit`: its base station there, its top 80 m on into the view on the ground, masts between
   * ( its own space unturned and at its full size, as the game's are ).
  **/
  private newLift( id: string, hit: THREE.Vector3, params: ObjectEntry["params"] ): ObjectEntry {
    const at             = toUnity( hit ), fwd = new THREE.Vector3().subVectors( hit, this.engine.camera.position ).setY( 0 ).normalize();
    const f              = toUnity( fwd ), end: [number, number, number] = [at[0] + f[0] * 80, 0, at[2] + f[2] * 80];
    const g              = terrain.heightAt( end[0], end[2] );
    end[1]               = Number.isNaN( g ) ? at[1] : g;
    const o: ObjectEntry = {
      uid: newUid(),
      id,
      position: at,
      rotation: [0, 0, 0],
      scale:    [1, 1, 1],
      params,
      lift:     { endPosition: { x: end[0] - at[0], y: end[1] - at[1], z: end[2] - at[2] }, masts: [] },
      // ( its masts spaced on the ground every 40 m, again as its ends move, until one's put by hand )
      liftAuto: this.engine.lib.info( id )?.lift?.mast ? 40 : undefined,
    };
    return withAutoMasts( o, ( x, z ) => terrain.heightAt( x, z ) );
  }

  /**
   * Where a library piece goes when put down at `hit`: turned to face away from the camera, tilted to follow the
   * ground under its whole footprint ( as features in working maps are ), and lifted so its underside sits on the
   * ground rather than its origin.
  **/
  libraryPlacement( hit: THREE.Vector3, facing?: THREE.Vector3 ): { pos: V3; rot: V3; q: THREE.Quaternion; p: THREE.Vector3 } {
    // ( facing away from the camera, unless it's been aimed )
    const fwd = ( facing?.clone() ?? new THREE.Vector3().subVectors( hit, this.engine.camera.position ) ).setY( 0 ).normalize();
    const q   = new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 0, -1 ), fwd );
    let up    = new THREE.Vector3( 0, 1, 0 );
    if ( useEditor.getState().alignToSurface ) {
      // the ground's tilt across the piece's footprint ( not the bump right under the cursor )
      const n = terrain.normalAt( hit.x, -hit.z, Math.max( 0.5, this.ghostFit.half ) );
      up      = new THREE.Vector3( n.x, n.y, -n.z ).normalize();
      q.premultiply( new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), up ) );
    }
    const p = hit.clone().addScaledVector( up, -this.ghostFit.bottom );
    return { pos: toUnity( p ), rot: quatToUnityEuler( q ), q, p };
  }

  /**
   * Placement for a drop at a screen point ( asset browser drags ): where it was aimed, if it was.
  **/
  libraryPlacementAt( clientX: number, clientY: number ): { pos: V3; rot: V3 } | null {
    if ( this.libAim ) {
      const { pos, rot } = this.libraryPlacement( this.libAim.hit, this.libAim.facing ?? undefined );
      return { pos, rot };
    }
    const l   = this.engine.local( { clientX, clientY } );
    const hit = this.engine.pickTerrain( l.x, l.y );
    if ( !hit ) return null;
    const { pos, rot } = this.libraryPlacement( hit );
    return { pos, rot };
  }

  holdLibraryGhost() {
    if ( !this.libGhost?.visible || this.libAim ) return;
    const hit = this.engine.pickTerrain( this.engine.mouse.x, this.engine.mouse.y );
    if ( hit ) this.libAim = { hit, facing: null };
  }

  setLibraryGhost( obj: THREE.Object3D | null ) {
    if ( this.libGhost ) this.engine.scene.remove( this.libGhost );
    this.libGhost = obj;
    this.libAim   = null;
    this.aimLine  = null;
    if ( obj ) {
      obj.position.set( 0, 0, 0 );
      obj.quaternion.identity();
      obj.updateMatrixWorld( true );
      const box = new THREE.Box3().setFromObject( obj );
      if ( !box.isEmpty() ) this.ghostFit = { bottom: box.min.y, half: Math.max( box.max.x - box.min.x, box.max.z - box.min.z ) / 2 };
      obj.visible = false;
      obj.traverse( ( o ) => ( o.userData = {} ) ); // not pickable
      this.engine.scene.add( obj );
    }
  }

  /**
   * Moves the library ghost under a screen position ( drags from the asset browser ); false when off the terrain.
  **/
  moveLibraryGhost( clientX: number, clientY: number, snap = false ): boolean {
    if ( !this.libGhost ) return false;
    const p = this.engine.local( { clientX, clientY } );
    this.engine.mouse.set( p.x, p.y );
    if ( this.libAim ) {
      // aiming: the way to the mouse from the spot ( a few pixels from it: as it was )
      const a      = this.libAim, [sx, sy] = this.engine.screenOf( a.hit );
      this.aimLine = { from: [sx, sy], to: [p.x, p.y] };
      if ( Math.hypot( p.x - sx, p.y - sy ) > 12 ) {
        const to = this.engine.pickTerrain( p.x, p.y ) ?? this.engine.ray( p.x, p.y ).ray.intersectPlane( new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), -a.hit.y ), new THREE.Vector3() );
        if ( to ) {
          let yaw = Math.atan2( to.x - a.hit.x, to.z - a.hit.z );
          if ( snap ) yaw = Math.round( yaw / ( Math.PI / 12 ) ) * ( Math.PI / 12 );
          a.facing = new THREE.Vector3( Math.sin( yaw ), 0, Math.cos( yaw ) );
        }
      }
      const pl = this.libraryPlacement( a.hit, a.facing ?? undefined );
      this.libGhost.position.copy( pl.p );
      this.libGhost.quaternion.copy( pl.q );
      this.libGhost.visible = true;
      return true;
    }
    const hit             = this.engine.pickTerrain( p.x, p.y );
    this.libGhost.visible = !!hit;
    if ( hit ) {
      const pl = this.libraryPlacement( hit );
      this.libGhost.position.copy( pl.p );
      this.libGhost.quaternion.copy( pl.q );
    }
    return !!hit;
  }

  placeSpawn( hit: THREE.Vector3 ) {
    const st  = useEditor.getState();
    const fwd = new THREE.Vector3().subVectors( hit, this.engine.camera.position ).setY( 0 ).normalize();
    const n   = st.spawns.length + 1;
    st.addSpawn( { uid: newUid(), name: `Spawn ${n}`, ...spawnOnGround( toUnity( hit ), toUnity( fwd ) ) } );
  }

  updateGhostGeometry() {
    const id = useEditor.getState().placeId;
    if ( !id ) return;
    this.engine.lib.geometry( id ).then( ( g ) => {
      if ( g && useEditor.getState().placeId === id ) this.ghost.geometry = g;
    } );
  }
}

/**
 * A spawn as working maps have them ( measured on MLNZ Park: 1.0–1.3 m above the ground, tipped forward to the
 * slope it faces down, moving along that slope ): `at` on the ground, `dir` the way it faces ( Unity XZ ).
**/
export function spawnOnGround( at: V3, dir: V3, speed = 10 ): { position: V3; rotation: V3; velocity: V3 } {
  const len   = Math.hypot( dir[0], dir[2] ) || 1;
  const fx    = dir[0] / len, fz = dir[2] / len;
  // the ground's drop over a few metres ahead ( spawns face downhill )
  const d     = 3;
  const h0    = terrain.heightAt( at[0] - fx * d, at[2] - fz * d ), h1 = terrain.heightAt( at[0] + fx * d, at[2] + fz * d );
  const drop  = Number.isNaN( h0 ) || Number.isNaN( h1 ) ? 0 : ( h0 - h1 ) / ( 2 * d );
  const pitch = Math.max( -45, Math.min( 60, ( Math.atan( drop ) * 180 ) / Math.PI ) );
  const yaw   = ( Math.atan2( fx, fz ) * 180 ) / Math.PI;
  const c     = Math.cos( ( pitch * Math.PI ) / 180 ), s = Math.sin( ( pitch * Math.PI ) / 180 );
  return {
    position: [at[0], at[1] + 1.2, at[2]],
    rotation: [( ( pitch % 360 ) + 360 ) % 360, ( ( yaw % 360 ) + 360 ) % 360, 0],
    velocity: [fx * c * speed, -s * speed, fz * c * speed],
  };
}
