// Texture Paint's Image view ( Blender's Image Editor beside the 3D view ): the selected piece's texture laid flat with
// its faces outlined, painted in 2D with the same brush, colours and map; the wheel zooms, the middle button pans,
// Home fits it.

import { useEffect, useRef } from "react";
import { create } from "zustand";
import type { CustomObjectEntry } from "../../core/types";
import { channelPixels, onPieceTexture, pieceTexture, prepare, recordStroke, storeOf, paintAtlas, updateNormal, type Channel } from "../../texture/meshPaint";
import { useEditor } from "../../map/store";
import { gradientTexel } from "../../paint/settings";
import { evaluate, triangulateFace, type ModelData } from "../../model/build";
import { faceNormal, len, sub } from "../../model/mesh";
import { EngineStroke } from "../../paint/engine/stroke";
import { Icon } from "../widgets/icons";

export const useTexView = create<{ open: boolean }>( () => ( { open: false } ) );

export function TextureView() {
  const open = useTexView( ( s ) => s.open );
  const tool = useEditor( ( s ) => s.tool ), mode = useEditor( ( s ) => s.materialMode );
  const uid  = useEditor( ( s ) => s.selection.find( ( x ) => x.kind === "custom" && s.customObjects.find( ( o ) => o.uid === x.uid )?.model )?.uid );
  if ( !open || tool !== "material" || mode !== "paint" || !uid ) return null;
  return <TexCanvas key={uid} uid={uid} />;
}

type Piece    = CustomObjectEntry & { model: ModelData };
type Rgb      = [number, number, number];
type Point    = { x: number; y: number };
// a stroke under way: the brush's ( none for a gradient ), the texels before it for its undo, and a gradient's ends
type Stroke   = { s: EngineStroke | null; before: Uint8Array; ch: Channel; gradient?: { x0: number; y0: number; x1: number; y1: number } };
const pieceOf = ( uid: string ) => useEditor.getState().customObjects.find( ( o ) => o.uid === uid ) as Piece | undefined;

/**
 * How many of the texture's widths a metre of the piece spans ( its layout keeps every face at one density ).
**/
function density( o: Piece ) {
  const g   = evaluate( o.model ), a = paintAtlas( o.model, g );
  let area3 = 0, areaUv = 0;
  g.f.forEach( ( f, fi ) => {
    for ( const [x, y, z] of triangulateFace( g, f, faceNormal( g, fi ) ) ) {
      const e1 = sub( g.v[y], g.v[x] ), e2 = sub( g.v[z], g.v[x] );
      area3   += len( [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]] ) / 2;
      const uv = ( v: number ) => {
        const c = ( a.start[fi] + f.indexOf( v ) ) * 2;
        return [a.uv[c], a.uv[c + 1]];
      };
      const [p, q, r] = [uv( x ), uv( y ), uv( z )];
      areaUv         += Math.abs( ( q[0] - p[0] ) * ( r[1] - p[1] ) - ( r[0] - p[0] ) * ( q[1] - p[1] ) ) / 2;
    }
  } );
  return area3 > 0 ? Math.sqrt( areaUv / area3 ) : 1;
}

