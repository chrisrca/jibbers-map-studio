// A sculpt stroke: turns cursor movement into brush dabs ( spacing, stabilizer, jitter, pressure, symmetry, the
// Line / Anchored / Drag Dot methods ) and applies the brush. Every tile it touches is snapshotted first, so the
// whole stroke undoes as one step, and brushes that need "the ground as it was" ( Layer, Noise, replays ) read from
// those snapshots. Brushes that build ( Draw, Clay, Crease, Pinch, Enhance ) work from that ground too, by how much
// of each point the stroke has covered at most: going over a spot again in one stroke doesn't pile up; the next
// stroke builds on this one. Coordinates are Unity XZ.
//
// A big brush on fine ground ( 90 m across 0.24 m samples: 850 000 of them a dab ) works out the smooth parts of a dab
// ( its weights, blurs, planes, coverage ) on a coarser lattice of about 40 points a radius ( window.ts Lattice ), and the
// noise once a stroke; the new heights are still made at every sample. The dabs of one move share a window: read once,
// each worked on it in turn, written back once.

import { history } from "../../map/history";
import type { Terrain } from "../../terrain/terrain";
import { brushInfo, type BrushId, type BrushSettings, type SculptState } from "../brushes";
import { makeTip } from "../tip";
import { HeightWindow, Lattice, type Box } from "../window";
import { StrokeMask } from "./mask";
import { StrokeMoves } from "./moves";
import { StrokeOps } from "./ops";
import { StrokeUndo } from "./undo";

export interface StrokeInput {
  x:         number;
  z:         number;
  // pen pressure 0..1 ( 1 for a mouse )
  pressure?: number;
}

export interface StrokeOptions {
  // Ctrl held: the brush's other direction
  invert?: boolean;
  // Shift held: smooth instead
  smooth?: boolean;
}

export interface MaskSnap {
  ci:   number;
  i0:   number;
  j0:   number;
  w:    number;
  h:    number;
  data: Uint8Array;
}

// One dab at one place ( after symmetry ).
export interface Dab {
  x:        number;
  z:        number;
  r:        number;
  strength: number;
  // tip rotation, radians
  angle:    number;
  // stroke direction ( unit ), 0 before the stroke moves
  dx:       number;
  dz:       number;
  // a mirrored copy ( turns the other way )
  mirrored: boolean;
}

export const SMOOTH_DEFAULT_SPACING = 0.12;

/**
 * A small fast seeded random generator ( mulberry32 ): jitter that replays the same when a stroke is redone.
**/
export function rng( seed: number ) {
  let a = seed >>> 0;
  return () => {
    a     = ( a + 0x6d2b79f5 ) >>> 0;
    let t = a;
    t     = Math.imul( t ^ ( t >>> 15 ), t | 1 );
    t    ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
    return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
  };
}

// Coverage blocks: 256 × 256 lattice points.
export const BLOCK = 256;

export class BrushStroke {
  // its parts, each in a file of its own beside this one
  readonly ops   = new StrokeOps( this );   // the brushes' maths
  readonly moves = new StrokeMoves( this ); // cursor moves into dabs
  readonly mask  = new StrokeMask( this );  // the Mask brush
  readonly undo  = new StrokeUndo( this );  // snapshots and undo

  readonly id:   BrushId;
  readonly s:    BrushSettings;
  readonly sc:   SculptState;
  // +1 the brush's normal direction, -1 inverted
  readonly sign: 1 | -1;
  readonly t:    Terrain;
  seed = ( Math.random() * 2 ** 31 ) | 0;
  rand = rng( this.seed );
  // where the stroke started
  readonly start:       [number, number];
  readonly startHeight: number;
  cursor: [number, number];
  changed      = false;
  // samples between the points a dab's smooth parts are worked out at ( 1: every sample )
  private step = 0;
  // dabs made by the move under way, applied together when it's done
  private pending: Dab[] = [];
  batching = false;

