// Texture Paint on a modelled piece ( Blender's, projected from the view ): the paint engine's dabs move across the
// screen; each one paints the texels of the piece's texture that lie under it on the screen and face the camera,
// near the surface the dab is over. The brush's size is in metres on the piece where the stroke starts.

import * as THREE from "three/webgpu";
import { toThree, type V3 } from "../../core/coords";
import type { CustomObjectEntry } from "../../core/types";
import { channelPixels, pieceTexture, prepare, recordStroke, storeOf, texelsNear, updateNormal, type Channel, type PieceTexture, type TexelMap } from "../../texture/meshPaint";
import { useEditor } from "../../map/store";
import { gradientTexel } from "../../paint/settings";
import { evaluate, type ModelData } from "../../model/build";
import type { Mesh } from "../../model/mesh";
import { EngineStroke } from "../../paint/engine/stroke";
import { stencilAt, useDecal, useStencil, type StencilState } from "../../texture/stencil";

import { pieceMatrix } from "../../core/transform";

// A triangle of the piece in the view.
type Triangle   = [THREE.Vector3, THREE.Vector3, THREE.Vector3];
type Rgb        = [number, number, number];
// a texel the stencil lands on: its colour, its cell of the view and how far it is
type StencilHit = { k: number; c: [number, number, number, number]; cell: number; dist: number };

/**
 * The stencil's colour at a point of the view ( a grey map's: its lightness ).
**/
function stencilColour( s: StencilState, sx: number, sy: number, grey: boolean ): [number, number, number, number] | null {
  const c = stencilAt( s, sx, sy );
  if ( !c || !grey ) return c;
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [l, l, l, c[3]];
}

export interface PaintView {
  camera: THREE.PerspectiveCamera;
  host:   HTMLElement;
  ray( x: number, y: number ): THREE.Raycaster;
}

interface Active {
  uid:       string;
  stroke:    EngineStroke | null;
  before:    Uint8Array;
  label:     string;
  ch:        Channel;
  // Gradient: where the drag started and is ( screen )
  gradient?: { x0: number; y0: number; x1: number; y1: number };
}

export class MeshPainter {
  private active: Active | null = null;

  constructor( private view: PaintView ) {}

  get painting() {
    return !!this.active;
  }

  /**
   * The piece being painted: the selected modelled piece.
  **/
  private piece(): ( CustomObjectEntry & { model: ModelData } ) | null {
    const st  = useEditor.getState();
    const sel = st.selection.find( ( s ) => s.kind === "custom" );
    const o   = sel && st.customObjects.find( ( x ) => x.uid === sel.uid );
    return o?.model ? ( o as CustomObjectEntry & { model: ModelData } ) : null;
  }

  /**
   * The piece's triangles in the viewport's space, and where the ray at a screen point first meets them.
  **/
  private surface( g: Mesh, M: THREE.Matrix4 ) {
    const W                = g.v.map( ( p ) => toThree( p ).applyMatrix4( M ) );
    const tris: Triangle[] = [];
    g.f.forEach( ( f ) => {
      for ( let i = 1; i + 1 < f.length; i++ ) tris.push( [W[f[0]], W[f[i]], W[f[i + 1]]] );
    } );
    return ( x: number, y: number ) => {
      const r                        = this.view.ray( x, y ).ray, hit = new THREE.Vector3();
      let best: THREE.Vector3 | null = null, bd = Infinity;
      for ( const [a, b, c] of tris )
        if ( r.intersectTriangle( a, b, c, false, hit ) ) {
          const d = hit.distanceTo( r.origin );
          if ( d < bd ) { bd = d; best = hit.clone(); }
        }
      return best;
    };
  }

  private mpp( p: THREE.Vector3 ) {
    const cam = this.view.camera;
    return ( 2 * Math.tan( THREE.MathUtils.degToRad( cam.fov ) / 2 ) * p.distanceTo( cam.position ) ) / this.view.host.clientHeight;
  }

  /**
   * The brush's radius in screen pixels over the piece at a screen point ( null off it ).
  **/
  radiusAt( x: number, y: number ): number | null {
    const o = this.piece();
    if ( !o ) return null;
    const M   = pieceMatrix( o );
    const hit = this.surface( evaluate( o.model ), M )( x, y );
    return hit ? useEditor.getState().paint.radius / this.mpp( hit ) : null;
  }

