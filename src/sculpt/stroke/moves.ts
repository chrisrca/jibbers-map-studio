// A sculpt stroke's input: the cursor's moves turned into dabs ( spacing, the stabilizer, the Line / Anchored / Drag
// Dot methods, airbrushing while held still, replays ).

import type { BrushStroke } from "./stroke";
import { rng, type StrokeInput } from "./stroke";

// Cursor moves into dabs.
export class StrokeMoves {
  constructor( private stroke: BrushStroke ) {}

  private lastDab: [number, number] | null = null;
  lazy: [number, number] | null = null;
  dir:  [number, number]        = [0, 0];
  private airTime = 0;

  move( inp: StrokeInput ) {
    this.batch( () => this.moveTo( inp ) );
  }

  /**
   * `f`'s dabs applied together once it's done.
  **/
  private batch( f: () => void ) {
    if ( this.stroke.batching ) return f();
    this.stroke.batching = true;
    try {
      f();
    } finally {
      this.stroke.batching = false;
      this.stroke.flushDabs();
    }
  }

  private moveTo( inp: StrokeInput ) {
    const p: [number, number] = [inp.x, inp.z];
    const pressure            = inp.pressure ?? 1;
    this.stroke.cursor        = p;
    if ( this.stroke.replays ) return this.replay( pressure );
    // stabilizer ( lazy mouse ): the brush trails the cursor on a string
    const L = this.stroke.sc.stabilize * this.stroke.sc.radius;
    if ( !this.lazy || L <= 0 ) this.lazy = p;
    else {
      const d = Math.hypot( p[0] - this.lazy[0], p[1] - this.lazy[1] );
      if ( d > L ) this.lazy = [this.lazy[0] + ( ( p[0] - this.lazy[0] ) * ( d - L ) ) / d, this.lazy[1] + ( ( p[1] - this.lazy[1] ) * ( d - L ) ) / d];
    }
    const [x, z] = this.lazy;
    if ( !this.lastDab ) {
      this.stroke.dab( x, z, pressure );
      this.lastDab = [x, z];
      return;
    }
    const [lx, lz] = this.lastDab;
    const dist     = Math.hypot( x - lx, z - lz );
    const step     = this.spacingMetres();
    if ( dist > 1e-6 ) this.dir = [( x - lx ) / dist, ( z - lz ) / dist];
    const n = Math.floor( dist / step );
    for ( let k = 1; k <= n; k++ ) {
      const f = ( k * step ) / dist;
      this.stroke.dab( lx + ( x - lx ) * f, lz + ( z - lz ) * f, pressure );
    }
    if ( n > 0 ) this.lastDab = [lx + ( ( x - lx ) * n * step ) / dist, lz + ( ( z - lz ) * n * step ) / dist];
  }

  /**
   * Called every frame while the button is held: Airbrush keeps spraying where it is.
  **/
  hold( dtMs: number, pressure = 1 ) {
    if ( this.stroke.s.stroke !== "airbrush" || !this.lastDab ) return;
    this.airTime += dtMs;
    const every   = 1000 / Math.max( 1, this.stroke.s.rate );
    this.batch( () => {
      while ( this.airTime >= every ) {
        this.airTime -= every;
        this.stroke.dab( this.lastDab![0], this.lastDab![1], pressure );
      }
    } );
  }

  spacingMetres() {
    return Math.max( 0.05, this.stroke.s.spacing * this.stroke.sc.radius );
  }

  /**
   * Line / Anchored / Drag Dot: put the terrain back as it was and redo the whole stroke.
  **/
  private replay( pressure: number ) {
    this.stroke.undo.restoreAll();
    this.stroke.rand = rng( this.stroke.seed );
    const [x,  z ]   = this.stroke.cursor;
    const [sx, sz]   = this.stroke.start;
    if ( this.stroke.s.stroke === "dragdot" ) return this.stroke.dab( x, z, pressure );
    if ( this.stroke.s.stroke === "anchored" ) {
      const d = Math.hypot( x - sx, z - sz );
      if ( d > 1e-6 ) this.dir = [( x - sx ) / d, ( z - sz ) / d];
      return this.stroke.dab( sx, sz, pressure, this.stroke.anchoredRadius() );
    }
    // line: dabs from the start to the cursor
    const dist = Math.hypot( x - sx, z - sz );
    if ( dist > 1e-6 ) this.dir = [( x - sx ) / dist, ( z - sz ) / dist];
    const step = this.spacingMetres();
    const n    = Math.max( 0, Math.floor( dist / step ) );
    for ( let k = 0; k <= n; k++ ) {
      const f = dist > 0 ? ( k * step ) / dist : 0;
      this.stroke.dab( sx + ( x - sx ) * f, sz + ( z - sz ) * f, pressure );
    }
  }
}
