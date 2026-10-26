// Tooltips: the app's own ( Blender's look ), shown for anything with a title.

/**
 * Blender-style tooltips for every `title` in the app: the native ones are replaced ( the attribute moves to
 * `data-tip` ) by a dark box that appears under the element after a short wait.
**/
export function installTooltips() {
  let tip: HTMLDivElement | null = null;
  let timer                      = 0;
  let cur: Element | null        = null;
  let x                          = 0;
  const hide                     = () => {
    clearTimeout( timer );
    tip?.remove();
    tip = null;
  };
  const show = ( el: Element ) => {
    const text = el.getAttribute( "data-tip" );
    if ( !text || !el.isConnected ) return;
    tip             = document.createElement( "div" );
    tip.className   = "btip";
    tip.textContent = text;
    document.body.appendChild( tip );
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let top = r.bottom + 6;
    if ( top + h > innerHeight - 4 ) top = r.top - h - 6;
    tip.style.left = `${Math.max( 4, Math.min( x - 12, innerWidth - w - 4 ) )}px`;
    tip.style.top  = `${Math.max( 4, top )}px`;
  };
  document.addEventListener(
    "pointerover",
    ( e ) => {
      const el = ( e.target as Element | null )?.closest?.( "[title], [data-tip]" ) ?? null;
      if ( el === cur ) return;
      hide();
      cur = el;
      if ( !el ) return;
      const t = el.getAttribute( "title" );
      if ( t ) {
        el.setAttribute( "data-tip", t );
        el.removeAttribute( "title" );
      }
      timer = window.setTimeout( () => cur === el && show( el ), 550 );
    },
    true,
  );
  document.addEventListener(
    "pointermove",
    ( e ) => {
      x = e.clientX;
    },
    true,
  );
  for ( const ev of ["pointerdown", "wheel", "keydown", "blur"] ) window.addEventListener( ev, hide, true );
}
