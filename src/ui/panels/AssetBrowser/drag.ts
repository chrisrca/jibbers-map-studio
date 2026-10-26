// A card dragged out of the asset browser: the piece ( or the game's object, or a material ) following the mouse in the
// 3D view, put down where it's let go.

import type { Object3D } from "three/webgpu";
import { useEditor } from "../../../map/store";
import { type MaterialSource, applyMaterial } from "../../../pieces/library";
import { getEngine } from "../../Viewport";

/**
 * Pointer-based dragging ( the window's native file drop, used to import files from Explorer, switches off HTML5
 * drag and drop in the webview on Windows ). `ghost` builds what follows the cursor in the scene; without one, a
 * small picture of the card follows it instead.
**/
export function startDrag(
  e:    React.PointerEvent,
  opts: { onClick: ( ctrl: boolean ) => void; onDrop: ( x: number, y: number, ev: PointerEvent ) => void; ghost?: () => Promise<Object3D>; picture?: string | null },
) {
  if ( e.button !== 0 ) return;
  const x0                       = e.clientX, y0 = e.clientY;
  let dragging                   = false;
  let pic: HTMLDivElement | null = null;
  const eng                      = getEngine();
  const overViewport             = ( x: number, y: number ) => !!( document.elementFromPoint( x, y ) as HTMLElement | null )?.closest( ".viewport" );
  // held still over the view a moment: its spot is kept, and the mouse turns it from there ( engine.holdLibraryGhost )
  let still                      = 0;
  const move                     = ( m: PointerEvent ) => {
    if ( !dragging && Math.hypot( m.clientX - x0, m.clientY - y0 ) > 6 ) {
      dragging = true;
      document.body.classList.add( "asset-dragging" );
      if ( opts.ghost ) opts.ghost().then( ( g ) => dragging && eng?.placing.setLibraryGhost( g ) );
      else {
        pic           = document.createElement( "div" );
        pic.className = "drag-ghost";
        if ( opts.picture ) pic.style.backgroundImage = `url(${opts.picture})`;
        document.body.appendChild( pic );
      }
    }
    if ( !dragging ) return;
    if ( pic       ) pic.style.transform = `translate(${m.clientX + 12}px, ${m.clientY + 12}px)`;
    if ( opts.ghost ) {
      const over = overViewport( m.clientX, m.clientY );
      eng?.placing.moveLibraryGhost( over ? m.clientX : -1e6, m.clientY, m.ctrlKey );
      clearTimeout( still );
      if ( over ) still = window.setTimeout( () => eng?.placing.holdLibraryGhost(), 350 );
    }
  };
  const up = ( u: PointerEvent ) => {
    clearTimeout( still );
    window.removeEventListener( "pointermove", move );
    window.removeEventListener( "pointerup",   up   );
    document.body.classList.remove( "asset-dragging" );
    pic?.remove();
    const was = dragging;
    dragging  = false;
    // ( the drop first: where it was aimed is the ghost's )
    if ( was && overViewport( u.clientX, u.clientY ) ) opts.onDrop( u.clientX, u.clientY, u );
    if ( opts.ghost ) eng?.placing.setLibraryGhost( null );
    if ( !was ) return opts.onClick( e.ctrlKey );
  };
  window.addEventListener( "pointermove", move );
  window.addEventListener( "pointerup",   up   );
}

export function dropMaterial( src: MaterialSource ) {
  return ( x: number, y: number, ev: PointerEvent ) => {
    const hit = getEngine()?.surfaceAt( x, y );
    if ( hit?.kind === "custom" ) applyMaterial( src, hit, ev.shiftKey );
    else if ( hit?.kind === "feature" )
      useEditor.getState().toast( "That's an old-style game feature placed before the library existed. Place it again from Objects to texture it.", "info" );
  };
}
