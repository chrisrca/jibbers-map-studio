// Blender's colour picker: a hue/saturation wheel with a value bar beside it, then the colour as RGB, HSV or hex.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hexOf, hsvOf, rgbOfHex, rgbOfHsv } from "../../core/colour";
import { NumSlider } from "./widgets";

type RGB   = [number, number, number];
const SIZE = 168;

export function ColourPicker( { value, onChange, recent = [] }: { value: RGB; onChange: ( c: RGB ) => void; recent?: string[] } ) {
  // hue and saturation kept here too: at value 0 ( or saturation 0 ) the colour alone can't say what they were
  const [hsv,     setHsv    ] = useState<[number, number, number]>( () => hsvOf( value ) );
  const [mode,    setMode   ] = useState<"rgb" | "hsv" | "hex">( "hsv" );
  const [hexText, setHexText] = useState( hexOf( value ) );
  const wheel                 = useRef<HTMLCanvasElement>( null );
  useEffect( () => {
    const now  = hsvOf( value );
    const same = hexOf( rgbOfHsv( ...hsv ) ) === hexOf( value );
    if ( !same ) setHsv( [now[2] && now[1] ? now[0] : hsv[0], now[2] ? now[1] : hsv[1], now[2]] );
    setHexText( hexOf( value ) );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value[0], value[1], value[2]] );
  const set = ( h: number, s: number, v: number ) => {
    setHsv( [h, s, v] );
    onChange( rgbOfHsv( h, s, v ) );
  };

  // the wheel at the current value: hue round it, saturation out from the middle
  const v = hsv[2];
  useEffect( () => {
    const c = wheel.current;
    if ( !c ) return;
    const dpr = window.devicePixelRatio || 1, n = Math.round( SIZE * dpr );
    c.width   = c.height = n;
    const ctx = c.getContext( "2d" )!;
    const img = ctx.createImageData( n, n ), R = n / 2;
    for ( let y = 0; y < n; y++ )
      for ( let x = 0; x < n; x++ ) {
        const dx = x + 0.5 - R, dy = y + 0.5 - R, r = Math.hypot( dx, dy ) / R;
        const o  = ( y * n + x ) * 4;
        if ( r > 1 ) continue;
        const [cr, cg, cb] = rgbOfHsv( ( ( Math.atan2( dx, -dy ) / ( Math.PI * 2 ) ) + 1 ) % 1, r, v );
        img.data.set( [cr * 255, cg * 255, cb * 255, Math.min( 1, ( 1 - r ) * R ) * 255], o );
      }
    ctx.putImageData( img, 0, 0 );
  }, [v] );

  const drag = ( e: React.PointerEvent, el: HTMLElement, at: ( fx: number, fy: number ) => void ) => {
    const go = ( ev: { clientX: number; clientY: number } ) => {
      const r = el.getBoundingClientRect();
      at( ( ev.clientX - r.left ) / r.width, ( ev.clientY - r.top ) / r.height );
    };
    go( e );
    const move = ( ev: PointerEvent ) => go( ev );
    const up   = () => {
      window.removeEventListener( "pointermove", move );
      window.removeEventListener( "pointerup",   up   );
    };
    window.addEventListener( "pointermove", move );
    window.addEventListener( "pointerup",   up   );
  };
  const onWheel = ( e: React.PointerEvent<HTMLDivElement> ) =>
    drag( e, e.currentTarget, ( fx, fy ) => {
      const dx = fx - 0.5, dy = fy - 0.5;
      set( ( ( Math.atan2( dx, -dy ) / ( Math.PI * 2 ) ) + 1 ) % 1, Math.min( 1, Math.hypot( dx, dy ) * 2 ), hsv[2] );
    } );
  const onBar = ( e: React.PointerEvent<HTMLDivElement> ) => drag( e, e.currentTarget, ( _, fy ) => set( hsv[0], hsv[1], Math.min( 1, Math.max( 0, 1 - fy ) ) ) );

  const a    = hsv[0] * Math.PI * 2, mark = { left: `${50 + Math.sin( a ) * hsv[1] * 50}%`, top: `${50 - Math.cos( a ) * hsv[1] * 50}%` };
  const full = hexOf( rgbOfHsv( hsv[0], hsv[1], 1 ) );
  const fmt  = ( v: number ) => v.toFixed( 3 );
  return (
    <div className="cpick">
      <div className="cpick-top">
        <div className="cpick-wheel" style={{ width: SIZE, height: SIZE }} onPointerDown={onWheel}>
          <canvas ref={wheel} style={{ width: SIZE, height: SIZE }} />
          <span className="cpick-mark" style={{ ...mark, background: hexOf( value ) }} />
        </div>
        <div className="cpick-bar" style={{ height: SIZE, background: `linear-gradient(${full}, #000)` }} onPointerDown={onBar}>
          <span className="cpick-bar-mark" style={{ top: `${( 1 - hsv[2] ) * 100}%` }} />
        </div>
      </div>
      <div className="seg cpick-modes">
        { ( ["rgb", "hsv", "hex"] as const ).map( ( m ) => (
          <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode( m )}>{m.toUpperCase()}</button>
        ) ) }
      </div>
      { mode === "rgb" &&
        ( ["R", "G", "B"] as const ).map( ( l, k ) => (
          <NumSlider key={l} label={l} value={value[k]} min={0} max={1} fmt={fmt} onChange={( v ) => onChange( value.map( ( x, i ) => ( i === k ? v : x ) ) as RGB )} />
        ) ) }
      { mode === "hsv" && (
        <>
          <NumSlider label="H" value={hsv[0]} min={0} max={1} fmt={fmt} onChange={( v ) => set( v, hsv[1], hsv[2] )} />
          <NumSlider label="S" value={hsv[1]} min={0} max={1} fmt={fmt} onChange={( v ) => set( hsv[0], v, hsv[2] )} />
          <NumSlider label="V" value={hsv[2]} min={0} max={1} fmt={fmt} onChange={( v ) => set( hsv[0], hsv[1], v )} />
        </>
      ) }
      { mode === "hex" && (
        <label className="cpick-hex">
          <span>Hex</span>
          <input
            value={hexText}
            spellCheck={false}
            onChange={( e ) => setHexText( e.target.value )}
            onBlur={() => {
              const c = rgbOfHex( hexText );
              if ( c ) onChange( c );
              else setHexText( hexOf( value ) );
            }}
            onKeyDown={( e ) => {
              if ( e.key === "Enter" ) ( e.target as HTMLInputElement ).blur();
              e.stopPropagation();
            }}
          />
        </label>
      ) }
      { recent.length > 0 && (
        <div className="swatches">
          { recent.map( ( h ) => (
            <button key={h} style={{ background: h }} className={h === hexOf( value ) ? "on" : ""} onClick={() => onChange( rgbOfHex( h )! )} />
          ) ) }
        </div>
      ) }
    </div>
  );
}