function TexCanvas( { uid }: { uid: string } ) {
  const canvas = useRef<HTMLCanvasElement>( null );
  useEffect( () => {
    const cv = canvas.current!, ctx = cv.getContext( "2d" )!;
    const o0 = pieceOf( uid );
    if ( !o0 ) return;
    const { T: T0 }            = prepare( o0 );
    const n                    = () => pieceTexture( uid )?.n ?? T0.n;
    // the texture as a picture ( its first row the bottom: drawn flipped )
    const img                  = document.createElement( "canvas" );
    let data: ImageData | null = null, shownPx: Uint8Array | null = null, ch: Channel = useEditor.getState().paint.channel;
    const pixels               = () => {
      const T = pieceTexture( uid ), o = pieceOf( uid );
      if ( !T || !o ) return null;
      return ch === "colour" ? T.rgba : T.ch[ch] ?? null;
    };
    const upload = ( rect?: [number, number, number, number] ) => {
      const px = pixels(), N = n();
      if ( !px ) {
        img.width = img.height = 1;
        return;
      }
      if ( px !== shownPx || img.width !== N ) {
        shownPx   = px;
        img.width = img.height = N;
        data      = new ImageData( new Uint8ClampedArray( px.buffer as ArrayBuffer, px.byteOffset, px.length ), N, N );
        rect      = undefined;
      }
      const c = img.getContext( "2d" )!;
      if ( rect ) c.putImageData( data!, 0, 0, rect[0], rect[1], rect[2] - rect[0] + 1, rect[3] - rect[1] + 1 );
      else c.putImageData( data!, 0, 0 );
    };
    // the faces' outlines on it
    let outline    = new Path2D(), outlineOf: ModelData | null = null;
    const outlines = () => {
      const o = pieceOf( uid );
      if ( !o || o.model === outlineOf ) return;
      outlineOf = o.model;
      const g   = evaluate( o.model ), a = paintAtlas( o.model, g ), N = n();
      outline   = new Path2D();
      g.f.forEach( ( f, fi ) => {
        f.forEach( ( _, k ) => {
          const c = ( a.start[fi] + k ) * 2;
          if ( k ) outline.lineTo( a.uv[c] * N, a.uv[c + 1] * N );
          else outline.moveTo( a.uv[c] * N, a.uv[c + 1] * N );
        } );
        outline.closePath();
      } );
    };
    // the view: screen pixels per texel, and where the texture's bottom-left corner is
    const view = { zoom: 1, x: 0, y: 0 };
    const fit  = () => {
      const N   = n(), w = cv.clientWidth, h = cv.clientHeight;
      view.zoom = ( Math.min( w, h ) * 0.9 ) / N;
      view.x    = ( w - N * view.zoom ) / 2;
      view.y    = ( h - N * view.zoom ) / 2;
    };
    const toTex             = ( sx: number, sy: number ) => ( { x: ( sx - view.x ) / view.zoom, y: n() - ( sy - view.y ) / view.zoom } );
    let mouse: Point | null = null, raf = 0;
    const brushPx           = () => {
      const o = pieceOf( uid );
      return o ? useEditor.getState().paint.radius * density( o ) * n() : 8;
    };
    let brushCache = { model: null as ModelData | null, r: 8, radius: 0 };
    const radius   = () => {
      const o = pieceOf( uid ), p = useEditor.getState().paint;
      if ( o && ( o.model !== brushCache.model || p.radius !== brushCache.radius ) ) brushCache = { model: o.model, r: brushPx(), radius: p.radius };
      return brushCache.r;
    };
    const draw = () => {
      raf     = 0;
      const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio;
      if ( cv.width !== Math.round( w * dpr ) || cv.height !== Math.round( h * dpr ) ) { cv.width = Math.round( w * dpr ); cv.height = Math.round( h * dpr ); }
      ctx.setTransform( dpr, 0, 0, dpr, 0, 0 );
      ctx.fillStyle = "#282828";
      ctx.fillRect( 0, 0, w, h );
      const N = n();
      ctx.setTransform( view.zoom * dpr, 0, 0, -view.zoom * dpr, view.x * dpr, ( view.y + N * view.zoom ) * dpr );
      ctx.imageSmoothingEnabled = view.zoom < 2;
      // a checkerboard under see-through texels
      ctx.fillStyle             = "#3a3a3a";
      ctx.fillRect( 0, 0, N, N );
      ctx.drawImage( img, 0, 0, N, N );
      outlines();
      ctx.lineWidth   = 1 / view.zoom;
      ctx.strokeStyle = "rgba(255, 255, 255, .35)";
      ctx.stroke( outline );
      ctx.setTransform( dpr, 0, 0, dpr, 0, 0 );
      if ( mouse ) {
        ctx.beginPath();
        ctx.arc( mouse.x, mouse.y, Math.max( 2, radius() * view.zoom ), 0, Math.PI * 2 );
        ctx.strokeStyle = "rgba(255, 255, 255, .85)";
        ctx.lineWidth   = 1.5;
        ctx.stroke();
      }
    };
    const redraw = () => ( raf ||= requestAnimationFrame( draw ) );
    upload();
    fit();
    redraw();
    const offTex = onPieceTexture( ( u, c, rect ) => {
      if ( u !== uid || c !== ch ) return;
      upload( rect );
      redraw();
    } );
    const offEditor = useEditor.subscribe( ( s, prev ) => {
      if ( s.paint.channel !== ch ) {
        ch = s.paint.channel;
        upload();
      }
      if ( s.customObjects !== prev.customObjects || s.paint !== prev.paint ) redraw();
    } );
    const ro = new ResizeObserver( redraw );
    ro.observe( cv );

    // painting
    let gradientColours: [Rgb, Rgb]    = [[0, 0, 0], [1, 1, 1]];
    let stroke:          Stroke | null = null;
    let pan:             Point | null  = null;
    const down                         = ( e: PointerEvent ) => {
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      try {
        cv.setPointerCapture( e.pointerId );
      } catch {
        // ( a pointer the browser doesn't know: the stroke still goes ahead )
      }
      if ( e.button === 1 || ( e.button === 0 && e.altKey ) ) {
        pan = { x: sx - view.x, y: sy - view.y };
        return;
      }
      if ( e.button !== 0 ) return;
      const o = pieceOf( uid );
      if ( !o ) return;
      const { T }        = prepare( o );
      const p            = useEditor.getState().paint, c = p.channel, grey = c !== "colour";
      const px           = channelPixels( T, c, o ), t = toTex( sx, sy );
      const v            = e.ctrlKey ? 1 - p.value : p.value;
      const colour:  Rgb = grey ? [v, v, v] : p.rgb;
      const colour2: Rgb = grey ? [1 - p.value, 1 - p.value, 1 - p.value] : p.rgb2;
      const used         = prepare( o ).map.used;
      if ( p.texTool === "fill" ) {
        const before = px.slice();
        if ( fill2d( px, T.n, used, Math.floor( t.x ), Math.floor( t.y ), colour, p.tolerance, p.strength ) ) {
          storeOf( T, c ).changed( 0, 0, [0, 0, T.n - 1, T.n - 1] );
          if ( c === "height" ) updateNormal( T );
          recordStroke( uid, "Fill", before, c );
        }
        return;
      }
      gradientColours = [colour, colour2];
      if ( p.texTool === "gradient" ) {
        stroke = { s: null, before: px.slice(), ch: c, gradient: { x0: t.x, y0: t.y, x1: t.x, y1: t.y } };
        return;
      }
      const erase = !grey && e.ctrlKey !== p.invert;
      const s     = new EngineStroke( storeOf( T, c ), {
        kind: "paint", brush: p.brush, radius: Math.max( 0.5, radius() ), hardness: p.hardness, strength: p.strength,
        mode: erase ? "erase" : grey && p.blend === "erase" ? "mix" : p.blend, colour, colour2, patternPx: 64, base: [1, 1, 1],
      } );
      stroke = { s, before: px.slice(), ch: c };
      s.move( { x: t.x, y: t.y, pressure: e.pressure || 1 } );
    };
    const move = ( e: PointerEvent ) => {
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      mouse   = { x: sx, y: sy };
      if ( pan ) {
        view.x = sx - pan.x;
        view.y = sy - pan.y;
      } else if ( stroke?.gradient ) {
        const t            = toTex( sx, sy );
        stroke.gradient.x1 = t.x;
        stroke.gradient.y1 = t.y;
      } else if ( stroke?.s ) {
        const t = toTex( sx, sy );
        stroke.s.move( { x: t.x, y: t.y, pressure: e.pressure || 1 } );
      }
      redraw();
    };
    const up = () => {
      pan     = null;
      const s = stroke;
      stroke  = null;
      if ( !s ) return;
      const T = pieceTexture( uid ), o = pieceOf( uid );
      if ( !T || !o ) return;
      if ( s.gradient ) {
        const p                  = useEditor.getState().paint, px = channelPixels( T, s.ch, o ), used = prepare( o ).map.used;
        const { x0, y0, x1, y1 } = s.gradient, dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy, len = Math.sqrt( l2 );
        if ( l2 < 1 ) return;
        const [c0, c1] = gradientColours;
        for ( let k = 0; k < T.n * T.n; k++ ) {
          if ( !used[k] ) continue;
          const sx = ( k % T.n ) + 0.5 - x0, sy = Math.floor( k / T.n ) + 0.5 - y0;
          const t  = p.gradient.shape === "radial" ? Math.hypot( sx, sy ) / len : ( sx * dx + sy * dy ) / l2;
          gradientTexel( px, k * 4, t, c0, c1, p.gradient.to, p.strength );
        }
        storeOf( T, s.ch ).changed( 0, 0, [0, 0, T.n - 1, T.n - 1] );
        if ( s.ch === "height" ) updateNormal( T );
        recordStroke( uid, "Gradient", s.before, s.ch );
        return;
      }
      s.s!.end();
      if ( s.ch === "height" ) updateNormal( T );
      if ( s.s!.changedAny ) recordStroke( uid, "Paint", s.before, s.ch );
    };
    const wheel = ( e: WheelEvent ) => {
      e.preventDefault();
      const r    = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      const k    = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      view.x     = sx - ( sx - view.x ) * k;
      view.y     = sy - ( sy - view.y ) * k;
      view.zoom *= k;
      redraw();
    };
    const key = ( e: KeyboardEvent ) => {
      if ( e.key === "Home" && mouse ) {
        fit();
        redraw();
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const leave = () => {
      mouse = null;
      redraw();
    };
    cv.addEventListener( "pointerdown",  down  );
    cv.addEventListener( "pointermove",  move  );
    cv.addEventListener( "pointerup",    up    );
    cv.addEventListener( "pointerleave", leave );
    cv.addEventListener( "wheel",        wheel, { passive: false } );
    window.addEventListener( "keydown", key, true );
    return () => {
      offTex();
      offEditor();
      ro.disconnect();
      cancelAnimationFrame( raf );
      cv.removeEventListener( "pointerdown",  down  );
      cv.removeEventListener( "pointermove",  move  );
      cv.removeEventListener( "pointerup",    up    );
      cv.removeEventListener( "pointerleave", leave );
      cv.removeEventListener( "wheel",        wheel );
      window.removeEventListener( "keydown", key, true );
    };
  }, [uid] );
  return (
    <div className="texture-view">
      <canvas ref={canvas} />
      <button className="btn ghost small close" title="Close" onClick={() => useTexView.setState( { open: false } )}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

/**
 * Fill in 2D: the texels joined to ( x, y ) whose colour is within the tolerance of it, among the used ones.
**/
function fill2d( px: Uint8Array, n: number, used: Uint8Array, x: number, y: number, colour: Rgb, tolerance: number, strength: number ) {
  if ( x < 0 || y < 0 || x >= n || y >= n ) return false;
  const seed = y * n + x;
  if ( !used[seed] ) return false;
  const ref  = [px[seed * 4], px[seed * 4 + 1], px[seed * 4 + 2]], tol = tolerance * 255 * Math.sqrt( 3 );
  const seen = new Uint8Array( n * n ), stack = [seed];
  seen[seed] = 1;
  while ( stack.length ) {
    const k = stack.pop()!;
    for ( let c = 0; c < 3; c++ ) px[k * 4 + c] = Math.round( px[k * 4 + c] + ( colour[c] * 255 - px[k * 4 + c] ) * strength );
    px[k * 4 + 3] = 255;
    const kx      = k % n, ky = Math.floor( k / n );
    for ( const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) {
      const xx = kx + dx, yy = ky + dy;
      if ( xx < 0 || yy < 0 || xx >= n || yy >= n ) continue;
      const j = yy * n + xx;
      if ( seen[j] || !used[j] ) continue;
      seen[j] = 1;
      if ( Math.hypot( px[j * 4] - ref[0], px[j * 4 + 1] - ref[1], px[j * 4 + 2] - ref[2] ) <= tol ) stack.push( j );
    }
  }
  return true;
}