  /**
   * Starts a stroke at a screen point if it's on the piece; whether it did.
  **/
  down( x: number, y: number, pressure: number, ctrl: boolean ): boolean {
    const o = this.piece();
    if ( !o ) return false;
    const { T, g, map } = prepare( o );
    const M             = pieceMatrix( o ), Minv = M.clone().invert();
    const hitAt         = this.surface( g, M );
    const start         = hitAt( x, y );
    const p             = useEditor.getState().paint;
    // ( a gradient's line can start anywhere, as Blender's; the other tools start on the piece )
    if ( !start && p.texTool !== "gradient" ) return false;
    const ch: Channel  = p.channel;
    const grey         = ch !== "colour";
    const erase        = !grey && ctrl !== p.invert;
    // a grey map: its value ( Ctrl: the other way )
    const v            = ctrl ? 1 - p.value : p.value;
    const colour: Rgb  = grey ? [v, v, v] : p.rgb;
    const colour2: Rgb = grey ? [1 - p.value, 1 - p.value, 1 - p.value] : p.rgb2;
    const px           = channelPixels( T, ch, o );
    if ( p.texTool === "gradient" ) {
      this.active       = { uid: o.uid, stroke: null, before: px.slice(), label: "Gradient", ch, gradient: { x0: x, y0: y, x1: x, y1: y } };
      this.gradientInfo = { o, T, map, M, colour, colour2, strength: p.strength };
      window.dispatchEvent( new CustomEvent( "gradient-line", { detail: [x, y, x, y] } ) );
      return true;
    }
    if ( !start ) return false;
    if ( p.texTool === "decal" ) {
      const at = this.decalAt( x, y );
      if ( at ) this.applyStencil( at, "Decal" );
      return true;
    }
    if ( p.texTool === "fill" ) {
      const before = px.slice();
      if ( this.fill( o, T, map, M, start, colour, p.tolerance, p.strength, ch ) ) recordStroke( o.uid, "Fill", before, ch );
      return true;
    }
    const scale        = Math.abs( o.scale.x ) || 1;
    // the brush's size in metres, as screen pixels where the stroke starts
    const radiusPx     = Math.max( 1, p.radius / this.mpp( start ) );
    const n            = map.n, cam = this.view.camera, host = this.view.host;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix( M );
    // Each texel's place on the screen, and whether it faces the camera, worked out the first time a dab reaches it
    // in the stroke ( dabs overlap: a texel is under several ) and kept until the view changes. With every texel worked
    // out afresh in every dab ( some 25 000 a dab on a rail ) painting fell to 60 frames a second.
    const onScreen     = new Float32Array( n * n * 2 ), known = new Uint8Array( n * n ); // 0 not yet, 1 facing, 2 away
    const facing       = new Float32Array( n * n     );
    const toClip       = new THREE.Matrix4(), seenView = new THREE.Matrix4();
    let viewSet        = false;
    const look         = () => {
      if ( viewSet && seenView.equals( cam.matrixWorld ) ) return;
      viewSet = true;
      seenView.copy( cam.matrixWorld );
      toClip.multiplyMatrices( cam.projectionMatrix, cam.matrixWorldInverse ).multiply( M );
      known.fill( 0 );
    };
    const m     = M.elements, nm = normalMatrix.elements;
    const place = ( k: number ) => {
      const x   = map.pos[k * 3], y = map.pos[k * 3 + 1], z = -map.pos[k * 3 + 2];
      // facing the camera ( world normal · towards the camera )
      const wx  = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      const nx0 = map.nrm[k * 3], ny0 = map.nrm[k * 3 + 1], nz0 = -map.nrm[k * 3 + 2];
      const nx  = nm[0] * nx0 + nm[3] * ny0 + nm[6] * nz0, ny = nm[1] * nx0 + nm[4] * ny0 + nm[7] * nz0, nz = nm[2] * nx0 + nm[5] * ny0 + nm[8] * nz0;
      const tx  = cam.position.x - wx, ty = cam.position.y - wy, tz = cam.position.z - wz;
      const fw  = turnedAway( ( nx * tx + ny * ty + nz * tz ) / ( Math.hypot( nx, ny, nz ) * Math.hypot( tx, ty, tz ) || 1 ) );
      if ( fw <= 0 ) return ( known[k] = 2 );
      facing[k]           = fw;
      const e             = toClip.elements, w = e[3] * x + e[7] * y + e[11] * z + e[15];
      onScreen[k * 2]     = ( ( ( e[0] * x + e[4] * y + e[8] * z + e[12] ) / w ) * 0.5 + 0.5 ) * host.clientWidth;
      onScreen[k * 2 + 1] = ( -( ( e[1] * x + e[5] * y + e[9] * z + e[13] ) / w ) * 0.5 + 0.5 ) * host.clientHeight;
      return ( known[k] = 1 );
    };
    // with a stencil, the brush paints its image ( a grey map: its lightness ) where it lies on the view
    const sten   = useStencil.getState(), screen: [number, number] = [0, 0];
    const source = sten.img ? () => stencilColour( sten, screen[0], screen[1], grey ) : undefined;
    const stroke = new EngineStroke( storeOf( T, ch ), {
      source,
      kind:     "paint",
      brush:    p.brush,
      radius:   radiusPx,
      hardness: p.hardness,
      strength: p.strength,
      mode:     erase ? "erase" : grey && p.blend === "erase" ? "mix" : p.blend,
      colour,
      colour2,
      patternPx: 64,
      base:      [1, 1, 1],
      // the texels under the dab on the screen: near the surface there, facing the camera
      cover: ( d, reach, at, f ) => {
        const hit = hitAt( d.x, d.y );
        if ( !hit ) return;
        const rw         = reach * this.mpp( hit );
        const local      = hit.clone().applyMatrix4( Minv );
        const centre: V3 = [local.x, local.y, -local.z];
        look();
        visit( map, centre, rw / scale, ( k ) => {
          if ( ( known[k] || place( k ) ) !== 1 ) return;
          const sx  = onScreen[k * 2], sy = onScreen[k * 2 + 1];
          const cov = at( sx - d.x, sy - d.y, k % n, Math.floor( k / n ) );
          if ( !cov ) return;
          screen[0] = sx;
          screen[1] = sy;
          f( k % n, Math.floor( k / n ), cov * facing[k] );
        } );
      },
    } );
    this.active = { uid: o.uid, stroke, before: px.slice(), label: erase ? "Erase paint" : grey ? `Paint ${ch}` : "Paint", ch };
    stroke.move( { x, y, pressure } );
    return true;
  }

