// A ground paint stroke: dabs of snow or rock, markings, powder, grip or corduroy flow on the chunks it crosses ( one
// undo step ).

import { history } from "../../map/history";
import { type BrushSettings, DEFAULT_BRUSH } from "../../sculpt/brushes";
import { makeTip } from "../../sculpt/tip";
import { terrain } from "../../terrain/terrain";
import { MARKING_COLOURS, type PaintSettings, type PaintTool } from "../settings";
import { blendAngle, encodeAngle, spreadHue } from "./channels";
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

export class PaintStroke {
  private snaps = new Map<string, Snap>();
  private last: [number, number] | null = null;
  private dir: [number, number] = [0, 0];
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

  private async follow( x: number, z: number ) {
    const step = Math.max( 0.05, this.s.radius * 0.15 );
    if ( !this.last ) {
      this.last = [x, z];
      return this.dab( x, z );
    }
    const [lx, lz] = this.last;
    const d        = Math.hypot( x - lx, z - lz );
    if ( d > 1e-6 ) this.dir = [( x - lx ) / d, ( z - lz ) / d];
    const n = Math.floor( d / step );
    for ( let k = 1; k <= n; k++ ) await this.dab( lx + ( ( x - lx ) * k * step ) / d, lz + ( ( z - lz ) * k * step ) / d );
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

  async dab( x: number, z: number ) {
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
      const flowByte = s.tool === "flow" && ( this.dir[0] || this.dir[1] ) ? encodeAngle( this.dir[0], this.dir[1] ) : -1;
      for ( let j = j0; j <= j1; j++ ) {
        const wz = z0 + ( j + 0.5 ) * px;
        for ( let i = i0; i <= i1; i++ ) {
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
              if ( flowByte >= 0 && F ) F[k] = blendAngle( F[k], flowByte, Math.min( 1, w * 1.5 ) );
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
