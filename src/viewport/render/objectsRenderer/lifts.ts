// The lifts drawn: their stations, masts and cable ( in the game's look when it's there ), the chairs or hangers going
// round, the wheels rolling, and the reach of a selected one's drag lift.

import * as THREE from "three/webgpu";
import { toThree, unityEulerToQuat } from "../../../core/coords";
import type { GameSpin } from "../../../core/ipc";
import type { ObjectEntry } from "../../../core/types";
import { type LiftPiece, liftCable, liftPieces, liftStationEnds } from "../../../pieces/lift";
import { redraw } from "../../redraw";
import type { ObjectsRenderer } from "./index";
import { DEFAULT_COLOR, unknownGeo } from "./index";
import { type Carriers, type LiftDraw, type Wheel, liftNumber, rollWithCable } from "./liftParts";
import { LOOK_TO_PLACEHOLDER, plainLook, plainLooksReady } from "./looks";

// The lifts.
export class LiftsDrawn {
  constructor( private objects: ObjectsRenderer ) {}

  // each lift's top station, masts and cable, by object ( with what they were made from )
  drawn = new Map<string, LiftDraw>();
  private cableMat = new THREE.LineBasicNodeMaterial( { color: 0x26262b } );
  // a T-bar's reach ( seen through the ground: where it goes under, riders would )
  private reachMat = new THREE.LineBasicNodeMaterial( { color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false } );