  constructor( t: Terrain, sc: SculptState, start: [number, number], opts: StrokeOptions = {} ) {
    this.t           = t;
    this.sc          = structuredClone( sc );
    this.id          = opts.smooth && sc.brush !== "mask" ? "smooth" : sc.brush;
    this.s           = structuredClone( sc.brushes[this.id] );
    const inv        = this.s.invert !== !!( opts.invert && this.id !== "flatten" );
    this.sign        = inv ? -1 : 1;
    this.start       = start;
    this.cursor      = start;
    const h          = t.heightAt( start[0], start[1] );
    this.startHeight = Number.isNaN( h ) ? this.s.targetHeight : h;
  }

  /**
   * Where the brush is ( the stabilized point, or the anchor ), for drawing it.
  **/
  get brushPoint(): [number, number] {
    if ( this.s.stroke === "anchored" ) return this.start;
    return this.moves.lazy ?? this.cursor;
  }
  /**
   * The brush radius now ( Anchored: set by dragging ).
  **/
  get radius() {
    if ( this.s.stroke === "anchored" ) return this.anchoredRadius();
    return this.sc.radius;
  }
  /**
   * Stroke methods that redo the whole stroke on every move.
  **/
  get replays() {
    return this.s.stroke === "line" || this.s.stroke === "anchored" || this.s.stroke === "dragdot";
  }
  /**
   * The start point and the cursor, for drawing Line strokes.
  **/
  get line(): [[number, number], [number, number]] | null {
    return this.s.stroke === "line" ? [this.start, this.cursor] : null;
  }

  anchoredRadius() {
    const d = Math.hypot( this.cursor[0] - this.start[0], this.cursor[1] - this.start[1] );
    return d < 0.5 ? this.sc.radius : d;
  }

  /**
   * The cursor moved to `inp` ( dabs along the way, as the stroke's method lays them ).
  **/
  move( inp: StrokeInput ) {
    this.moves.move( inp );
  }

  /**
   * Called every frame while the button is held: Airbrush keeps spraying where it is.
  **/
  hold( dtMs: number, pressure = 1 ) {
    this.moves.hold( dtMs, pressure );
  }

  // ---------------------------------------------------------------- dabs

  /**
   * One dab ( plus its symmetric copies ).
  **/
  dab( x: number, z: number, pressure = 1, radius = this.sc.radius ) {
    const s = this.s, sc = this.sc, R = this.rand;
    if ( s.jitter > 0 ) {
      const a = R() * Math.PI * 2, d = Math.sqrt( R() ) * s.jitter * radius;
      x      += Math.cos( a ) * d;
      z      += Math.sin( a ) * d;
    }
    let r = radius * ( sc.pressureSize ? 0.2 + 0.8 * pressure : 1 );
    if ( s.sizeJitter > 0 ) r *= Math.max( 0.1, 1 + s.sizeJitter * ( R() * 2 - 1 ) );
    let str = s.strength * ( sc.pressureStrength ? pressure : 1 );
    if ( s.strengthJitter > 0 ) str *= 1 - s.strengthJitter * R();
    let angle = ( s.rotation * Math.PI ) / 180;
    if ( s.rotationFollow && ( this.moves.dir[0] || this.moves.dir[1] ) ) angle += Math.atan2( this.moves.dir[1], this.moves.dir[0] );
    if ( s.rotationJitter > 0 ) angle += ( R() * 2 - 1 ) * Math.PI * s.rotationJitter;
    this.pending.push( ...this.symmetric( { x, z, r, strength: str, angle, dx: this.moves.dir[0], dz: this.moves.dir[1], mirrored: false } ) );
    if ( !this.batching ) this.flushDabs();
  }

