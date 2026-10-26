// The game's objects placed in the map ( drawn with the game's look: the pieces built for their feature, direction and
// colour; the placeholder model until that's there, and where there's none ), spawns and selection visuals, kept in
// sync with the document store. A lift is its base station at the object, its top station and masts along the line and
// its cable ( pieces/lift.ts ), in the game's look when it's there, its chairs or hangers going round on the cable.

import * as THREE from "three/webgpu";
import { toThree, unityEulerToQuat } from "../../../core/coords";
import type { ObjectEntry, SpawnEntry } from "../../../core/types";
import type { Selection } from "../../../map/store";
import type { Terrain } from "../../../terrain/terrain";
import { redraw } from "../../redraw";
import { withLamps } from "../lamps";
import { PlaceholderLibrary } from "./library";
import { LiftsDrawn } from "./lifts";
import { LooksDrawn } from "./looksDrawn";
import { simulateRide } from "./ride";
import { SpawnsDrawn } from "./spawns";
import { TreesDrawn } from "./trees";

export { PlaceholderLibrary } from "./library";
export { simulateRide } from "./ride";

export const PLACEHOLDER_COLORS: Record<string, number> = {
  blue:          0x3b82f6, red:    0xef4444, green: 0x22c55e, pink:  0xec4899, cyan: 0x06b6d4, orange: 0xf97316,
  "orange+blue": 0xf59e0b, yellow: 0xeab308, white: 0xf1f5f9, black: 0x334155,
};

export const DEFAULT_COLOR = 0x9aa4b2;

export const SELECT_COLOR = 0xffb000;

export const RIDER_HEIGHT = 1.75;

export const unknownGeo = new THREE.BoxGeometry( 1, 1, 1 );

export function colorOf( o: ObjectEntry ) {
  const c = o.params?.color;
  if ( c && c.type === "String" ) return PLACEHOLDER_COLORS[c.value] ?? DEFAULT_COLOR;
  return DEFAULT_COLOR;
}

// A chunk's group of the game's trees ( from a map made elsewhere ): which tree, and its instances as the format
// stores them — 28 bytes each: position as fractions of the chunk, width and height scale, turn ( radians ), tint.
export interface TreeGroup {
  position: [number, number, number];
  size:     [number, number, number];
  id:        string;
  instances: ArrayLike<number>;
}

export class ObjectsRenderer {
  // its parts, each in a file of its own beside this one
  readonly lifts  = new LiftsDrawn( this );  // the lifts
  readonly spawns = new SpawnsDrawn( this ); // the spawns
  readonly trees  = new TreesDrawn( this );  // the game's trees
  readonly looks  = new LooksDrawn( this );  // the game's look on its objects

  readonly group                = new THREE.Group();
  objects                       = new Map<string, THREE.Mesh>();
  lastObjects: ObjectEntry[]    = [];
  // every game look asked for so far, built
  settled:     Promise<unknown> = Promise.resolve();
  private materials             = new Map<number, THREE.MeshStandardNodeMaterial>();
  selectMat         = withLamps( new THREE.MeshStandardNodeMaterial( { color: SELECT_COLOR, emissive: new THREE.Color( SELECT_COLOR ).multiplyScalar( 0.35 ) } ) );
  private boxes     = new THREE.Group();
  rideInfo:   { maxAirtime: number; endSpeed: number } | null = null;
  /**
   * a lift's piece picked ( the selection box goes round it: its base station is the object's own mesh )
  **/
  liftPicked: ( uid: string ) => "base" | "top" | number = () => "base";

  constructor( readonly lib: PlaceholderLibrary, private terrain: Terrain ) {
    this.group.name = "objects";
    this.group.add( this.boxes );
  }

  mat( color: number ) {
    let m = this.materials.get( color );
    if ( !m ) this.materials.set( color, ( m = withLamps( new THREE.MeshStandardNodeMaterial( { color, roughness: 0.55, metalness: 0.1 } ) ) ) );
    return m;
  }

