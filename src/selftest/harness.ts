// What the self-tests share: logging, waiting, input as a person gives it, and pictures of the app.

import { type V3, toThree } from "../core/coords";
import { getEngine } from "../ui/Viewport";
import { invoke } from "@tauri-apps/api/core";
import { ipc } from "../core/ipc";
import { useEditor } from "../map/store";

/**
 * A library entry for an official feature, by the game's id ( "tube_long" → Features/…/Tube Long ).
**/
export const feature = ( id: string ) => {
  const name = id.replace( /[_-]/g, " " ).split( " " ).filter( Boolean ).map( ( w ) => w[0].toUpperCase() + w.slice( 1 ) ).join( " " );
  const lib  = useEditor.getState().assetLibrary.filter( ( e ) => e.folder.startsWith( "Features/" ) && e.name === name );
  // the game's look when it's been built, else the app's own
  return ( lib.find( ( e ) => e.id.startsWith( "game:" ) ) ?? lib.find( ( e ) => e.id.startsWith( "app:" ) ) )?.id ?? `missing feature ${id}`;
};

export const log = ( msg: string ) => invoke( "frontend_log", { level: "selftest", message: msg } );

export const sleep = ( ms: number ) => new Promise( ( r ) => setTimeout( r, ms ) );

/**
 * A part of the app drawn as it is to a PNG ( its own page, not the screen ): every element's computed style inlined,
 * the UI font embedded, drawn through an SVG image. For checking how panels look without a screen capture.
**/
export async function domShot( el: Element | null, file: string, scale = 2 ) {
  if ( !el ) return log( `domShot ${file}: nothing to draw` );
  const r     = el.getBoundingClientRect();
  const clone = el.cloneNode( true ) as HTMLElement;
  const copy  = ( src: Element, dst: Element ) => {
    const cs = getComputedStyle( src );
    let css  = "";
    for ( let i = 0; i < cs.length; i++ ) css += `${cs[i]}:${cs.getPropertyValue( cs[i] )};`;
    dst.setAttribute( "style", css );
    if ( src instanceof HTMLInputElement ) dst.setAttribute( "value", src.value );
    for ( let i = 0; i < src.children.length; i++ ) copy( src.children[i], dst.children[i] );
  };
  copy( el, clone );
  clone.style.position  = "absolute";
  clone.style.left      = "0px";
  clone.style.top       = "0px";
  clone.style.margin    = "0px";
  clone.style.right     = "auto";
  clone.style.bottom    = "auto";
  clone.style.transform = "none";
  clone.style.animation = "none";
  clone.style.opacity   = "1";
  clone.style.maxHeight = "none";
  const font            = await fetch( "/fonts/Inter.woff2" ).then( ( x ) => x.arrayBuffer() );
  let bin               = "";
  const bytes           = new Uint8Array( font );
  for ( let i = 0; i < bytes.length; i += 0x8000 ) bin += String.fromCharCode( ...bytes.subarray( i, i + 0x8000 ) );
  const w   = Math.ceil( r.width ), h = Math.ceil( r.height );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${w}px;height:${h}px"><style>@font-face{font-family:"Inter";src:url(data:font/woff2;base64,${btoa( bin )}) format("woff2");font-weight:100 900;}</style>${new XMLSerializer().serializeToString( clone )}</div></foreignObject></svg>`;
  const img = new Image();
  img.src   = `data:image/svg+xml;charset=utf-8,${encodeURIComponent( svg )}`;
  await img.decode();
  const c = new OffscreenCanvas( w * scale, h * scale );
  const g = c.getContext( "2d" )!;
  g.scale( scale, scale );
  g.drawImage( img, 0, 0 );
  const png = new Uint8Array( await ( await c.convertToBlob( { type: "image/png" } ) ).arrayBuffer() );
  await ipc.writeBinary( file, png );
}

export async function waitFor<T>( f: () => T | null | undefined | false, label: string, ms = 20000 ): Promise<T> {
  const t0 = performance.now();
  for ( ;; ) {
    const v = f();
    if ( v ) return v;
    if ( performance.now() - t0 > ms ) throw new Error( `timeout waiting for ${label}` );
    await sleep( 100 );
  }
}

export const plainNameOf = ( s: string ) => s.replace( /<[^>]*>/g, "" ).trim();

/**
 * A card in the asset bar clicked as the mouse does it: pressed and let go where it is ( cards act on that, not on a
 * click event: they can be dragged too ).
**/
export function pressCard( card: HTMLElement | null | undefined ) {
  if ( !card ) return;
  const r = card.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  card.dispatchEvent( new PointerEvent( "pointerdown", { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y, pointerId: 9 } ) );
  window.dispatchEvent( new PointerEvent( "pointerup", { bubbles: true, button: 0, buttons: 0, clientX: x, clientY: y, pointerId: 9 } ) );
}