  /**
   * A lift: its base station ( the object's own mesh ) facing up the line, its top station and masts placed and its
   * cable run ( made again when anything they come from changed ); each piece in the game's look once that's come ( the
   * placeholder hidden, still picked as the lift ), and its carriers on the cable.
  **/
  sync( o: ObjectEntry, base: THREE.Mesh, selected: boolean ) {
    const ph   = this.objects.lib.info( o.id )!, info = ph.lift!, pieces = liftPieces( o )!;
    const turn = ( yaw: number ) => unityEulerToQuat( [0, ( yaw * 180 ) / Math.PI, 0] );
    base.quaternion.copy( turn( pieces.base.yaw ) );
    const slack   = liftNumber( o, ph, "slack", 0.5 );
    const spacing = Math.max( 2, liftNumber( o, ph, "spacing", 15 ) );
    const speed   = liftNumber( o, ph, "speed", 3 ) * ( o.params?.reversed?.value === true || o.params?.reversed?.value === "true" ? -1 : 1 );
    const reach   = selected && ph.parameters.some( ( p ) => p.name === "extension" ) ? liftNumber( o, ph, "extension", 3.5 ) * o.scale[1] : 0;
    const key     = JSON.stringify( [o.position, o.rotation, o.scale, o.lift, slack, spacing, speed, selected, reach] );
    let entry     = this.drawn.get( o.uid );
    if ( entry?.key === key ) return;
    if ( !entry ) {
      entry = { key, g: new THREE.Group(), looks: new Map(), carriers: null, speed, box: null, wheels: new Map() };
      this.objects.group.add( entry.g );
      this.drawn.set( o.uid, entry );
    }
    const lift  = entry, g = entry.g;
    lift.key    = key;
    lift.speed  = speed;
    lift.box    = null;
    lift.wheels = new Map();
    // the placeholders and cable made again; the look's instances kept, only moved
    for ( const c of [...g.children] )
      if ( !( c instanceof THREE.InstancedMesh ) ) {
        g.remove( c );
        if ( c instanceof THREE.Line ) c.geometry.dispose();
      }
    const mat         = selected ? this.objects.selectMat : this.objects.mat( DEFAULT_COLOR );
    const placeholder = ( file: string, at: LiftPiece, part: "top" | number ) => {
      const m = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>( this.objects.lib.loadedFile( file ) ?? unknownGeo, mat );
      m.position.copy( toThree( at.at ) );
      m.quaternion.copy( turn( at.yaw ) );
      m.scale.set( o.scale[0], o.scale[1], o.scale[2] );
      m.userData   = { kind: "object", uid: o.uid, liftPart: part };
      m.castShadow = true;
      this.objects.lib.file( file ).then( ( geo ) => geo && ( ( m.geometry = geo ), this.objects.refreshBoxes() ) );
      g.add( m );
      return m;
    };
    // ( a look piece is the game's prefab at half size: twice the lift's scale )
    const size = new THREE.Vector3( ...o.scale ).multiplyScalar( LOOK_TO_PLACEHOLDER );
    /**
     * a piece's look with room for `n` of it ( made again only when it needs more )
    **/
    const instances = ( part: string, tpl: THREE.Mesh[], n: number ) => {
      let ims = lift.looks.get( part );
      if ( !ims || ims[0].instanceMatrix.count < n ) {
        ims?.forEach( ( im ) => ( g.remove( im ), im.dispose() ) );
        const room = 2 ** Math.ceil( Math.log2( Math.max( 1, n ) ) );
        ims        = tpl.map( ( t ) => {
          const im      = new THREE.InstancedMesh( t.geometry, t.material, room );
          im.castShadow = true;
          g.add( im );
          return im;
        } );
        lift.looks.set( part, ims );
      }
      for ( const im of ims ) im.count = n;
      return ims;
    };
    const whenLook = ( part: string, then: ( tpl: THREE.Mesh[] | null ) => void ) => {
      const k   = `${o.id}:${part}`;
      // ( a stale answer, the lift changed since it was asked for: the newer one's dressed it )
      const put = ( tpl: THREE.Mesh[] | null ) => this.drawn.get( o.uid ) === lift && lift.key === key && then( tpl );
      if ( plainLooksReady.has( k ) ) put( plainLooksReady.get( k )! );
      else plainLook( k ).then( put );
    };
    const at    = new THREE.Matrix4();
    const ends  = liftStationEnds( o, info );
    const dress = ( part: string, where: LiftPiece[], placeholders: THREE.Mesh[] ) =>
      whenLook( part, ( tpl ) => {
        if ( !tpl ) return;
        const still = tpl.filter( ( t ) => !t.userData.spin ), spun = tpl.filter( ( t ) => t.userData.spin );
        instances( part, still, where.length ).forEach( ( im, j ) => {
          where.forEach( ( p, i ) => im.setMatrixAt( i, at.compose( toThree( p.at ), turn( p.yaw ), size ).multiply( still[j].matrixWorld ) ) );
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingSphere();
        } );
        // its wheels, each placed and turned on its own
        for ( const w of lift.wheels.get( part ) ?? [] ) g.remove( w.mesh );
        const wheels: Wheel[] = [];
        for ( const t of spun ) {
          const spin = t.userData.spin as GameSpin;
          for ( const p of where ) {
            const mesh            = new THREE.Mesh( t.geometry, t.material );
            mesh.castShadow       = true;
            mesh.matrixAutoUpdate = false;
            g.add( mesh );
            const w = { mesh, place: at.compose( toThree( p.at ), turn( p.yaw ), size ).multiply( t.matrixWorld ).clone(), pivot: new THREE.Vector3( ...spin.pivot ), axis: new THREE.Vector3( ...spin.axis ).normalize(), cycles: spin.cycles };
            if ( part === "base" || part === "top" ) rollWithCable( w, t.geometry, ends?.[part] ?? [] );
            wheels.push( w );
          }
        }
        lift.wheels.set( part, wheels );
        this.turnWheels( wheels, lift.speed, this.clock() );
        for ( const m of placeholders ) m.visible = false;
        redraw();
      } );
    base.visible           = true;
    base.userData.liftPart = "base";
    dress( "base", [pieces.base], [base] );
    dress( "top",  [pieces.top ], [placeholder( info.top.file, pieces.top, "top" )] );
    if ( info.mast ) dress( "mast", pieces.masts, pieces.masts.map( ( m, i ) => placeholder( info.mast!.file, m, i ) ) );
    const cable   = liftCable( o, info, slack );
    lift.carriers = null;
    lift.looks.get( "carrier" )?.forEach( ( im ) => ( im.count = 0 ) );
    if ( cable ) {
      const pts = cable.map( ( c ) => toThree( c ) );
      pts.push( pts[0].clone() );
      g.add( new THREE.Line( new THREE.BufferGeometry().setFromPoints( pts ), this.cableMat ) );
      lift.box   = new THREE.Box3().setFromPoints( pts ).expandByScalar( 6 );
      // what it carries, spaced round the loop
      const loop = [...cable, cable[0]], dist = [0];
      for ( let i = 1; i < loop.length; i++ ) dist.push( dist[i - 1] + Math.hypot( loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1], loop[i][2] - loop[i - 1][2] ) );
      const n = Math.floor( dist[dist.length - 1] / spacing );
      whenLook( "carrier", ( tpl ) => {
        if ( !tpl || n < 1 ) return;
        const meshes = instances( "carrier", tpl, n );
        for ( const im of meshes ) im.frustumCulled = false;
        // ( picked, a lift with an Extension: each bar's reach )
        let guide: Carriers["guide"] = null;
        if ( reach > 0 ) {
          const low = new THREE.Box3();
          for ( const t of tpl ) {
            t.geometry.computeBoundingBox();
            low.union( t.geometry.boundingBox!.clone().applyMatrix4( t.matrixWorld ) );
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute( "position", new THREE.BufferAttribute( new Float32Array( n * 6 * 3 ), 3 ) );
          const line         = new THREE.LineSegments( geo, this.reachMat );
          line.frustumCulled = false;
          line.renderOrder   = 12;
          g.add( line );
          guide = { line, bottom: low.min.y * size.y, reach };
        }
        lift.carriers = { loop, at: dist, n, speed, scale: size, templates: tpl, meshes, box: lift.box!, guide };
        this.moveCarriers( lift.carriers, this.clock() );
        redraw();
      } );
    }
    redraw();
  }

