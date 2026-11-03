// A ground paint stroke: dabs of snow or rock, markings, powder, grip or corduroy flow on the chunks it crosses ( one
// undo step ).

import { nextFrame, overBudget } from "../../core/frameBudget";
import { history } from "../../map/history";
import { type BrushSettings, DEFAULT_BRUSH } from "../../sculpt/brushes";
import { makeTip } from "../../sculpt/tip";
import { terrain } from "../../terrain/terrain";
import { MARKING_COLOURS, type PaintSettings, type PaintTool } from "../settings";
import { angleTowards, blendAngle, encodeAngle, spreadHue } from "./channels";
import { type PaintLayer, type Rect, changed, ensureLayer, gripBlocked, layers, makeFour, union } from "./layers";

interface Snap {
  key:     string;
  x0:      number;
  y0:      number;
  w:       number;
  h:       number;
  rgba:    Uint8Array;
  flow:    Uint8Array | null;
  four:    boolean;
  hadFlow: boolean;
}

const TILE = 256;

/**
 * The mean direction ( unit x, z pairs, not normalised ) round each pixel of [i0..i1] × [j0..j1] of a flow mask, over a
 * box `kr` pixels each way ( summed areas, so a big box costs no more ).
**/
function meanFlow( F: Uint8Array, m: number, i0: number, j0: number, i1: number, j1: number, kr: number ) {
  const a0 = Math.max( 0, i0 - kr ), b0 = Math.max( 0, j0 - kr ), a1 = Math.min( m - 1, i1 + kr ), b1 = Math.min( m - 1, j1 + kr );
  const W  = a1 - a0 + 2, H = b1 - b0 + 2, sx = new Float64Array( W * H ), sz = new Float64Array( W * H );
  for ( let j = 1; j < H; j++ )
    for ( let i = 1; i < W; i++ ) {
      const a = ( F[( b0 + j - 1 ) * m + a0 + i - 1] / 255 ) * Math.PI * 2, k = j * W + i;
      sx[k]   = Math.sin( a ) + sx[k - 1] + sx[k - W] - sx[k - W - 1];
      sz[k]   = Math.cos( a ) + sz[k - 1] + sz[k - W] - sz[k - W - 1];
    }
  const w   = i1 - i0 + 1, out = new Float32Array( w * ( j1 - j0 + 1 ) * 2 );
  const box = ( S: Float64Array, x0: number, y0: number, x1: number, y1: number ) => S[( y1 + 1 ) * W + x1 + 1] - S[y0 * W + x1 + 1] - S[( y1 + 1 ) * W + x0] + S[y0 * W + x0];
  for ( let j = j0; j <= j1; j++ )
    for ( let i = i0; i <= i1; i++ ) {
      const x0 = Math.max( a0, i - kr ) - a0, y0 = Math.max( b0, j - kr ) - b0, x1 = Math.min( a1, i + kr ) - a0, y1 = Math.min( b1, j + kr ) - b0;
      const q  = ( ( j - j0 ) * w + i - i0 ) * 2;
      out[q]     = box( sx, x0, y0, x1, y1 );
      out[q + 1] = box( sz, x0, y0, x1, y1 );
    }
  return out;
}

export class PaintStroke {
  private snaps = new Map<string, Snap>();
  private last: [number, number] | null = null;
  private dir: [number, number] = [0, 0];
  // the stabilized point ( the brush trails the cursor on a string )
  private lazy: [number, number] | null = null;
  private changedAny = false;
  readonly s: PaintSettings;

  constructor( settings: PaintSettings, invert = false ) {
    this.s = { ...settings, invert: settings.invert !== invert };
  }

  // pointer moves run in order ( a dab may wait for a chunk's mask to load )
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Follows the cursor ( Unity XZ ), placing dabs every 15% of the radius.
  **/
  move( x: number, z: number ) {
    this.queue = this.queue.then( () => this.follow( x, z ) ).catch( ( e ) => console.warn( "paint dab failed", e ) );
    return this.queue;
  }