  /**
   * The dab and its mirror/radial copies.
  **/
  private symmetric( d: Dab ): Dab[] {
    const sym = this.sc.symmetry;
    if ( !sym.x && !sym.z && sym.radial <= 1 ) return [d];
    const b         = this.t.bounds();
    const [px, pz]  = sym.pivot ?? [( b.x0 + b.x1 ) / 2, ( b.z0 + b.z1 ) / 2];
    let list: Dab[] = [d];
    if ( sym.x ) list = list.flatMap( ( q ) => [q, { ...q, x: 2 * px - q.x, dx: -q.dx, angle: Math.PI - q.angle, mirrored: !q.mirrored }] );
    if ( sym.z ) list = list.flatMap( ( q ) => [q, { ...q, z: 2 * pz - q.z, dz: -q.dz, angle: -q.angle, mirrored: !q.mirrored }] );
    const n = Math.max( 1, Math.round( sym.radial ) );
    if ( n > 1 )
      list = list.flatMap( ( q ) =>
        Array.from( { length: n }, ( _, k ) => {
          const a  = ( k * 2 * Math.PI ) / n, ca = Math.cos( a ), sa = Math.sin( a );
          const ox = q.x - px, oz = q.z - pz;
          return { ...q, x: px + ox * ca - oz * sa, z: pz + ox * sa + oz * ca, dx: q.dx * ca - q.dz * sa, dz: q.dx * sa + q.dz * ca, angle: q.angle + a };
        } ),
      );
    return list;
  }

  /**
   * How far beyond the radius a brush reads the ground ( blur kernels, smudge reach, pinching ).
  **/
  private margin( r: number, sp: number ) {
    switch ( this.id ) {
      case "smooth":
        return Math.max( sp * 2, this.s.featureSize * r * 1.2 );
      case "smudge":
        return this.moves.spacingMetres() * 2 + sp * 2;
      case "pinch":
      case "crease":
        return Math.max( sp * 2, r * 0.5 );
      default:
        return sp * 2;
    }
  }

  /**
   * The coarse step for the stroke and the finest sample spacing under the map.
  **/
  private lattice() {
    const probe = this.t.chunks.reduce( ( m, c ) => Math.min( m, c.spacing ), Infinity );
    // ( the stroke's own: its coverage and noise are kept on that lattice. Pinch and crease move the ground sideways
    // by how much the stroke covered it, so a little off at a coarse point is metres off at the rim: every sample )
    this.step ||= this.id === "pinch" || this.id === "crease" ? 1 : Math.max( 1, Math.floor( this.sc.radius / ( 40 * probe ) ) );
    return { probe, f: this.step };
  }

  /**
   * What a dab reads: its tip, the ground its brush looks at round it, and a coarse step more ( weights read between
   * the lattice points stay inside the window ).
  **/
  private boundsOf( d: Dab ): [number, number, number, number] {
    const { probe, f } = this.lattice();
    const m            = Math.max( this.margin( d.r, probe ), ( f + 1 ) * probe );
    return [d.x - d.r - m, d.z - d.r - m, d.x + d.r + m, d.z + d.r + m];
  }

  /**
   * The dabs made since the last time: dabs close together ( one after another down a stroke ) applied in one window.
  **/
  flushDabs() {
    const list   = this.pending.filter( ( d ) => d.strength > 0 && d.r > 0 );
    this.pending = [];
    if ( !list.length ) return;
    if ( this.id === "mask" ) {
      for ( const d of list ) this.mask.paintMask( d );
      return;
    }
    const area         = ( b: number[] ) => ( b[2] - b[0] ) * ( b[3] - b[1] );
    let cluster: Dab[] = [], bounds: [number, number, number, number] | null = null;
    for ( const d of list ) {
      const b    = this.boundsOf( d );
      const u: [number, number, number, number] | null = bounds && [Math.min( bounds[0], b[0] ), Math.min( bounds[1], b[1] ), Math.max( bounds[2], b[2] ), Math.max( bounds[3], b[3] )];
      // ( together while they overlap and the window stays a few dabs' size )
      const near = bounds && u && b[0] < bounds[2] && b[2] > bounds[0] && b[1] < bounds[3] && b[3] > bounds[1] && area( u ) <= 3 * area( b );
      if ( near ) {
        cluster.push( d );
        bounds = u;
      } else {
        if ( cluster.length ) this.applyAll( cluster, bounds! );
        cluster = [d];
        bounds  = b;
      }
    }
    if ( cluster.length ) this.applyAll( cluster, bounds! );
  }

