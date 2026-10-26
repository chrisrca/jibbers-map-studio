// Fields ( Blender's ): a dropdown, and the slider-field you drag or type into.

import { useRef, useState } from "react";
import { startScrub } from "../controls";
import { Icon, type IconName } from "../icons";
import { PopupMenu } from "./menus";

export interface Option<T> {
  value:  T;
  label:  string;
  icon?:  IconName;
  title?: string;
}

/**
 * Blender's enum menu button: the current choice and a chevron; click for the list. Replaces <select>.
**/
export function Dropdown<T extends string | number>( { value, options, onChange, title, className = "", menuTitle, icon }: {
  value:      T;
  options:    Option<T>[];
  onChange:   ( v: T ) => void;
  title?:     string;
  className?: string;
  menuTitle?: string;
  icon?:      IconName;
} ) {
  const [anchor, setAnchor] = useState<DOMRect | null>( null );
  const cur                 = options.find( ( o ) => o.value === value );
  const ico                 = cur?.icon ?? icon;
  return (
    <>
      <button
        type="button"
        className={`bdrop ${anchor ? "open" : ""} ${className}`}
        title={title}
        onMouseDown={( e ) => {
          if ( e.button !== 0 ) return;
          e.preventDefault();
          setAnchor( anchor ? null : e.currentTarget.getBoundingClientRect() );
        }}
      >
        {ico && <Icon name={ico} />}
        <span className="lbl">{cur?.label ?? String( value )}</span>
        <Icon name="chevronDown" size={12} className="chev" />
      </button>
      { anchor && (
        <PopupMenu
          anchor={anchor}
          title={menuTitle}
          onClose={() => setAnchor( null )}
          items={options.map( ( o ) => ( { label: o.label, icon: o.icon, title: o.title, checked: o.value === value, run: () => onChange( o.value ) } ) )}
        />
      ) }
    </>
  );
}

/**
 * Blender's number slider: the bar fills to the value; drag anywhere on it to change it ( Shift fine, Ctrl coarse ),
 * click to type a number. With a `label` the name sits inside on the left ( tool headers ).
**/
export function NumSlider( { label, value, min, max, step = 0, onChange, onCommit, fmt, log, digits = 2, className = "", title }: {
  label?:     string;
  value:      number;
  min:        number;
  max:        number;
  step?:      number;
  onChange:   ( v: number ) => void;
  onCommit?:  () => void;
  fmt?:       ( v: number ) => string;
  // logarithmic track: small values get as much room as big ones ( brush sizes )
  log?:       boolean;
  digits?:    number;
  className?: string;
  title?:     string;
} ) {
  const ref                   = useRef<HTMLDivElement>( null );
  const [editing, setEditing] = useState( false );
  const [text,    setText   ] = useState( ""    );
  const clamp01               = ( t: number ) => Math.min( 1, Math.max( 0, t ) );
  const toT                   = ( v: number ) => ( log ? Math.log( Math.max( v, min ) / min ) / Math.log( max / min ) : ( v - min ) / ( max - min || 1 ) );
  const fromT                 = ( t: number ) => {
    const v = log ? min * Math.pow( max / min, clamp01( t ) ) : min + clamp01( t ) * ( max - min );
    return step ? Math.max( min, Math.round( v / step ) * step ) : v;
  };
  const t     = clamp01( toT( value ) );
  const shown = fmt ? fmt( value ) : value.toFixed( digits );

  if ( editing )
    return (
      <input
        className={`bslider editing ${className}`}
        autoFocus
        value={text}
        onFocus={( e ) => e.target.select()}
        onChange={( e ) => setText( e.target.value )}
        onBlur={() => {
          setEditing( false );
          const v = parseFloat( text );
          if ( !Number.isNaN( v ) && v !== value ) {
            onChange( Math.min( max, Math.max( min, v ) ) );
            onCommit?.();
          }
        }}
        onKeyDown={( e ) => {
          if ( e.key === "Enter" ) ( e.target as HTMLInputElement ).blur();
          if ( e.key === "Escape" ) {
            setText( String( value ) );
            setEditing( false );
          }
        }}
      />
    );
  return (
    <div
      ref={ref}
      className={`bslider ${label ? "labelled" : ""} ${className}`}
      tabIndex={0}
      title={title}
      onPointerDown={( e ) =>
        startScrub( e, {
          value:    t,
          onChange: ( tt ) => onChange( fromT( tt ) ),
          onCommit,
          step:     1 / Math.max( 60, ref.current?.clientWidth ?? 120 ),
          min:      0,
          max:      1,
          onClick:  () => {
            setText( String( +value.toFixed( 6 ) ) );
            setEditing( true );
          },
        } )
      }
      onKeyDown={( e ) => {
        if ( e.key === "Enter" ) {
          setText( String( +value.toFixed( 6 ) ) );
          setEditing( true );
        }
      }}
    >
      <div className="fill" style={{ width: `${t * 100}%` }} />
      {label && <span className="lbl">{label}</span>}
      <span className="val">{shown}</span>
    </div>
  );
}