  move( x: number, y: number, pressure: number ) {
    const a = this.active;
    if ( a?.gradient ) {
      a.gradient.x1 = x;
      a.gradient.y1 = y;
      window.dispatchEvent( new CustomEvent( "gradient-line", { detail: [a.gradient.x0, a.gradient.y0, x, y] } ) );
      return;
    }
    a?.stroke?.move( { x, y, pressure } );
  }

  hold( ms: number ) {
    this.active?.stroke?.hold( ms );
  }

  up() {
    const a     = this.active;
    this.active = null;
    if ( !a ) return;
    if ( a.gradient ) {
      window.dispatchEvent( new CustomEvent( "gradient-line", { detail: null } ) );
      const g = this.gradientInfo!;
      if ( Math.hypot( a.gradient.x1 - a.gradient.x0, a.gradient.y1 - a.gradient.y0 ) > 3 ) {
        this.gradient( g, a.gradient, a.ch );
        recordStroke( a.uid, "Gradient", a.before, a.ch );
      }
      return;
    }
    a.stroke!.end();
    const T = pieceTexture( a.uid );
    if ( a.ch === "height" && T ) updateNormal( T );
    if ( a.stroke!.changedAny ) recordStroke( a.uid, a.label, a.before, a.ch );
  }

  private gradientInfo: { o: CustomObjectEntry; T: PieceTexture; map: TexelMap; M: THREE.Matrix4; colour: Rgb; colour2: Rgb; strength: number } | null = null;