  /**
   * Dabs applied one after another in one window over `b` ( each sees the last's work ), written back once.
  **/
  private applyAll( dabs: Dab[], b: [number, number, number, number] ) {
    const { f } = this.lattice();
    const win   = HeightWindow.around( this.t, b[0], b[1], b[2], b[3] );
    if ( !win ) return;
    const H0                   = win.H.slice(), g = new Lattice( win, f );
    const all: Box             = [win.w, -1, win.h, -1];
    // ( the ground as the stroke found it: the same for each of these dabs, none of them written back yet )
    let O: Float32Array | null = null;
    const orig                 = () => ( O ??= this.undo.original( win ) );
    for ( const d of dabs ) {
      const tip      = makeTip( this.s, d.x, d.z, d.r, d.angle );
      // ( what the dab can change: its tip, a square one's corners too, and a coarse step round it )
      const reach    = d.r * ( this.s.roundness < 0.999 ? Math.SQRT2 : 1 );
      const box: Box = [
        Math.max( 0, Math.floor( ( d.x - reach - win.x0 ) / win.sp ) - f ), Math.min( win.w - 1, Math.ceil( ( d.x + reach - win.x0 ) / win.sp ) + f ),
        Math.max( 0, Math.floor( ( d.z - reach - win.z0 ) / win.sp ) - f ), Math.min( win.h - 1, Math.ceil( ( d.z + reach - win.z0 ) / win.sp ) + f ),
      ];
      if ( box[0] > box[1] || box[2] > box[3] ) continue;
      const Wc = this.ops.weights( win, tip, g, box );
      const W  = this.ops.fine( g, Wc, box );
      if ( !this.ops.op( win, W, d, g, Wc, box, orig ) ) continue;
      all[0] = Math.min( all[0], box[0] );
      all[1] = Math.max( all[1], box[1] );
      all[2] = Math.min( all[2], box[2] );
      all[3] = Math.max( all[3], box[3] );
    }
    if ( all[1] < 0 ) return;
    this.undo.commit( win.writeBack( win.H, ( ci, i0, j0, i1, j1 ) => this.undo.snap( ci, i0, j0, i1, j1 ), all, H0 ) );
  }

  /**
   * Records the stroke in history. Returns false if nothing changed.
  **/
  end( label?: string ) {
    if ( !this.changed ) return false;
    const t          = this.t;
    const before     = [...this.undo.before.values()].flatMap( ( m ) => [...m.values()] );
    const after      = before.map( ( b ) => t.snapshot( b.chunk, b.i0, b.j0, b.i0 + b.w - 1, b.j0 + b.h - 1 ) );
    const maskBefore = [...this.mask.maskBefore.values()];
    const maskAfter  = maskBefore.map( ( s ) => {
      const c = t.chunks[s.ci], data = new Uint8Array( s.w * s.h );
      for ( let j = 0; j < s.h; j++ ) data.set( c.mask!.subarray( ( s.j0 + j ) * c.res + s.i0, ( s.j0 + j ) * c.res + s.i0 + s.w ), j * s.w );
      return { ...s, data };
    } );
    const putMask = ( list: MaskSnap[] ) => {
      for ( const s of list ) {
        const c = t.chunks[s.ci];
        if ( !c ) continue;
        if ( !c.mask ) c.mask = new Uint8Array( c.res * c.res );
        for ( let j = 0; j < s.h; j++ ) c.mask.set( s.data.subarray( j * s.w, ( j + 1 ) * s.w ), ( s.j0 + j ) * c.res + s.i0 );
        t.markDirtyRect( s.ci, s.i0, s.j0, s.i0 + s.w - 1, s.j0 + s.h - 1 );
      }
    };
    history.push( {
      label: label ?? `Sculpt (${brushInfo( this.id ).label})`,
      bytes: before.reduce( ( n, s ) => n + s.data.byteLength * 2, 0 ) + maskBefore.reduce( ( n, s ) => n + s.data.byteLength * 2, 0 ),
      undo:  () => { before.forEach( ( s ) => t.restore( s ) ); putMask( maskBefore ); t.flush(); },
      redo:  () => { after.forEach( ( s ) => t.restore( s ) ); putMask( maskAfter ); t.flush(); },
    } );
    return true;
  }
}