/**
 * A colour field: the colour as a chip that opens the picker under it ( closes on a click elsewhere or Esc ).
**/
export function ColourChip( { value, onChange, recent }: { value: RGB; onChange: ( c: RGB ) => void; recent?: string[] } ) {
  const [at, setAt] = useState<DOMRect | null>( null );
  const pop         = useRef<HTMLDivElement>( null );
  useEffect( () => {
    if ( !at ) return;
    const away = ( e: PointerEvent  ) => !pop.current?.contains( e.target as Node ) && setAt( null );
    const esc  = ( e: KeyboardEvent ) => e.key === "Escape" && setAt( null );
    window.addEventListener( "pointerdown", away, true );
    window.addEventListener( "keydown",     esc        );
    return () => {
      window.removeEventListener( "pointerdown", away, true );
      window.removeEventListener( "keydown",     esc        );
    };
  }, [at] );
  const left = at ? Math.max( 8, Math.min( window.innerWidth - 228, at.left ) ) : 0;
  return (
    <>
      <button className="colour-chip" style={{ background: hexOf( value ) }} onClick={( e ) => setAt( at ? null : e.currentTarget.getBoundingClientRect() )} />
      { at &&
        createPortal(
          <div ref={pop} className="bmenu cpick-pop" style={{ left, top: at.bottom + 4 }}>
            <ColourPicker value={value} onChange={onChange} recent={recent} />
          </div>,
          document.body,
        ) }
    </>
  );
}
