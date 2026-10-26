// The Trails tool's drawing: each run's centre line and pick surface, and the runs' shape as it will be ( tiles of it
// made again only where it changed ).

import * as THREE from "three/webgpu";
import { evalSurfaces, outlineField, type Surface } from "../../../trails/surface";
import { nodeOf, runsAt, runStrip, type TrailNet, type TrailRun } from "../../../trails/trails";
import type { TrailTool } from "./trailTool";
import { RUN, PICKED, FILL, Shaped, TILE } from "./trailTool";

// The runs drawn.
export class TrailDrawing {
  constructor( private tool: TrailTool ) {}

  drawn = new Map<string, { key: string; g: THREE.Group }>();
  // Each run's surface, by what its shape depends on ( v: a number for each one made ).
  surfs = new Map<string, { key: string; S: Surface; v: number }>();
  made  = 0;
  // The shape's tiles drawn, by tile, with what they were drawn from.
  private tiles = new Map<string, { key: string; g: THREE.Group | null }>();

  /**
   * What a run's shape depends on: itself, its points, the runs at its points ( it eases into them ).
  **/
  drawKey( net: TrailNet, r: TrailRun ) {
    const at = ( id: string ) => [nodeOf( net, id ), runsAt( net, id )];
    return JSON.stringify( [r, at( r.a ), at( r.b ), net.v] );
  }

  drop( g: THREE.Group ) {
    for ( const c of g.children ) ( c as THREE.Mesh ).geometry?.dispose();
    this.tool.ribbons.remove( g );
  }

  /**
   * A run: its centre line, and its surface ( not drawn: the runs' shape is, drawShape ) for picking it.
  **/
  drawRun( net: TrailNet, r: TrailRun, picked: boolean ): THREE.Group {
    const group = new THREE.Group();
    const s     = runStrip( net, r, 2 );
    const first = s.in0, last = s.in1;
    const c0    = 1, c1 = s.cols - 2, rows = last - first + 1, cols = c1 - c0 + 1;
    const pos   = new Float32Array( rows * cols * 3 );
    const at    = ( k: number, q: number ) => {
      const o = ( ( k + first ) * s.cols + q + c0 ) * 4;
      return [s.pts[o], s.pts[o + 1] + 0.12, -s.pts[o + 2]] as const;
    };
    for ( let k = 0; k < rows; k++ ) for ( let q = 0; q < cols; q++ ) pos.set( at( k, q ), ( k * cols + q ) * 3 );
    const idx: number[] = [];
    for ( let k = 0; k < rows - 1; k++ )
      for ( let q = 0; q < cols - 1; q++ ) {
        const a = k * cols + q, b = a + 1, c = a + cols, d = c + 1;
        idx.push( a, c, b, b, c, d );
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute( "position", new THREE.BufferAttribute( pos, 3 ) );
    g.setIndex( idx );
    const mesh    = new THREE.Mesh( g, this.tool.mat( "pick", 0, 1 ) );
    mesh.visible  = false;
    mesh.userData = { pickRun: r.id };
    group.add( mesh );
    const mid     = Array.from( { length: rows }, ( _, k ) => new THREE.Vector3( ...at( k, ( cols - 1 ) / 2 ) ) );
    const l       = new THREE.Line( new THREE.BufferGeometry().setFromPoints( mid ), this.tool.mat( "line", picked ? PICKED : RUN, 0.45 ) );
    l.renderOrder = 12;
    group.add( l );
    return group;
  }

  /**
   * The runs drawn as one shape: filled and outlined where any run's own width reaches, so runs that meet or overlap
   * merge, rounded where they meet and at their ends ( picked runs' part of it in the picked colour ). In tiles: those
   * the shape is in, each drawn again only when a run reaching it ( its heights there ) changed.
  **/
  drawShape( list: Shaped[] ) {
    // ( spots a sixth of the narrowest run's half width apart, at least a metre and a half, a whole number to a tile )
    const narrowest = Math.min( ...list.map( ( l ) => l.half ) );
    const n         = Math.min( 48, Math.max( 8, Math.round( TILE / Math.max( 1.5, narrowest / 6 ) ) ) ), sp = TILE / n, cut = sp * 2;
    const add       = ( to: Map<string, number[]>, box: number[], i: number ) => {
      for ( let tz = Math.floor( box[1] / TILE ); tz <= Math.floor( box[3] / TILE ); tz++ )
        for ( let tx = Math.floor( box[0] / TILE ); tx <= Math.floor( box[2] / TILE ); tx++ ) {
          const k = `${tx},${tz}`;
          ( to.get( k ) ?? to.set( k, [] ).get( k )! ).push( i );
        }
    };
    // the tiles the shape is in ( each run's centre line, padded by its width ), and the runs reaching each ( their
    // heights blend there )
    const shapeIn = new Map<string, number[]>(), reach = new Map<string, number[]>();
    list.forEach( ( { S }, i ) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, half = 0;
      for ( let k = 0; k < S.rows; k++ ) {
        x0   = Math.min( x0,   S.cx[k]   );
        x1   = Math.max( x1,   S.cx[k]   );
        z0   = Math.min( z0,   S.cz[k]   );
        z1   = Math.max( z1,   S.cz[k]   );
        half = Math.max( half, S.half[k] );
      }
      const pad = half + cut;
      add( shapeIn, [x0 - pad, z0 - pad, x1 + pad, z1 + pad], i );
      add( reach,   S.box,                                    i );
    } );
    for ( const [k, t] of [...this.tiles] ) if ( !shapeIn.has( k ) ) { this.dropTile( t.g ); this.tiles.delete( k ); }
    for ( const k of shapeIn.keys() ) {
      const on  = reach.get( k ) ?? [];
      const key = `${n}:${on.map( ( i ) => `${list[i].v}${list[i].picked ? "p" : ""}` ).join( "," )}`;
      const had = this.tiles.get( k );
      if ( had?.key === key ) continue;
      if ( had ) this.dropTile( had.g );
      const [tx, tz] = k.split( "," ).map( Number );
      const g        = this.drawTile( tx * TILE, tz * TILE, sp, n, on.map( ( i ) => list[i] ) );
      if ( g ) this.tool.shape.add( g );
      this.tiles.set( k, { key, g } );
    }
  }