/**
 * Input as a person gives it, for the realistic runs: the mouse glides ( a move a frame, never jumping ), a click is a
 * press and a release, drags move every frame, the wheel turns in ticks, keys go down and up. Every frame's time is
 * kept by the phase `phase()` names, with the time the input itself took; report() sums them up per phase.
**/
export function realInput( eng: NonNullable<ReturnType<typeof getEngine>>, phase: () => string ) {
  const canvas = eng.renderer.domElement, rc = canvas.getBoundingClientRect();
  const frames = new Map<string, number[]>(), input = new Map<string, number[]>();
  let last     = performance.now(), on = true, inputThisFrame = 0;
  const tick   = () => {
    const t = performance.now(), ph = phase();
    ( frames.get( ph ) ?? frames.set( ph, [] ).get( ph )! ).push( t - last     );
    ( input.get( ph ) ?? input.set( ph, [] ).get( ph )! ).push( inputThisFrame );
    inputThisFrame = 0;
    last           = t;
    if ( on ) requestAnimationFrame( tick );
  };
  requestAnimationFrame( tick );
  const frame = () => new Promise<void>( ( r ) => requestAnimationFrame( () => r() ) );
  const m     = { x: rc.width / 2, y: rc.height / 2, buttons: 0 };
  const send  = ( type: string, extra: Record<string, unknown> = {} ) => {
    const t    = performance.now();
    const init = { clientX: rc.left + m.x, clientY: rc.top + m.y, buttons: m.buttons, pointerId: 1, bubbles: true, cancelable: true, ...extra };
    ( type === "pointerup" ? window : canvas ).dispatchEvent( new PointerEvent( type, init ) );
    inputThisFrame += performance.now() - t;
  };
  canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
  const glide = async ( x: number, y: number, ms: number, extra: Record<string, unknown> = {} ) => {
    const n = Math.max( 1, Math.round( ms / 16.7 ) ), x0 = m.x, y0 = m.y;
    for ( let k = 1; k <= n; k++ ) {
      const f = k / n, e = f * f * ( 3 - 2 * f );
      m.x     = x0 + ( x - x0 ) * e;
      m.y     = y0 + ( y - y0 ) * e;
      send( "pointermove", extra );
      await frame();
    }
  };
  const press = async ( button: 0 | 1 | 2, extra: Record<string, unknown> = {} ) => {
    m.buttons |= button === 0 ? 1 : button === 1 ? 4 : 2;
    send( "pointerdown", { button, ...extra } );
    await frame();
  };
  const release = async ( button: 0 | 1 | 2, extra: Record<string, unknown> = {} ) => {
    m.buttons &= ~( button === 0 ? 1 : button === 1 ? 4 : 2 );
    send( "pointerup", { button, ...extra } );
    await frame();
  };
  const click = async ( x: number, y: number, travel = 350, extra: Record<string, unknown> = {} ) => {
    await glide( x, y, travel );
    await press( 0, extra );
    await sleep( 70 );
    await release( 0, extra );
  };
  const drag = async ( x0: number, y0: number, x1: number, y1: number, ms: number, button: 0 | 1 = 0, extra: Record<string, unknown> = {} ) => {
    await glide( x0, y0, 250 );
    await press( button, extra );
    await glide( x1, y1, ms, extra );
    await release( button, extra );
  };
  const wheel = async ( dy: number, ticks: number ) => {
    for ( let k = 0; k < ticks; k++ ) {
      const t = performance.now();
      canvas.dispatchEvent( new WheelEvent( "wheel", { deltaY: dy, clientX: rc.left + m.x, clientY: rc.top + m.y, bubbles: true, cancelable: true } ) );
      inputThisFrame += performance.now() - t;
      await frame();
      await frame();
    }
  };
  const key = async ( k: string, mods: { ctrl?: boolean; shift?: boolean } = {} ) => {
    const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
    const t    = performance.now();
    const init = { key: k, code, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, bubbles: true, cancelable: true };
    window.dispatchEvent( new KeyboardEvent( "keydown", init ) );
    window.dispatchEvent( new KeyboardEvent( "keyup",   init ) );
    inputThisFrame += performance.now() - t;
    await frame();
  };
  const scr = ( u: V3 ) => {
    const q = toThree( u ).project( eng.camera );
    return [( q.x * 0.5 + 0.5 ) * rc.width, ( -q.y * 0.5 + 0.5 ) * rc.height] as const;
  };
  const stat = ( a: number[] ) => {
    const b = [...a].sort( ( x, y ) => x - y ), q = ( f: number ) => b[Math.min( b.length - 1, Math.floor( f * b.length ) )];
    return { n: b.length, p50: q( 0.5 ), p95: q( 0.95 ), max: b[b.length - 1] ?? 0, over50: b.filter( ( x ) => x > 50 ).length, over34: b.filter( ( x ) => x > 34 ).length };
  };
  /**
   * Per phase: frames, typical / 95% / worst frame, how many over 34 and 50 ms, the input's own time.
  **/
  const report = () =>
    [...frames].map( ( [ph, a] ) => {
      const f = stat( a.slice( 1 ) ), i = stat( input.get( ph )! );
      return `${ph}: ${f.n} frames, typical ${f.p50.toFixed( 0 )} ms, 95% ${f.p95.toFixed( 0 )} ms, worst ${f.max.toFixed( 0 )} ms, ${f.over34} over 34 ms, ${f.over50} over 50 ms; input took up to ${i.max.toFixed( 0 )} ms a frame (95% ${i.p95.toFixed( 0 )})`;
    } );
  return { rc, m, frame, glide, press, release, click, drag, wheel, key, scr, report, frames, stop: () => void ( on = false ) };
}
