// Editing a piece's grind rail in the 3D view: its curve, a handle on each of its points, the arrow halfway along it for
// the way up ( the side the game grabs from ), and the rail's capsules round it ( how thick the game takes it to be ).
// Clicking a handle picks that point ( the move gizmo then moves it ); the rotate gizmo turns the arrow, the whole rail's
// way up. Clicking one of its colliders picks that ( the gizmo then moves, turns or sizes it on its own: a RailTweak ).
// The engine wires the clicks, the gizmo and the keys ( engine.ts ).

import * as THREE from "three/webgpu";
import type { CustomObjectEntry, Rail, RailTweak } from "../../core/types";
import { dirToPiece, dirToView, railFromView, railPath, railRuns, railToView, withTweak, type P3, type RailRun } from "../../pieces/rail";
import { railShells, shellMaterial, shellObject } from "./grindGuide";

const CURVE  = 0x4fc3ff;
const HANDLE = 0xffffff;
const PICKED = 0xffb000;
const ARROW  = 0x37d67a;

export class RailTool {
  readonly group = new THREE.Group();
  private piece:  CustomObjectEntry | null = null;
  // the piece as it is in the map ( a curve piece's rail: its curve sampled, where its colliders are made from )
  private real:   CustomObjectEntry | null = null;
  // the points as shown: a point being dragged moves here before it's kept
  private points: P3[] = [];
  // a point's been moved since: the colliders shown along the points as they are now
  private moved   = false;
  // the rail's way up as shown ( piece coordinates ): turned here before it's kept
  private up:     P3 = [0, 1, 0];
  private picked: number | null = null;
  // the picked collider, and its tweak as shown ( changed here before it's kept )
  private collider: number | null = null;
  private tweaks:   RailTweak[] | undefined;
  // turning the rail's way up: just the rail and its arrow, no points
  private turning = false;
  private handles: THREE.Mesh[] = [];
  private shells:  THREE.Mesh[] = [];
  private runs:    RailRun[]    = [];
  // halfway along the rail ( the 3D view ): where the arrow is, and which way the rail runs there
  private mid: { at: THREE.Vector3; along: THREE.Vector3 } | null = null;
  private mats = {
    curve:  new THREE.MeshBasicNodeMaterial( { color: CURVE,  depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 } ),
    handle: new THREE.MeshBasicNodeMaterial( { color: HANDLE, depthTest: false, depthWrite: false, transparent: true } ),
    picked: new THREE.MeshBasicNodeMaterial( { color: PICKED, depthTest: false, depthWrite: false, transparent: true } ),
    arrow:  new THREE.MeshBasicNodeMaterial( { color: ARROW,  depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 } ),
    shell:  shellMaterial(),
    chosen: new THREE.MeshBasicNodeMaterial( { color: PICKED, depthTest: false, depthWrite: false, transparent: true, opacity: 0.6 } ),
  };

  /**
   * Shows `piece`'s rail for editing ( or nothing; `real`: the piece as it is in the map, if its rail is shown by other
   * points ), with point `picked` or collider `collider` highlighted; `turning`: without its points.
  **/
  sync( piece: CustomObjectEntry | null, picked: number | null, turning = false, collider: number | null = null, real: CustomObjectEntry | null = piece ) {
    this.turning  = turning;
    this.piece    = piece?.rail ? piece : null;
    this.real     = this.piece && real?.rail ? real : this.piece;
    this.points   = this.piece ? this.piece.rail!.points.map( ( p ) => [...p] as P3 ) : [];
    this.moved    = false;
    this.up       = [...( this.piece?.rail!.up ?? [0, 1, 0] )] as P3;
    this.picked   = picked !== null && picked < this.points.length ? picked : null;
    this.collider = collider;
    this.tweaks   = this.real?.rail?.tweaks;
    this.rebuild();
  }

  /**
   * A point moved while it's dragged ( piece coordinates ); kept by the engine when the drag ends.
  **/
  preview( i: number, p: P3 ) {
    this.points[i] = p;
    this.moved     = true;
    this.rebuild();
  }

  /**
   * Collider `i` as the gizmo has it while it's dragged ( null: as the rail makes it ); kept by the engine when it ends.
  **/
  previewTweak( i: number, t: Omit<RailTweak, "at"> | null ) {
    const run = this.runs[i];
    if ( !run ) return;
    this.tweaks = withTweak( this.real?.rail?.tweaks, run, t );
    this.rebuild();
  }

  liveTweaks(): RailTweak[] | undefined {
    return this.tweaks;
  }

  /**
   * Collider `i` as it's shown ( where along the rail, as made and as it is ).
  **/
  run( i: number ): RailRun | null {
    return this.runs[i] ?? null;
  }

  /**
   * The collider under a ray, if any.
  **/
  colliderHit( ray: THREE.Raycaster ): number | null {
    const h = ray.intersectObjects( this.shells, false )[0];
    return h ? ( h.object.userData.index as number ) : null;
  }

  /**
   * The rail's way up turned while the arrow's dragged ( the 3D view's direction ); kept by the engine when it ends.
  **/
  previewUp( v: THREE.Vector3 ) {
    if ( !this.piece ) return;
    this.up = dirToPiece( this.piece, v );
    this.rebuild();
  }