  private dropTile( g: THREE.Group | null ) {
    if ( !g ) return;
    for ( const c of g.children ) ( c as THREE.Mesh ).geometry?.dispose();
    this.tool.shape.remove( g );
  }

  /**
   * One tile of the runs' shape ( corner ox, oz; n × n cells of sp ): marching triangles over outlineField.
  **/
  private drawTile( ox: number, oz: number, sp: number, n: number, on: Shaped[] ): THREE.Group | null {
    const N           = n + 1, surfs = on.map( ( o ) => o.S );
    const { f, near } = outlineField( surfs, ox, oz, sp, N, N, sp * 2 );
    if ( !f.some( ( v ) => v < 0 ) ) return null;
    // ( heights just where they're drawn: in the shape, and a spot round it )
    const want = new Uint8Array( N * N );
    for ( let o = 0; o < N * N; o++ ) if ( f[o] < sp * 2 ) want[o] = 1;
    const ev = evalSurfaces( surfs, ox, oz, sp, N, N, false, want );
    if ( !ev ) return null;
    const run           = new THREE.Color( RUN ), pick = new THREE.Color( PICKED );
    const pos: number[] = [], col: number[] = [], line: number[] = [], linePicked: number[] = [];
    // ( a spot of the grid where it is; part way along a cell's side, where the shape's edge crosses it )
    const put           = ( o: number, to: number[] ) => {
      const i = o % N, j = ( o - i ) / N;
      to.push( ox + i * sp, ev.y[o] + 0.12, -( oz + j * sp ) );
    };
    const between = ( a: number, b: number, to: number[] ) => {
      const t  = f[a] / ( f[a] - f[b] ), ia = a % N, ja = ( a - ia ) / N, ib = b % N, jb = ( b - ib ) / N;
      // ( the outside spot's height only where the runs reach it )
      const yb = ev.cover[b] > 0 ? ev.y[b] : ev.y[a];
      to.push( ox + ( ia + ( ib - ia ) * t ) * sp, ev.y[a] + ( yb - ev.y[a] ) * t + 0.12, -( oz + ( ja + ( jb - ja ) * t ) * sp ) );
    };
    const colour = ( o: number ) => ( on[near[o]]?.picked ? pick : run );
    const tri    = ( A: number, B: number, C: number ) => {
      if ( f[A] >= 0 && f[B] >= 0 && f[C] >= 0 ) return;
      const v    = [A, B, C], poly: number[] = [], pc: THREE.Color[] = [], cross: number[] = [];
      let inside = A;
      for ( let e = 0; e < 3; e++ ) {
        const a = v[e], b = v[( e + 1 ) % 3];
        if ( f[a] < 0 ) {
          put( a, poly );
          pc.push( colour( a ) );
          inside = a;
        }
        if ( f[a] < 0 !== f[b] < 0 ) {
          const inn = f[a] < 0 ? a : b, out = inn === a ? b : a;
          between( inn, out, poly );
          pc.push( colour( inn ) );
          between( inn, out, cross );
        }
      }
      const m = poly.length / 3;
      for ( let k = 1; k < m - 1; k++ )
        for ( const q of [0, k, k + 1] ) {
          pos.push( poly[q * 3], poly[q * 3 + 1], poly[q * 3 + 2] );
          col.push( pc[q].r, pc[q].g, pc[q].b );
        }
      if ( cross.length === 6 ) ( on[near[inside]]?.picked ? linePicked : line ).push( ...cross );
    };
    for ( let j = 0; j < n; j++ )
      for ( let i = 0; i < n; i++ ) {
        const a = j * N + i, b = a + 1, c = a + N + 1, d = a + N;
        tri( a, b, c );
        tri( a, c, d );
      }
    const g   = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute( "position", new THREE.Float32BufferAttribute( pos, 3 ) );
    geo.setAttribute( "color",    new THREE.Float32BufferAttribute( col, 3 ) );
    const mesh       = new THREE.Mesh( geo, this.tool.mat( "fill", RUN, FILL ) );
    mesh.renderOrder = 11;
    g.add( mesh );
    for ( const [pts, c] of [[line, RUN], [linePicked, PICKED]] as const ) {
      if ( !pts.length ) continue;
      const lg = new THREE.BufferGeometry();
      lg.setAttribute( "position", new THREE.Float32BufferAttribute( pts, 3 ) );
      const l       = new THREE.LineSegments( lg, this.tool.mat( "line", c, 0.9 ) );
      l.renderOrder = 12;
      g.add( l );
    }
    return g;
  }
}
