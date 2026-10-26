// The loading veil over the view while a map's pieces are built and their shaders made ready.

import { loadingHeld } from "../../map/loadingHolds";
import type { Engine } from "./engine";

export class LoadingVeil {
  constructor( private engine: Engine ) {}

  // The loading veil over the view, while a map's pieces are being built ( when it opens, or a big batch of them ),
  // then while their shaders are made ready: the view stutters through all that, so it's covered rather than looking
  // broken. Pieces built of how many, or null when the view is ready.
  loading: { done: number; total: number } | null = null;
  // a map was just opened: its first pieces get the veil however few they are ( until then )
  private loadArmedUntil = 0;
  // building the pieces, or making their shaders ready
  private stage: "idle" | "building" | "compiling" = "idle";
  // when the number of pieces built last changed ( a stuck one doesn't hold the view for ever )
  private seen    = { at: 0, done: -1 };
  // terrain being ( re )built for a map
  terrainBuilding = 0;

  arm() {
    this.loadArmedUntil = performance.now() + 4000;
  }

  /**
   * A map opening: covered straight away, before its terrain is built.
  **/
  cover() {
    this.arm();
    this.stage   = "building";
    this.seen    = { at: performance.now(), done: 0 };
    this.loading = { done: 0, total: 0 };
  }

  watch() {
    const p     = this.engine.customR.progress, now = performance.now();
    // besides the pieces: the terrain being built, and work held for ( old pieces brought up to date )
    const other = this.terrainBuilding > 0 || loadingHeld();
    if ( this.stage === "idle" ) {
      // a batch this big stutters too ( pasting many pieces, the game's look brought up to date )
      if ( !( now < this.loadArmedUntil ? p || other : p && p.total >= 8 ) ) return;
      this.stage = "building";
      this.seen  = { at: now, done: p?.done ?? 0 };
    }
    if ( this.stage !== "building" ) return;
    if ( p || other ) {
      const done = p?.done ?? 0, total = p?.total ?? 0;
      if ( done !== this.seen.done ) this.seen = { at: now, done };
      // stuck ( a piece that never finishes ): the view isn't held hostage ( a big map's assets being converted for
      // the first time, or its old pieces brought up to date, can take a while without a piece finishing )
      else if ( now - this.seen.at > ( p?.preparing || other ? 180000 : 20000 ) ) return this.end();
      if ( this.loading?.done !== done || this.loading?.total !== total ) this.loading = { done, total };
      return;
    }
    // everything's built: its shaders prepared before the view is handed over
    this.stage   = "compiling";
    const total  = this.loading?.total ?? 0;
    this.loading = { done: total, total };
    Promise.race( [this.engine.look.compileAll(), new Promise( ( r ) => setTimeout( r, 15000 ) )] )
      .catch( ( e ) => console.warn( "shader preparation failed", e ) )
      .finally( () => requestAnimationFrame( () => requestAnimationFrame( () => this.end() ) ) );
  }

  private end() {
    this.stage          = "idle";
    this.loadArmedUntil = 0;
    this.loading        = null;
  }
}