  private async follow( cx: number, cz: number ) {
    const step = Math.max( 0.05, this.s.radius * 0.15 ), L = ( this.s.stabilize ?? 0 ) * this.s.radius;
    if ( !this.lazy || L <= 0 ) this.lazy = [cx, cz];
    else {
      const d = Math.hypot( cx - this.lazy[0], cz - this.lazy[1] );
      if ( d > L ) this.lazy = [this.lazy[0] + ( ( cx - this.lazy[0] ) * ( d - L ) ) / d, this.lazy[1] + ( ( cz - this.lazy[1] ) * ( d - L ) ) / d];
    }
    const [x, z] = this.lazy;
    if ( !this.last ) {
      this.last = [x, z];
      return this.dabs( x, z );
    }
    const [lx, lz] = this.last;
    const d        = Math.hypot( x - lx, z - lz );
    // ( Lock: the first way the stroke went, kept )
    if ( d > 1e-6 && !( this.s.flowDir === "lock" && ( this.dir[0] || this.dir[1] ) ) ) this.dir = [( x - lx ) / d, ( z - lz ) / d];
    const n = Math.floor( d / step );
    for ( let k = 1; k <= n; k++ ) await this.dabs( lx + ( ( x - lx ) * k * step ) / d, lz + ( ( z - lz ) * k * step ) / d );
    if ( n > 0 ) this.last = [lx + ( ( x - lx ) * n * step ) / d, lz + ( ( z - lz ) * n * step ) / d];
  }

  private snap( L: PaintLayer, i0: number, j0: number, i1: number, j1: number ) {
    for ( let ty = Math.floor( j0 / TILE ); ty <= Math.floor( j1 / TILE ); ty++ )
      for ( let tx = Math.floor( i0 / TILE ); tx <= Math.floor( i1 / TILE ); tx++ ) {
        const id = `${L.key}:${tx}:${ty}`;
        if ( this.snaps.has( id ) ) continue;
        const x0   = tx * TILE, y0 = ty * TILE, w = Math.min( TILE, L.m - x0 ), h = Math.min( TILE, L.m - y0 );
        const rgba = new Uint8Array( w * h * 4 ), flow = L.flow ? new Uint8Array( w * h ) : null;
        for ( let j = 0; j < h; j++ ) {
          rgba.set( L.rgba.subarray( ( ( y0 + j ) * L.m + x0 ) * 4, ( ( y0 + j ) * L.m + x0 + w ) * 4 ), j * w * 4 );
          if ( flow ) flow.set( L.flow!.subarray( ( y0 + j ) * L.m + x0, ( y0 + j ) * L.m + x0 + w ), j * w );
        }
        this.snaps.set( id, { key: L.key, x0, y0, w, h, rgba, flow, four: L.four, hadFlow: !!L.flow } );
      }
  }

  /**
   * A dab where the brush is, with its stripes beside it ( across the way the stroke goes ) and its mirrored and radial
   * copies, each painting the corduroy its own way.
  **/
  private async dabs( x: number, z: number ) {
    const s                                      = this.s, [dx, dz] = this.dir, n = Math.max( 1, Math.round( s.stripes?.count ?? 1 ) ), gap = s.stripes?.spacing ?? 0;
    let list: [number, number, number, number][] = [];
    for ( let k = 0; k < n; k++ ) {
      const o = ( k - ( n - 1 ) / 2 ) * gap;
      list.push( [x + dz * o, z - dx * o, dx, dz] );
    }
    const sym = s.symmetry;
    if ( sym && ( sym.x || sym.z || sym.radial > 1 ) ) {
      const xs       = terrain.chunks.flatMap( ( c ) => [c.position[0], c.position[0] + c.size[0]] ), zs = terrain.chunks.flatMap( ( c ) => [c.position[2], c.position[2] + c.size[2]] );
      const [px, pz] = sym.pivot ?? [( Math.min( ...xs ) + Math.max( ...xs ) ) / 2, ( Math.min( ...zs ) + Math.max( ...zs ) ) / 2];
      if ( sym.x ) list = list.flatMap( ( q ) => [q, [2 * px - q[0], q[1], -q[2], q[3]]] );
      if ( sym.z ) list = list.flatMap( ( q ) => [q, [q[0], 2 * pz - q[1], q[2], -q[3]]] );
      const R = Math.max( 1, Math.round( sym.radial ) );
      if ( R > 1 )
        list = list.flatMap( ( q ) =>
          Array.from( { length: R }, ( _, k ): [number, number, number, number] => {
            const a = ( k * 2 * Math.PI ) / R, ca = Math.cos( a ), sa = Math.sin( a ), ox = q[0] - px, oz = q[1] - pz;
            return [px + ox * ca - oz * sa, pz + ox * sa + oz * ca, q[2] * ca - q[3] * sa, q[2] * sa + q[3] * ca];
          } ),
        );
    }
    for ( const [qx, qz, qdx, qdz] of list ) await this.dab( qx, qz, [qdx, qdz] );
  }

