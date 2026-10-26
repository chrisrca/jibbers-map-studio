// Menus ( Blender's ): a popup menu with submenus and keys, the button that opens one, a popover.

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BlIcon } from "../../blender/BlIcon";
import { Icon, type IconName } from "../icons";

export interface MenuItem {
  label:     string;
  keys?:     string;
  icon?:     IconName;
  // one of Blender's icons instead ( ui/blender )
  bl?:       string;
  run?:      () => void;
  disabled?: boolean;
  sep?:      boolean;
  // shown as the current choice ( dropdowns )
  checked?:  boolean;
  title?:    string;
  // a submenu, opened beside it when the pointer's over it
  sub?:      MenuItem[];
}

/**
 * A popup menu under ( or above, when there's no room ) `anchor`. Closes on a click outside, Esc or a choice.
**/
export function PopupMenu( { anchor, items, title, onClose, minWidth = 0, onHover }: {
  anchor:    DOMRect;
  items:     MenuItem[];
  title?:    string;
  onClose:   () => void;
  minWidth?: number;
  // the pointer went over another element ( the menu bar switches menus )
  onHover?:  ( e: MouseEvent ) => void;
} ) {
  const ref               = useRef<HTMLDivElement>( null );
  const [pos,   setPos  ] = useState<{ left: number; top: number  } | null>( null );
  const [subOf, setSubOf] = useState<{ i:    number; at:  DOMRect } | null>( null );
  const close             = useRef( onClose );
  close.current           = onClose;

  useLayoutEffect( () => {
    const el = ref.current!;
    const w  = el.offsetWidth, h = el.offsetHeight;
    let top  = anchor.bottom + 1;
    if ( top + h > innerHeight - 4 && anchor.top - h - 1 > 4 ) top = anchor.top - h - 1;
    setPos( { left: Math.max( 4, Math.min( anchor.left, innerWidth - w - 4 ) ), top: Math.max( 4, Math.min( top, innerHeight - h - 4 ) ) } );
  }, [anchor] );

  useEffect( () => {
    // ( a click in one of its submenus is still in it )
    const down = ( e: MouseEvent ) => !( e.target as Element | null )?.closest?.( ".bmenu" ) && close.current();
    const key  = ( e: KeyboardEvent ) => {
      if ( e.key !== "Escape" ) return;
      e.stopPropagation();
      close.current();
    };
    const blur = () => close.current();
    const over = ( e: MouseEvent ) => onHover?.( e );
    window.addEventListener( "mousedown", down, true );
    window.addEventListener( "keydown",   key,  true );
    window.addEventListener( "blur",      blur       );
    window.addEventListener( "resize",    blur       );
    if ( onHover ) window.addEventListener( "mouseover", over );
    return () => {
      window.removeEventListener( "mousedown", down, true );
      window.removeEventListener( "keydown",   key,  true );
      window.removeEventListener( "blur",      blur       );
      window.removeEventListener( "resize",    blur       );
      window.removeEventListener( "mouseover", over       );
    };
  }, [onHover] );

  return createPortal(
    <div
      ref={ref}
      className="bmenu"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, minWidth: Math.max( minWidth, anchor.width ) }}
      onContextMenu={( e ) => e.preventDefault()}
    >
      {title && <div className="bmenu-title">{title}</div>}
      { items.map( ( it, i ) =>
        it.sep ? (
          <div key={i} className="bmenu-sep" />
        ) : (
          <button
            key={i}
            type="button"
            className={`bmenu-item ${it.checked ? "checked" : ""} ${subOf?.i === i ? "open" : ""}`}
            disabled={it.disabled}
            title={it.title}
            onMouseEnter={( e ) => setSubOf( it.sub ? { i, at: e.currentTarget.getBoundingClientRect() } : null )}
            onClick={( e ) => {
              if ( it.sub ) return setSubOf( { i, at: e.currentTarget.getBoundingClientRect() } );
              close.current();
              it.run?.();
            }}
          >
            <span className="ico">{it.bl ? <BlIcon name={it.bl} /> : it.icon && <Icon name={it.icon} />}</span>
            <span className="lbl">{it.label}</span>
            {it.keys && <span className="keys">{it.keys}</span>}
            {it.sub && <span className="more"><BlIcon name="rightarrow_thin" size={10} /></span>}
          </button>
        ),
      ) }
      { subOf && items[subOf.i]?.sub && (
        <PopupMenu anchor={new DOMRect( subOf.at.right - 1, subOf.at.top - 5, 0, 0 )} items={items[subOf.i].sub!} onClose={() => ( setSubOf( null ), close.current() )} />
      ) }
    </div>,
    document.body,
  );
}

/**
 * A button that opens a popup menu ( Blender's pulldowns in headers: "View", "Select", "Add", … ).
**/
export function MenuButton( { label, items, icon, bl, className = "", title, caret = true }: { label?: string; items: MenuItem[] | ( () => MenuItem[] ); icon?: IconName; bl?: string; className?: string; title?: string; caret?: boolean } ) {
  const [anchor, setAnchor] = useState<DOMRect | null>( null );
  return (
    <>
      <button
        type="button"
        className={`bpull ${anchor ? "open" : ""} ${className}`}
        title={title}
        onMouseDown={( e ) => {
          if ( e.button !== 0 ) return;
          e.preventDefault();
          setAnchor( anchor ? null : e.currentTarget.getBoundingClientRect() );
        }}
      >
        {icon && <Icon name={icon} />}
        {bl && <BlIcon name={bl} />}
        {label}
        {bl && !label && caret && <BlIcon name="disclosure_tri_down" size={10} />}
      </button>
      {anchor && <PopupMenu anchor={anchor} items={typeof items === "function" ? items() : items} onClose={() => setAnchor( null )} />}
    </>
  );
}

/**
 * A header button opening a panel of settings under it ( Blender's popovers: Viewport Overlays… ).
**/
export function Popover( { title, children }: { title: string; children: ReactNode } ) {
  const [anchor, setAnchor] = useState<DOMRect | null>( null );
  const ref                 = useRef<HTMLDivElement>( null );
  useEffect( () => {
    if ( !anchor ) return;
    const down = ( e: MouseEvent    ) => !ref.current?.contains( e.target as Node ) && !( e.target as Element | null )?.closest?.( ".pop-btn" ) && setAnchor( null );
    const key  = ( e: KeyboardEvent ) => e.key === "Escape" && setAnchor( null );
    window.addEventListener( "mousedown", down, true );
    window.addEventListener( "keydown",   key,  true );
    return () => {
      window.removeEventListener( "mousedown", down, true );
      window.removeEventListener( "keydown",   key,  true );
    };
  }, [anchor] );
  return (
    <>
      <button type="button" className={`bpull pop-btn ${anchor ? "open" : ""}`} title={title} onMouseDown={( e ) => {
        if ( e.button !== 0 ) return;
        e.preventDefault();
        setAnchor( anchor ? null : e.currentTarget.getBoundingClientRect() );
      }}>
        <BlIcon name="disclosure_tri_down" size={10} />
      </button>
      { anchor &&
        createPortal(
          <div ref={ref} className="popover" style={{ top: anchor.bottom + 2, left: Math.max( 4, Math.min( anchor.right - 240, innerWidth - 248 ) ) }}>
            <div className="bmenu-title">{title}</div>
            {children}
          </div>,
          document.body,
        ) }
    </>
  );
}
