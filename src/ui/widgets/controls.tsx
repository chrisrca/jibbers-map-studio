import { Fragment, useState, type ReactNode } from "react";
import { fromBlender, rotFromBlender, rotToBlender, toBlender } from "../../core/blenderAxes";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { Icon, type IconName } from "./icons";
import { NumSlider, PanelGroups } from "./widgets";

interface ScrubOptions {
  value:     number;
  onChange:  ( v: number ) => void;
  onCommit?: () => void;
  step?:     number;
  min?:      number;
  max?:      number;
  // pointer released without dragging
  onClick?:  () => void;
}

/**
 * Puts the pointer at a place in the window ( logical pixels, as clientX/Y ).
**/
function putPointer( x: number, y: number ) {
  getCurrentWindow().setCursorPosition( new LogicalPosition( x, y ) ).catch( () => {} );
}

/**
 * Blender-style value dragging: press and drag left/right to change a number; a click without dragging types one
 * instead. The pointer is hidden while dragging and brought back round when it nears the window's edge, so a drag
 * never runs out, and it's put back where it started when the drag ends. Shift = fine, Ctrl = coarse.
 *
 * ( Not the browser's pointer lock: it puts up a "press Esc to show your cursor" banner, and the first movement it
 * reports after locking can be a big jump, which threw the value to its end. )
**/
export function startScrub( e: React.PointerEvent, o: ScrubOptions ) {
  if ( e.button !== 0 ) return;
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  try {
    el.setPointerCapture( e.pointerId );
  } catch {
    // fine: the window listeners still hear it
  }
  const start               = o.value;
  const home                = { x: e.clientX, y: e.clientY };
  let last                  = e.clientX;
  let acc                   = 0;
  let moved                 = false;
  // where the pointer was sent back to, until it gets there
  let sentTo: number | null = null;
  const clampV              = ( v: number ) => Math.min( o.max ?? Infinity, Math.max( o.min ?? -Infinity, v ) );
  const move                = ( m: PointerEvent ) => {
    if ( sentTo !== null && Math.abs( m.clientX - sentTo ) < 16 ) {
      last   = m.clientX;
      sentTo = null;
      return;
    }
    const dx = m.clientX - last;
    last     = m.clientX;
    if ( Math.abs( dx ) > 300 ) return; // not a hand's movement in one step
    acc += dx;
    if ( !moved ) {
      if ( Math.abs( acc ) < 3 ) return;
      moved = true;
      document.documentElement.classList.add( "scrubbing" );
    }
    const mul = m.shiftKey ? 0.1 : m.ctrlKey ? 10 : 1;
    onChangeThrottled( clampV( start + acc * ( o.step ?? 0.1 ) * mul ) );
    // nearing the window's edge: back to where the drag began, and on from there
    if ( sentTo === null && ( m.clientX < 32 || m.clientX > window.innerWidth - 32 ) ) {
      sentTo = home.x;
      putPointer( home.x, home.y );
    }
  };
  // keep pace with the screen, not with every mouse event
  let pending: number | null = null;
  let frame                  = 0;
  const onChangeThrottled    = ( v: number ) => {
    pending = v;
    if ( !frame ) frame = requestAnimationFrame( () => {
      frame = 0;
      if ( pending !== null ) o.onChange( pending );
      pending = null;
    } );
  };
  const up = () => {
    window.removeEventListener( "pointermove",   move );
    window.removeEventListener( "pointerup",     up   );
    window.removeEventListener( "pointercancel", up   );
    document.documentElement.classList.remove( "scrubbing" );
    if ( frame   ) cancelAnimationFrame( frame );
    if ( pending !== null ) o.onChange( pending );
    if ( moved ) {
      putPointer( home.x, home.y );
      o.onCommit?.();
    } else o.onClick?.();
  };
  window.addEventListener( "pointermove",   move );
  window.addEventListener( "pointerup",     up   );
  window.addEventListener( "pointercancel", up   );
}

