// The ground the trails make: each run's surface where it is, and between and around them the ground beneath
// ( an imported mountain, or flat ) bent smoothly to meet them, out to `blend` metres away, with noise where asked.
//
// Kept so it can always change again: the ground beneath is remembered where trails have reached ( `bases` ), and the
// bend as a coarse field ( `Field` ). What the trails make at a sample is worked out from those and the net, so
// changing the net takes its old making out and puts the new one in; sculpting done since rides on top.

import { history } from "../../map/history";
import { type TrailNet, emptyNet, netBounds } from "../trails";
import { applyNet, changedRuns, dropPending, resetApplying } from "./apply";
import { bases, unsaved } from "./base";
import { resetField, solveField } from "./field";
import { addTilesFor } from "./tiles";
import type { Field, GroundSettings } from "./types";

export { REAL_GROUND, NEW_GROUND, sameSettings, type GroundSettings, type Field } from "./types";
export { baseSampler } from "./base";
export { solveField } from "./field";
export { flushTrails, applyNet } from "./apply";
export { addTilesFor } from "./tiles";

let current: { net: TrailNet; field: Field | null } = { net: emptyNet(), field: null };

// How long the last commit's parts took ( ms ): new tiles, the bend, the ground.
export const trailTimes = { tiles: 0, solve: 0, apply: 0 };

export const currentNet   = () => current.net;
export const currentField = () => current.field;

/**
 * Makes `net` the trails, the ground following ( one undo step labelled `label` ). `onChange` is told the net
 * whenever it changes ( also on undo / redo ). Returns the milliseconds it took.
**/
export function commitNet( net: TrailNet, s: GroundSettings, label: string, onChange: ( net: TrailNet ) => void ): number {
  const t0     = performance.now();
  const before = current;
  // ground for it where there's none yet: where its runs go off the map, or ( trails begun on a map with no ground )
  // as far as the ground round them bends
  const nb     = netBounds( net );
  if ( nb ) {
    const pad    = net.grow ? s.blend + 8 : 0;
    const lowest = Math.min( ...net.nodes.map( ( n ) => n.p[1] ) );
    addTilesFor( [nb[0] - pad, nb[1] - pad, nb[2] + pad, nb[3] + pad], lowest );
  }
  const t1    = performance.now();
  const field = solveField( net, s, before.field, changedRuns( before.net, net ) );
  const after = { net, field };
  const t2    = performance.now();
  applyNet( before.net, before.field, after.net, after.field );
  trailTimes.tiles = t1 - t0;
  trailTimes.solve = t2 - t1;
  trailTimes.apply = performance.now() - t2;
  current          = after;
  onChange( net );
  history.push( {
    label,
    bytes: ( field ? field.c.byteLength * 2 : 0 ) + ( before.field ? before.field.c.byteLength * 2 : 0 ),
    undo: () => {
      applyNet( after.net, after.field, before.net, before.field );
      current = before;
      onChange( before.net );
    },
    redo: () => {
      applyNet( before.net, before.field, after.net, after.field );
      current = after;
      onChange( after.net );
    },
  } );
  return performance.now() - t0;
}

/**
 * A different map: its trails ( and what's remembered under them ) from its saved data.
**/
export function loadTrails( net: TrailNet, field: Field | null, blocks: Map<string, Float32Array | number> ) {
  dropPending();
  current = { net, field };
  bases.clear();
  unsaved.clear();
  for ( const [k, v] of blocks ) bases.set( k, v );
}

/**
 * What to save: the remembered ground's blocks ( those not saved yet as files ), the rest as numbers.
**/
export function trailSaveData() {
  const files: [string, Float32Array][] = [];
  const flat:  Record<string, number>   = {};
  for ( const [k, v] of bases ) {
    if ( typeof v === "number" ) flat[k] = v;
    else if ( unsaved.has( k ) ) files.push( [k, v] );
  }
  return { files, flat, all: [...bases.keys()].filter( ( k ) => typeof bases.get( k ) !== "number" ), markSaved: () => unsaved.clear() };
}

/**
 * For tests: everything forgotten.
**/
export function resetTrailGround() {
  resetApplying();
  resetField();
  current = { net: emptyNet(), field: null };
  bases.clear();
  unsaved.clear();
}