  /**
   * Seconds the carriers have been going ( the same for every lift: one moved stays in step ).
  **/
  clock() {
    return performance.now() / 1000;
  }

  /**
   * The carriers where they are at time `t`: each a share of the way round, hanging straight down, facing the way
   * the cable goes.
  **/
  moveCarriers( c: Carriers, t: number ) {
    const total = c.at[c.at.length - 1], gap = total / c.n;
    const m     = new THREE.Matrix4(), part = new THREE.Matrix4(), q = new THREE.Quaternion();
    let seg     = 1;
    // ( round the loop in order: the segment each one's on found by walking on from the last )
    const shift = ( ( ( t * c.speed ) % total ) + total ) % total;
    const first = shift % gap;
    for ( let k = 0; k < c.n; k++ ) {
      const d = first + k * gap;
      while ( seg < c.at.length - 1 && c.at[seg] < d ) seg++;
      const a   = c.loop[seg - 1], b = c.loop[seg], f = ( d - c.at[seg - 1] ) / Math.max( 1e-6, c.at[seg] - c.at[seg - 1] );
      const p   = toThree( [a[0] + ( b[0] - a[0] ) * f, a[1] + ( b[1] - a[1] ) * f, a[2] + ( b[2] - a[2] ) * f] );
      const dx  = b[0] - a[0], dz = b[2] - a[2];
      // ( going backwards it still faces the way it goes )
      const yaw = Math.atan2( dx, dz ) + ( c.speed < 0 ? Math.PI : 0 );
      q.copy( unityEulerToQuat( [0, ( yaw * 180 ) / Math.PI, 0] ) );
      m.compose( p, q, c.scale );
      c.templates.forEach( ( tp, i ) => c.meshes[i].setMatrixAt( k, part.multiplyMatrices( m, tp.matrixWorld ) ) );
      if ( c.guide ) {
        // ( straight down from the bar: it hangs straight down )
        const pos = c.guide.line.geometry.attributes.position as THREE.BufferAttribute;
        const top = p.y + c.guide.bottom, end = top - c.guide.reach, t = 0.35;
        const v   = [p.x, top, p.z, p.x, end, p.z, p.x - t, end, p.z, p.x + t, end, p.z, p.x, end, p.z - t, p.x, end, p.z + t];
        pos.array.set( v, k * 18 );
      }
    }
    for ( const im of c.meshes ) im.instanceMatrix.needsUpdate = true;
    if ( c.guide ) c.guide.line.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * A lift's wheels turned to where they are at time `t`: as the game turns them, by the cable run so far ( the game's
   * drive: metres, kept to 1000 — a wheel makes whole turns in that, so it never jumps ).
  **/
  turnWheels( ws: Wheel[], speed: number, t: number ) {
    if ( !ws.length ) return;
    const drive = ( ( ( speed * t ) % 1000 ) + 1000 ) % 1000;
    const S     = new THREE.Matrix4().makeScale( 1, 1, -1 ), m = new THREE.Matrix4(), r = new THREE.Matrix4(), back = new THREE.Matrix4();
    for ( const w of ws ) {
      // about its pivot ( Unity space ), then into the view's ( its mesh is: z the other way )
      r.makeRotationAxis( w.axis, ( 2 * Math.PI * w.cycles * drive ) / 1000 );
      m.makeTranslation( w.pivot.x, w.pivot.y, w.pivot.z ).multiply( r ).multiply( back.makeTranslation( -w.pivot.x, -w.pivot.y, -w.pivot.z ) );
      w.mesh.matrix.multiplyMatrices( w.place, S ).multiply( m ).multiply( S );
      w.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  drop( uid: string, l: LiftDraw ) {
    this.objects.group.remove( l.g );
    l.g.traverse( ( x ) => {
      if ( x instanceof THREE.Line ) x.geometry.dispose();
      else if ( x instanceof THREE.InstancedMesh ) x.dispose();
    } );
    this.drawn.delete( uid );
  }
}