/**
 * Number field like Blender's: drag on it to change the value, click ( without dragging ) to type one. Enter or
 * clicking away confirms, Esc cancels.
**/
export function NumberField( {
  value, onChange, step = 0.1, min, max, digits = 2, className = "", onCommit, label, unit, trim,
}: {
  value:      number;
  onChange:   ( v: number ) => void;
  // called once when a drag or edit finishes ( for undo grouping )
  onCommit?:  () => void;
  step?:      number;
  min?:       number;
  max?:       number;
  digits?:    number;
  className?: string;
  // name shown inside on the left ( "X", "Size" )
  label?:     string;
  unit?:      string;
  // trailing zeros dropped
  trim?:      boolean;
} ) {
  const [editing, setEditing] = useState( false );
  const [text,    setText   ] = useState( ""    );
  const clampV                = ( v: number ) => Math.min( max ?? Infinity, Math.max( min ?? -Infinity, v ) );
  const fixed                 = Number.isFinite( value ) ? value.toFixed( digits ) : "";
  const shown                 = trim && fixed.includes( "." ) ? fixed.replace( /\.?0+$/, "" ).replace( /^-0$/, "0" ) : fixed;

  if ( editing )
    return (
      <input
        className={`num ${className}`}
        autoFocus
        value={text}
        onFocus={( e ) => e.target.select()}
        onChange={( e ) => setText( e.target.value )}
        onBlur={() => {
          setEditing( false );
          const v = parseFloat( text );
          if ( !Number.isNaN( v ) && v !== value ) {
            onChange( clampV( v ) );
            onCommit?.();
          }
        }}
        onKeyDown={( e ) => {
          if ( e.key === "Enter" ) ( e.target as HTMLInputElement ).blur();
          if ( e.key === "Escape" ) {
            setText( shown );
            setEditing( false );
          }
        }}
      />
    );
  const nudge = ( d: number ) => {
    onChange( clampV( value + d * step ) );
    onCommit?.();
  };
  return (
    <div
      className={`num drag-num ${label ? "labelled" : ""} ${className}`}
      tabIndex={0}
      title="Drag to change · click to type · Shift = fine, Ctrl = coarse"
      onPointerDown={( e ) =>
        startScrub( e, { value, onChange, onCommit, step, min, max, onClick: () => { setText( shown ); setEditing( true ); } } )
      }
      onKeyDown={( e ) => {
        if ( e.key === "Enter" ) {
          setText( shown );
          setEditing( true );
        }
      }}
    >
      <span className="arrow l" onPointerDown={( e ) => { e.stopPropagation(); e.preventDefault(); }} onClick={( e ) => { e.stopPropagation(); nudge( -1 ); }}>
        <Icon name="chevronLeft" size={10} />
      </span>
      {label && <span className="lbl">{label}</span>}
      <span className="val">{shown}{unit ? ( unit === "°" ? unit : ` ${unit}` ) : ""}</span>
      <span className="arrow r" onPointerDown={( e ) => { e.stopPropagation(); e.preventDefault(); }} onClick={( e ) => { e.stopPropagation(); nudge( 1 ); }}>
        <Icon name="chevronRight" size={10} />
      </span>
    </div>
  );
}