  livePoints(): P3[] {
    return this.points.map( ( p ) => [...p] as P3 );
  }

  liveUp(): P3 {
    return [...this.up];
  }

  /**
   * The arrow's foot and frame ( the 3D view ), for the rotate gizmo: its Y the way up, its Z along the rail.
  **/
  arrowFrame(): { at: THREE.Vector3; q: THREE.Quaternion } | null {
    if ( !this.mid ) return null;
    const up = this.upInView( this.mid.along );
    const x  = new THREE.Vector3().crossVectors( up, this.mid.along ).normalize();
    return { at: this.mid.at.clone(), q: new THREE.Quaternion().setFromRotationMatrix( new THREE.Matrix4().makeBasis( x, up, x.clone().cross( up ) ) ) };
  }

  /**
   * The way up in the 3D view, square to the rail where it runs `along` ( as the game takes it ).
  **/
  private upInView( along: THREE.Vector3 ): THREE.Vector3 {
    const up     = dirToView( this.piece!, this.up );
    const square = up.clone().addScaledVector( along, -up.dot( along ) );
    return square.lengthSq() > 1e-6 ? square.normalize() : up;
  }

  /**
   * Where point `i` is in the 3D view.
  **/
  pointInView( i: number ): THREE.Vector3 | null {
    return this.piece?.rail && this.points[i] ? railToView( this.piece, this.piece.rail, this.points[i] ) : null;
  }

  toPiece( w: THREE.Vector3 ): P3 | null {
    return this.piece?.rail ? railFromView( this.piece, this.piece.rail, w ) : null;
  }

  /**
   * The handle under a ray, if any.
  **/
  hit( ray: THREE.Raycaster ): number | null {
    const h = ray.intersectObjects( this.handles, false )[0];
    return h ? ( h.object.userData.index as number ) : null;
  }

  private clear() {
    for ( const c of [...this.group.children] ) {
      this.group.remove( c );
      c.traverse( ( m ) => m instanceof THREE.Mesh && m.geometry.dispose() );
    }
    this.handles = [];
    this.shells  = [];
    this.runs    = [];
    this.mid     = null;
  }

  private rebuild() {
    this.clear();
    const o = this.piece;
    if ( !o?.rail || !this.points.length ) return;
    const rail: Rail = { ...o.rail, points: this.points, up: this.up };
    const path       = railPath( rail ).map( ( p ) => railToView( o, rail, [p.x, p.y, p.z] ) );
    const box        = new THREE.Box3().setFromPoints( path );
    const size       = Math.max( box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z, 0.5 );
    const r          = THREE.MathUtils.clamp( size * 0.006, 0.01, 0.06 );
    if ( path.length >= 2 ) {
      const curve      = new THREE.CatmullRomCurve3( path, false, "centripetal" );
      const tube       = new THREE.Mesh( new THREE.TubeGeometry( curve, Math.max( 16, path.length * 2 ), r, 8, false ), this.mats.curve );
      tube.renderOrder = 1001;
      this.group.add( tube );
      // the rail's capsules, where they'd be now: its thickness ( a curve piece's made along its curve, as in the map,
      // until a point's moved ), each to be picked
      const real  = this.real?.rail && !this.moved ? this.real : o;
      this.runs   = railRuns( real, { ...real.rail!, ...( this.moved ? { points: this.points } : {} ), up: this.up, tweaks: this.tweaks } );
      const shown = shellObject( railShells( this.runs.map( ( r ) => r.made ) ), this.mats.shell );
      shown.children.forEach( ( m, i ) => {
        m.userData = { index: i };
        if ( i === this.collider ) ( m as THREE.Mesh ).material = this.mats.chosen;
        this.shells.push( m as THREE.Mesh );
      } );
      this.group.add( shown );
      // the way up: one arrow, halfway along ( by length )
      const total = path.slice( 1 ).reduce( ( d, p, k ) => d + p.distanceTo( path[k] ), 0 );
      let left    = total / 2;
      for ( let k = 1; k < path.length; k++ ) {
        const d = path[k].distanceTo( path[k - 1] );
        if ( left <= d || k === path.length - 1 ) {
          this.mid = { at: path[k - 1].clone().lerp( path[k], d > 0 ? Math.min( 1, left / d ) : 0 ), along: path[k].clone().sub( path[k - 1] ).normalize() };
          break;
        }
        left -= d;
      }
      if ( this.mid ) {
        const up    = this.upInView( this.mid.along );
        const arrow = new THREE.Mesh( new THREE.ConeGeometry( r * 3, r * 8, 16 ), this.mats.arrow );
        arrow.position.copy( this.mid.at ).addScaledVector( up, r * 7 );
        arrow.quaternion.setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), up );
        arrow.renderOrder = 1002;
        this.group.add( arrow );
      }
    }
    if ( this.turning ) return;
    this.points.forEach( ( p, i ) => {
      const m = new THREE.Mesh( new THREE.SphereGeometry( r * ( i === this.picked ? 3.4 : 2.6 ), 16, 12 ), i === this.picked ? this.mats.picked : this.mats.handle );
      m.position.copy( railToView( o, rail, p ) );
      m.renderOrder = 1002;
      m.userData    = { index: i };
      this.group.add( m );
      this.handles.push( m );
    } );
  }
}