  async dab( x: number, z: number, dir: [number, number] = this.dir ) {
    const s                          = this.s, r = s.radius;
    const tipSettings: BrushSettings = { ...DEFAULT_BRUSH, falloff: s.falloff, hardness: s.hardness };
    const tip                        = makeTip( tipSettings, x, z, r, 0, false );
    for ( const c of terrain.chunks ) {
      const x0 = c.position[0], z0 = c.position[2], S = c.size[0];
      if ( x + r < x0 || x - r > x0 + S || z + r < z0 || z - r > z0 + S ) continue;
      const L = await ensureLayer( c );
      if ( s.tool === "grip" && gripBlocked( L ) ) continue;
      const m  = L.m, px = S / m;
      const i0 = Math.max( 0, Math.floor( ( x - r - x0 ) / px ) ), i1 = Math.min( m - 1, Math.ceil( ( x + r - x0 ) / px ) );
      const j0 = Math.max( 0, Math.floor( ( z - r - z0 ) / px ) ), j1 = Math.min( m - 1, Math.ceil( ( z + r - z0 ) / px ) );
      if ( i0 > i1 || j0 > j1 ) continue;
      // markings also touch the pixels just outside ( their hue, see spreadHue )
      const pad = s.tool === "marking" ? 2 : 0;
      const r0  = [Math.max( 0, i0 - pad ), Math.max( 0, j0 - pad ), Math.min( m - 1, i1 + pad ), Math.min( m - 1, j1 + pad )] as [number, number, number, number];
      this.snap( L, ...r0 );
      // ( switching the mask to four channels, or giving it a flow mask, changes all of it )
      const whole = ( ( s.tool === "powder" || s.tool === "marking" ) && !L.four ) || ( s.tool === "grip" && L.four ) || ( s.tool === "flow" && !L.flow );
      if ( s.tool === "powder" || s.tool === "marking" ) makeFour( L );
      // ( a 4-channel chunk with nothing on it yet becomes a grip one )
      if ( s.tool === "grip" ) L.four = false;
      if ( s.tool === "flow" && !L.flow ) L.flow = new Uint8Array( m * m );
      const P        = L.rgba, F = L.flow;
      const hue      = Math.round( ( MARKING_COLOURS[s.colour]?.hue ?? 0 ) * 255 );
      const flowByte = s.tool !== "flow" || s.flowDir === "smooth" ? -1
        : s.flowDir === "fixed" ? encodeAngle( Math.sin( ( s.flowAngle * Math.PI ) / 180 ), Math.cos( ( s.flowAngle * Math.PI ) / 180 ) )
        : dir[0] || dir[1] ? encodeAngle( dir[0], dir[1] ) : -1;
      // ( Smooth: each pixel eased towards the mean direction round it, a box a third of the brush across )
      const mean     = s.tool === "flow" && s.flowDir === "smooth" && F ? meanFlow( F, m, i0, j0, i1, j1, Math.min( 32, Math.max( 2, Math.round( ( r * 0.3 ) / px ) ) ) ) : null;
      const towards  = flowByte >= 0 ? angleTowards( flowByte ) : null;
      for ( let j = j0; j <= j1; j++ ) {
        // ( a big dab over more than this frame's share: the rest next frame, the view drawn meanwhile )
        if ( ( j & 7 ) === 0 && overBudget() ) await nextFrame();
        const wz = z0 + ( j + 0.5 ) * px;
        // ( just the row's pixels inside the brush )
        const dz = wz - z, half = Math.sqrt( Math.max( 0, r * r - dz * dz ) ) + px;
        const a0 = Math.max( i0, Math.floor( ( x - half - x0 ) / px ) ), a1 = Math.min( i1, Math.ceil( ( x + half - x0 ) / px ) );
        for ( let i = a0; i <= a1; i++ ) {
          const w = tip.weight( x0 + ( i + 0.5 ) * px, wz ) * s.strength;
          if ( w <= 0.001 ) continue;
          const k = j * m + i, o = k * 4;
          switch ( s.tool ) {
            case "snow": {
              const t = s.invert ? 0 : 255;
              P[o]    = Math.round( P[o] + ( t - P[o] ) * w );
              break;
            }
            case "marking":
              if ( s.invert ) P[o + 2] = Math.round( P[o + 2] * ( 1 - w ) );
              else {
                // the hue where the brush is strong ( or nothing's marked yet ); the coverage builds up softly
                if ( w > 0.05 || P[o + 2] < 8 ) P[o + 1] = hue;
                P[o + 2] = Math.round( P[o + 2] + ( 255 - P[o + 2] ) * w );
              }
              break;
            case "powder":
            case "grip": {
              const t  = s.invert ? 0 : Math.round( s.powder * 255 );
              P[o + 3] = Math.round( P[o + 3] + ( t - P[o + 3] ) * w );
              break;
            }
            case "flow":
              if ( towards && F ) F[k] = towards( F[k], Math.min( 1, w * 1.5 ) );
              else if ( mean && F ) {
                const q = ( ( j - j0 ) * ( i1 - i0 + 1 ) + i - i0 ) * 2;
                if ( mean[q] || mean[q + 1] ) F[k] = blendAngle( F[k], encodeAngle( mean[q], mean[q + 1] ), w );
              }
              break;
          }
        }
      }
      if ( s.tool === "marking" ) spreadHue( P, m, i0, j0, i1, j1 );
      this.changedAny = true;
      changed( L, whole ? undefined : r0 );
    }
  }