/**
 * Three numbers on Blender's axes ( the game's are stored: see core/blenderAxes.ts ): a position or direction ( Y and
 * Z swapped ), a rotation ( Blender's XYZ Euler ), or a scale. With a `label`, Blender's column ( "Location X", "Y",
 * "Z" a row each, in the Properties grid ); without, the three in a row.
**/
export function Vec3Field( { value, onChange, onCommit, step = 0.1, digits = 2, unit, kind = "position", label, trim }: {
  value:     [number, number, number];
  onChange:  ( v: [number, number, number] ) => void;
  onCommit?: () => void;
  step?:     number;
  digits?:   number;
  unit?:     string;
  kind?:     "position" | "rotation" | "scale";
  label?:    string;
  // trailing zeros dropped ( "4.5865 m", "0 m" )
  trim?:     boolean;
} ) {
  const shown = kind === "rotation" ? rotToBlender( value ) : toBlender( value );
  const set   = ( i: number ) => ( v: number ) => {
    const n = [...shown] as [number, number, number];
    n[i]    = v;
    onChange( kind === "rotation" ? rotFromBlender( n ) : fromBlender( n ) );
  };
  const field = ( i: number, inner?: string ) => (
    <NumberField key={i} className={["x", "y", "z"][i]} label={inner} value={shown[i]} onChange={set( i )} onCommit={onCommit} step={step} digits={digits} unit={unit} trim={trim} />
  );
  if ( label )
    return (
      <>
        { [0, 1, 2].map( ( i ) => (
          <Fragment key={i}>
            <label className={`vec-lbl ${i ? "" : "first"}`}>{i ? ["X", "Y", "Z"][i] : `${label} X`}</label>
            <div className={`vec-cell ${["first", "mid", "last"][i]}`}>{field( i )}</div>
          </Fragment>
        ) ) }
      </>
    );
  return <div className="vec">{[0, 1, 2].map( ( i ) => field( i, ["X", "Y", "Z"][i] ) )}</div>;
}

/**
 * `log`: the track is logarithmic, so small values get as much room as big ones ( brush sizes ).
**/
export function Slider( { label, value, min, max, step, onChange, fmt, log, width = 150 }: {
  label: string; value: number; min: number; max: number; step: number; onChange: ( v: number ) => void; fmt?: ( v: number ) => string; log?: boolean; width?: number;
} ) {
  return (
    <div className="group" style={{ width }}>
      <NumSlider label={label} value={value} min={min} max={max} step={step} onChange={onChange} fmt={fmt} log={log} />
    </div>
  );
}

/**
 * Drag handle that resizes a neighbouring pane.
**/
export function Splitter( { dir, onDrag }: { dir: "h" | "v"; onDrag: ( delta: number ) => void } ) {
  return (
    <div
      className={dir === "h" ? "split-h" : "split-v"}
      onPointerDown={( e ) => {
        const start = dir === "h" ? e.clientX : e.clientY;
        let last    = start;
        const move  = ( ev: PointerEvent ) => {
          const cur = dir === "h" ? ev.clientX : ev.clientY;
          onDrag( cur - last );
          last = cur;
        };
        const up = () => {
          window.removeEventListener( "pointermove", move );
          window.removeEventListener( "pointerup",   up   );
        };
        window.addEventListener( "pointermove", move );
        window.addEventListener( "pointerup",   up   );
      }}
    />
  );
}

/**
 * A Properties editor page: Blender's context line ( what's being edited ) over stacked panels. Inside it, every
 * `.section` heading in a `.props` grid becomes a folding panel holding the rows under it.
**/
export function Panel( { title, extra, children, icon, head }: { title: string; extra?: ReactNode; children: ReactNode; icon?: IconName; head?: ReactNode } ) {
  const kind = title.split( " · " )[0];
  return (
    <div className="panel">
      <div className={`ctx ${head ? "own" : ""}`}>
        { head ?? (
          <>
            {icon && <Icon name={icon} />}
            <span className="ttl">{title}</span>
            <span className="spacer" />
            {extra}
          </>
        ) }
      </div>
      <div className="body">
        <PanelGroups kind={kind}>{children}</PanelGroups>
      </div>
    </div>
  );
}

export function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.6 4.2h10.8M6.3 4.2V2.9h3.4v1.3M3.9 4.2l.6 8.5c0 .5.4.9.9.9h5.2c.5 0 .9-.4.9-.9l.6-8.5M6.6 6.8v4.4M9.4 6.8v4.4" />
    </svg>
  );
}