  /**
   * Where each texel of the piece shows on the screen and how much of it is seen ( 0: hidden behind the piece
   * itself or facing away; less as its face turns from the view ). The piece is drawn into a small depth buffer first.
  **/
  private seenTexels( g: Mesh, map: TexelMap, M: THREE.Matrix4 ) {
    const cam  = this.view.camera, host = this.view.host, n = map.n;
    const W    = Math.max( 1, Math.ceil( host.clientWidth / 2 ) ), H = Math.max( 1, Math.ceil( host.clientHeight / 2 ) );
    const e    = new THREE.Matrix4().multiplyMatrices( cam.projectionMatrix, cam.matrixWorldInverse ).multiply( M ).elements;
    const clip = ( x: number, y: number, z: number ) => {
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      return [( ( ( e[0] * x + e[4] * y + e[8] * z + e[12] ) / w ) * 0.5 + 0.5 ) * W, ( -( ( e[1] * x + e[5] * y + e[9] * z + e[13] ) / w ) * 0.5 + 0.5 ) * H, w] as const;
    };
    // the depth buffer: the nearest of the piece at each pixel ( as distance along the view )
    const depth = new Float32Array( W * H ).fill( Infinity );
    const V     = g.v.map( ( p ) => clip( p[0], p[1], -p[2] ) );
    for ( const f of g.f )
      for ( let i = 1; i + 1 < f.length; i++ ) {
        const a = V[f[0]], b = V[f[i]], c = V[f[i + 1]];
        if ( a[2] <= 0.01 || b[2] <= 0.01 || c[2] <= 0.01 ) continue;
        const area = ( b[0] - a[0] ) * ( c[1] - a[1] ) - ( c[0] - a[0] ) * ( b[1] - a[1] );
        if ( Math.abs( area ) < 1e-9 ) continue;
        const x0 = Math.max( 0, Math.floor( Math.min( a[0], b[0], c[0] ) ) ), x1 = Math.min( W - 1, Math.ceil( Math.max( a[0], b[0], c[0] ) ) );
        const y0 = Math.max( 0, Math.floor( Math.min( a[1], b[1], c[1] ) ) ), y1 = Math.min( H - 1, Math.ceil( Math.max( a[1], b[1], c[1] ) ) );
        for ( let y = y0; y <= y1; y++ )
          for ( let x = x0; x <= x1; x++ ) {
            const px = x + 0.5, py = y + 0.5;
            const u  = ( ( c[0] - b[0] ) * ( py - b[1] ) - ( c[1] - b[1] ) * ( px - b[0] ) ) / area;
            const v  = ( ( a[0] - c[0] ) * ( py - c[1] ) - ( a[1] - c[1] ) * ( px - c[0] ) ) / area;
            const t  = 1 - u - v;
            if ( u < 0 || v < 0 || t < 0 ) continue;
            // ( 1/w goes straight across the screen )
            const d = 1 / ( u / a[2] + v / b[2] + t / c[2] ), q = y * W + x;
            if ( d < depth[q] ) depth[q] = d;
          }
      }
    const x = new Float32Array( n * n ), y = new Float32Array( n * n ), weight = new Float32Array( n * n );
    const m = M.elements, nm = new THREE.Matrix3().getNormalMatrix( M ).elements;
    for ( let k = 0; k < n * n; k++ ) {
      if ( !map.used[k] ) continue;
      const lx  = map.pos[k * 3], ly = map.pos[k * 3 + 1], lz = -map.pos[k * 3 + 2];
      const wx  = m[0] * lx + m[4] * ly + m[8] * lz + m[12], wy = m[1] * lx + m[5] * ly + m[9] * lz + m[13], wz = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
      const nx0 = map.nrm[k * 3], ny0 = map.nrm[k * 3 + 1], nz0 = -map.nrm[k * 3 + 2];
      const nx  = nm[0] * nx0 + nm[3] * ny0 + nm[6] * nz0, ny = nm[1] * nx0 + nm[4] * ny0 + nm[7] * nz0, nz = nm[2] * nx0 + nm[5] * ny0 + nm[8] * nz0;
      const tx  = cam.position.x - wx, ty = cam.position.y - wy, tz = cam.position.z - wz;
      const fw  = turnedAway( ( nx * tx + ny * ty + nz * tz ) / ( Math.hypot( nx, ny, nz ) * Math.hypot( tx, ty, tz ) || 1 ) );
      if ( fw <= 0 ) continue;
      const [sx, sy, d] = clip( lx, ly, lz );
      // seen if nothing of the piece is nearer at its pixel ( the farthest of the pixel and its neighbours: edges )
      const cx          = Math.floor( sx ), cy = Math.floor( sy );
      let far           = -Infinity;
      for ( let j = -1; j <= 1; j++ )
        for ( let i = -1; i <= 1; i++ ) {
          const xx = cx + i, yy = cy + j;
          if ( xx < 0 || yy < 0 || xx >= W || yy >= H ) continue;
          far = Math.max( far, depth[yy * W + xx] );
        }
      if ( !( d <= far * 1.01 + 0.01 ) ) continue;
      x[k]      = ( sx * host.clientWidth  ) / W;
      y[k]      = ( sy * host.clientHeight ) / H;
      weight[k] = fw;
    }
    return { x, y, weight };
  }