  /**
   * Records the stroke as one undo step ( after its last dabs ).
  **/
  async end() {
    await this.queue;
    if ( !this.changedAny ) return false;
    const before = [...this.snaps.values()];
    const after  = before.map( ( b ) => {
      const L    = layers.get( b.key )!;
      const rgba = new Uint8Array( b.w * b.h * 4 ), flow = L.flow ? new Uint8Array( b.w * b.h ) : null;
      for ( let j = 0; j < b.h; j++ ) {
        rgba.set( L.rgba.subarray( ( ( b.y0 + j ) * L.m + b.x0 ) * 4, ( ( b.y0 + j ) * L.m + b.x0 + b.w ) * 4 ), j * b.w * 4 );
        if ( flow ) flow.set( L.flow!.subarray( ( b.y0 + j ) * L.m + b.x0, ( b.y0 + j ) * L.m + b.x0 + b.w ), j * b.w );
      }
      return { ...b, rgba, flow, four: L.four, hadFlow: !!L.flow };
    } );
    const put = ( list: Snap[] ) => {
      const touched = new Map<PaintLayer, Rect | "all">();
      for ( const b of list ) {
        const L = layers.get( b.key );
        if ( !L ) continue;
        const whole = L.four !== b.four || b.hadFlow !== !!L.flow;
        L.four      = b.four;
        if ( !b.hadFlow ) L.flow = null;
        else if ( !L.flow ) L.flow = new Uint8Array( L.m * L.m );
        for ( let j = 0; j < b.h; j++ ) {
          L.rgba.set( b.rgba.subarray( j * b.w * 4, ( j + 1 ) * b.w * 4 ), ( ( b.y0 + j ) * L.m + b.x0 ) * 4 );
          if ( b.flow && L.flow ) L.flow.set( b.flow.subarray( j * b.w, ( j + 1 ) * b.w ), ( b.y0 + j ) * L.m + b.x0 );
        }
        const r = touched.get( L ), add: Rect = [b.x0, b.y0, b.x0 + b.w - 1, b.y0 + b.h - 1];
        touched.set( L, whole || r === "all" ? "all" : r ? union( r, add ) : add );
      }
      touched.forEach( ( r, L ) => changed( L, r === "all" ? undefined : r ) );
    };
    const bytes                            = [...before, ...after].reduce( ( n, b ) => n + b.rgba.byteLength + ( b.flow?.byteLength ?? 0 ), 0 );
    const names: Record<PaintTool, string> = { snow: this.s.invert ? "rock" : "snow", marking: "markings", powder: "powder", grip: "grip", flow: "flow" };
    history.push( { label: `Paint ${names[this.s.tool]}`, undo: () => put( before ), redo: () => put( after ), bytes } );
    return true;
  }
}