  sync( objects: ObjectEntry[], spawns: SpawnEntry[], selection: Selection[] ) {
    const selObj   = new Set( selection.filter( ( s ) => s.kind === "object" ).map( ( s ) => s.uid ) );
    const selSpawn = new Set( selection.filter( ( s ) => s.kind === "spawn"  ).map( ( s ) => s.uid ) );

    const seen = new Set<string>();
    for ( const o of objects ) {
      seen.add( o.uid );
      let mesh = this.objects.get( o.uid );
      if ( !mesh ) {
        const info      = this.lib.info( o.id );
        mesh            = new THREE.Mesh( ( info && this.lib.loadedFile( info.file ) ) ?? unknownGeo, this.mat( DEFAULT_COLOR ) );
        mesh.userData   = { kind: "object", uid: o.uid };
        mesh.castShadow = true;
        this.objects.set( o.uid, mesh );
        this.group.add( mesh );
        const m = mesh;
        this.lib.geometry( o.id ).then( ( g ) => {
          if ( g ) { m.geometry = g; this.refreshBoxes(); }
        } );
      }
      mesh.position.copy( toThree( o.position ) );
      mesh.quaternion.copy( unityEulerToQuat( o.rotation ) );
      mesh.scale.set( o.scale[0], o.scale[1], o.scale[2] );
      mesh.material = selObj.has( o.uid ) ? this.selectMat : this.mat( colorOf( o ) );
      const isLift  = !!this.lib.info( o.id )?.lift && !!o.lift;
      if ( isLift ) this.lifts.sync( o, mesh, selObj.has( o.uid ) );
      mesh.updateMatrixWorld();
      // ( a lift is drawn from its pieces: the game's look is its carriers' and line's own )
      if ( !isLift ) this.looks.ask( o );
    }
    for ( const [uid, m] of this.objects )
      if ( !seen.has( uid ) ) {
        this.group.remove( m );
        this.objects.delete( uid );
        this.looks.lookOf.delete( uid );
      }
    for ( const [uid, l] of this.lifts.drawn )
      if ( !seen.has( uid ) || !objects.find( ( o ) => o.uid === uid )?.lift ) this.lifts.drop( uid, l );
    this.lastObjects = objects;
    this.looks.layout();

    const seenS = new Set<string>();
    for ( const s of spawns ) {
      seenS.add( s.uid );
      let g = this.spawns.drawn.get( s.uid );
      if ( !g ) {
        g = this.spawns.make( s.uid );
        this.spawns.drawn.set( s.uid, g );
        this.group.add( g );
      }
      this.spawns.update( g, s, selSpawn.has( s.uid ) );
    }
    for ( const [uid, g] of this.spawns.drawn )
      if ( !seenS.has( uid ) ) {
        this.group.remove( g );
        this.spawns.drawn.delete( uid );
      }

    // selection boxes
    this.boxes.clear();
    for ( const uid of selObj ) {
      const part = this.lifts.drawn.has( uid ) ? this.liftPicked( uid ) : "base";
      const m    = part === "base" ? this.objects.get( uid ) : this.lifts.drawn.get( uid )!.g.children.find( ( c ) => c.userData.liftPart === part );
      if ( m ) this.boxes.add( new THREE.BoxHelper( m, SELECT_COLOR ) );
    }

    // ride preview for the ( first ) selected spawn
    if ( this.spawns.ridePath ) {
      this.group.remove( this.spawns.ridePath );
      this.spawns.ridePath = null;
      this.rideInfo        = null;
    }
    const sp = spawns.find( ( s ) => selSpawn.has( s.uid ) );
    if ( sp ) {
      const sim            = simulateRide( this.terrain, sp.position, sp.velocity );
      const geo            = new THREE.BufferGeometry().setFromPoints( sim.points );
      this.spawns.ridePath = new THREE.Line( geo, new THREE.LineBasicNodeMaterial( { color: 0x38bdf8 } ) );
      this.group.add( this.spawns.ridePath );
      this.rideInfo = { maxAirtime: sim.maxAirtime, endSpeed: sim.endSpeed };
    }
  }

  /**
   * The carriers of the lifts in view moved on ( true when any were: the view's drawn again ).
  **/
  animate( camera: THREE.Camera ) {
    if ( document.visibilityState !== "visible" ) return false;
    let moved     = false;
    const frustum = new THREE.Frustum().setFromProjectionMatrix( new THREE.Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse ) );
    const t       = this.lifts.clock();
    for ( const l of this.lifts.drawn.values() ) {
      if ( !l.speed || !l.box || !l.g.visible || !this.group.visible || !frustum.intersectsBox( l.box ) ) continue;
      // ( too far off to see them move )
      if ( l.box.distanceToPoint( camera.position ) > 2500 ) continue;
      if ( l.carriers ) this.lifts.moveCarriers( l.carriers, t );
      for ( const w of l.wheels.values() ) this.lifts.turnWheels( w, l.speed, t );
      moved = true;
    }
    return moved;
  }

  /**
   * Meshes for picking.
  **/
  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    this.objects.forEach( ( m ) => out.push( m ) );
    // ( a lift's placeholder pieces, shown or not: its look's instances aren't picked )
    this.lifts.drawn.forEach( ( l ) => l.g.children.forEach( ( c ) => ( c as THREE.Mesh ).isMesh && c.userData.kind && out.push( c ) ) );
    this.spawns.drawn.forEach( ( g ) => g.traverse( ( o ) => ( o as THREE.Mesh ).isMesh && out.push( o ) ) );
    return out;
  }

  /**
   * The selection boxes fitted again ( a model that's finished loading: the box was round the cube standing in ).
  **/
  refreshBoxes() {
    for ( const b of this.boxes.children as THREE.BoxHelper[] ) b.update();
    redraw();
  }

  /**
   * A lift's pieces as drawn, to pick one by ( its placeholders, shown or not; `userData.liftPart` says which ).
  **/
  liftPieceMeshes( uid: string ): THREE.Object3D[] {
    const l = this.lifts.drawn.get( uid ), base = this.objects.get( uid );
    if ( !l || !base ) return [];
    return [base, ...l.g.children.filter( ( c ) => c.userData.liftPart !== undefined )];
  }

  objectMesh( uid: string ) {
    return this.objects.get( uid );
  }
}