  /**
   * Where a texel shows on the screen, if it faces the camera.
  **/
  private texelScreen( map: TexelMap, M: THREE.Matrix4, k: number, normalMatrix: THREE.Matrix3 ): [number, number] | null {
    const cam = this.view.camera, host = this.view.host;
    const P   = new THREE.Vector3( map.pos[k * 3], map.pos[k * 3 + 1], -map.pos[k * 3 + 2] ).applyMatrix4( M );
    const N   = new THREE.Vector3( map.nrm[k * 3], map.nrm[k * 3 + 1], -map.nrm[k * 3 + 2] ).applyMatrix3( normalMatrix );
    if ( N.dot( cam.position.clone().sub( P ) ) <= 0 ) return null;
    const s = P.project( cam );
    if ( s.z > 1 ) return null;
    return [( s.x * 0.5 + 0.5 ) * host.clientWidth, ( -s.y * 0.5 + 0.5 ) * host.clientHeight];
  }

  /**
   * Gradient: the two colours along the line dragged, over everything of the piece that faces the camera.
  **/
  private gradient( g: NonNullable<MeshPainter["gradientInfo"]>, line: { x0: number; y0: number; x1: number; y1: number }, ch: Channel ) {
    const px   = channelPixels( g.T, ch, g.o ), set = useEditor.getState().paint.gradient;
    const dx   = line.x1 - line.x0, dy = line.y1 - line.y0, l2 = dx * dx + dy * dy, len = Math.sqrt( l2 );
    // only what's seen of the piece, as Blender paints it: not through it, and fading as faces turn away
    const seen = this.seenTexels( evaluate( g.o.model! ), g.map, g.M );
    for ( let k = 0; k < g.map.n * g.map.n; k++ ) {
      const w = seen.weight[k];
      if ( !w ) continue;
      const sx = seen.x[k] - line.x0, sy = seen.y[k] - line.y0;
      const t  = set.shape === "radial" ? Math.hypot( sx, sy ) / len : ( sx * dx + sy * dy ) / l2;
      gradientTexel( px, k * 4, t, g.colour, g.colour2, set.to, g.strength, w );
    }
    storeOf( g.T, ch ).changed( 0, 0, [0, 0, g.T.n - 1, g.T.n - 1] );
    if ( ch === "height" ) updateNormal( g.T );
  }

  /**
   * The decal placed at a screen point on the piece ( as a stencil there: its size on the piece at that point ), or null
   * off the piece or with no image.
  **/
  decalAt( x: number, y: number ): ( StencilState & { near: { p: [number, number, number]; r: number } } ) | null {
    const d = useDecal.getState(), o = this.piece();
    if ( !d.img || !o ) return null;
    const M = pieceMatrix( o ), hit = this.surface( evaluate( o.model ), M )( x, y );
    if ( !hit ) return null;
    const scale = d.size / this.mpp( hit ) / Math.max( d.img.w, d.img.h );
    // ( only the texels round where it lands are looked at: within its half diagonal, in the piece's own size )
    const local = hit.clone().applyMatrix4( M.clone().invert() ), k = Math.max( 1e-6, Math.min( Math.abs( o.scale.x ), Math.abs( o.scale.y ), Math.abs( o.scale.z ) ) );
    return { img: d.img, x, y, scale, angle: d.angle, opacity: 1, adjust: false, near: { p: [local.x, local.y, -local.z], r: ( d.size * 0.75 ) / k } };
  }

  /**
   * The stencil ( or `sten`: a decal placed ) pressed onto the piece whole, where it's over it; one undo step.
  **/
  applyStencil( sten: StencilState & { near?: { p: [number, number, number]; r: number } } = useStencil.getState(), label = "Apply stencil" ): boolean {
    const o = this.piece();
    if ( !o || !sten.img ) return false;
    const { T, map }         = prepare( o );
    const p                  = useEditor.getState().paint, ch: Channel = p.channel, grey = ch !== "colour";
    const M                  = pieceMatrix( o ), nm = new THREE.Matrix3().getNormalMatrix( M );
    const px                 = channelPixels( T, ch, o ), before = px.slice();
    // what's in front: the nearest texel in each few pixels of the view ( texels behind another part stay as they are )
    const cam                = this.view.camera, W = this.view.host.clientWidth, H = this.view.host.clientHeight, CELL = 3;
    const cw                 = Math.ceil( W / CELL ), zbuf = new Float32Array( cw * Math.ceil( H / CELL ) ).fill( Infinity );
    const hits: StencilHit[] = [];
    const P                  = new THREE.Vector3(), scale = Math.max( Math.abs( o.scale.x ), Math.abs( o.scale.y ), Math.abs( o.scale.z ) );
    const look               = ( k: number ) => {
      if ( !map.used[k] ) return;
      const s = this.texelScreen( map, M, k, nm );
      if ( !s || s[0] < 0 || s[1] < 0 || s[0] >= W || s[1] >= H ) return;
      const cell = Math.floor( s[1] / CELL ) * cw + Math.floor( s[0] / CELL );
      const dist = P.set( map.pos[k * 3], map.pos[k * 3 + 1], -map.pos[k * 3 + 2] ).applyMatrix4( M ).distanceTo( cam.position );
      if ( dist < zbuf[cell] ) zbuf[cell] = dist;
      const c = stencilColour( sten, s[0], s[1], grey );
      if ( c ) hits.push( { k, c, cell, dist } );
    };
    // ( a decal: the texels round where it lands; the stencil: all of them )
    if ( sten.near ) texelsNear( map, sten.near.p, sten.near.r, look );
    else for ( let k = 0; k < map.n * map.n; k++ ) look( k );
    let any = false;
    for ( const { k, c, cell, dist } of hits ) {
      if ( dist > zbuf[cell] + map.cell * scale * 4 ) continue;
      const a = c[3] * p.strength;
      for ( let i = 0; i < 3; i++ ) px[k * 4 + i] = Math.round( px[k * 4 + i] + ( c[i] * 255 - px[k * 4 + i] ) * a );
      px[k * 4 + 3] = 255;
      any           = true;
    }
    if ( !any ) return false;
    storeOf( T, ch ).changed( 0, 0, [0, 0, T.n - 1, T.n - 1] );
    if ( ch === "height" ) updateNormal( T );
    recordStroke( o.uid, label, before, ch );
    return true;
  }

  /**
   * Fill: the texels joined to the one under the cursor whose colour is within the tolerance of it.
  **/
  private fill( o: CustomObjectEntry, T: PieceTexture, map: TexelMap, M: THREE.Matrix4, hit: THREE.Vector3, colour: Rgb, tolerance: number, strength: number, ch: Channel ) {
    const px    = channelPixels( T, ch, o ), n = map.n;
    const local = hit.clone().applyMatrix4( M.clone().invert() );
    let seed    = -1, bd = Infinity;
    texelsNear( map, [local.x, local.y, -local.z], map.cell * 0.6, ( k, d2 ) => {
      if ( map.used[k] === 1 && d2 < bd ) { bd = d2; seed = k; }
    } );
    if ( seed < 0 ) return false;
    const ref  = [px[seed * 4], px[seed * 4 + 1], px[seed * 4 + 2]], tol = tolerance * 255 * Math.sqrt( 3 );
    const seen = new Uint8Array( n * n ), stack = [seed];
    seen[seed] = 1;
    while ( stack.length ) {
      const k = stack.pop()!;
      for ( let c = 0; c < 3; c++ ) px[k * 4 + c] = Math.round( px[k * 4 + c] + ( colour[c] * 255 - px[k * 4 + c] ) * strength );
      px[k * 4 + 3] = 255;
      const x       = k % n, y = Math.floor( k / n );
      for ( const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) {
        const xx = x + ddx, yy = y + ddy;
        if ( xx < 0 || yy < 0 || xx >= n || yy >= n ) continue;
        const j = yy * n + xx;
        if ( seen[j] || !map.used[j] ) continue;
        seen[j] = 1;
        const d = Math.hypot( px[j * 4] - ref[0], px[j * 4 + 1] - ref[1], px[j * 4 + 2] - ref[2] );
        if ( d <= tol ) stack.push( j );
      }
    }
    storeOf( T, ch ).changed( 0, 0, [0, 0, n - 1, n - 1] );
    if ( ch === "height" ) updateNormal( T );
    return true;
  }
}

/**
 * The texels within `r` of a point ( piece coordinates ).
**/
function visit( map: TexelMap, p: [number, number, number], r: number, f: ( k: number ) => void ) {
  texelsNear( map, p, r, ( k ) => f( k ) );
}


/**
 * How much paint a face takes by how squarely it looks at the view ( the cosine of the angle between them ), as
 * Blender's Normal falloff: all of it up to 50 degrees, none past 80.
**/
function turnedAway( cos: number ) {
  const a = Math.cos( ( 80 * Math.PI ) / 180 ), b = Math.cos( ( 50 * Math.PI ) / 180 );
  const t = Math.min( 1, Math.max( 0, ( cos - a ) / ( b - a ) ) );
  return t * t * ( 3 - 2 * t );
}
