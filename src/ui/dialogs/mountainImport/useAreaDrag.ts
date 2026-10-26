// The area on the map, by dragging: drawn out ( the Draw tool ), moved ( a drag inside it ), a chunk left out or put back
// ( a click on it ); the coordinates under the mouse in the status bar.

import maplibregl from "maplibre-gl";
import { useEffect, type RefObject } from "react";
import { CHUNK, type ImportArea } from "../../../geo/importMountain";
import { LocalProjection, type LonLat } from "../../../geo/proj";
import { lonLatText, MAX_CHUNKS } from "./mapLook";

// The area being moved: where the drag began, the area's centre then, the mouse then, and whether it's moved yet.
type Moving = { from: LonLat; center: LonLat; at: { x: number; y: number }; dragged: boolean };

export function useAreaDrag( o: {
  map:        RefObject<maplibregl.Map | null>;
  // the area and the Draw tool as they are now ( read as the mouse moves )
  areaRef:    RefObject<ImportArea | null>;
  drawingRef: RefObject<boolean>;
  cursorEl:   RefObject<HTMLSpanElement | null>;
  setArea:    ( a: ImportArea ) => void;
  setSkip:    ( f: ( old: Set<string> ) => Set<string> ) => void;
  setDrawing: ( on: boolean ) => void;
} ) {
  useEffect( () => {
    const m                             = o.map.current!;
    let start: maplibregl.LngLat | null = null;
    let moving: Moving | null           = null;
    // the area follows the mouse once a frame, however often the mouse reports
    let pending: ImportArea | null      = null, raf = 0;
    const put                           = ( a: ImportArea ) => {
      pending = a;
      if ( !raf )
        raf = requestAnimationFrame( () => {
          raf = 0;
          if ( pending ) o.setArea( pending );
        } );
    };
    const inside = ( ll: maplibregl.LngLat ) => {
      const a = o.areaRef.current;
      if ( !a ) return false;
      const [x, z] = new LocalProjection( a.center ).forward( { lon: ll.lng, lat: ll.lat } );
      return Math.abs( x ) <= ( a.chunksX * CHUNK ) / 2 && Math.abs( z ) <= ( a.chunksZ * CHUNK ) / 2;
    };
    const down = ( e: maplibregl.MapMouseEvent ) => {
      if ( e.originalEvent.button !== 0 ) return;
      if ( o.drawingRef.current ) {
        start = e.lngLat;
        m.dragPan.disable();
      } else if ( inside( e.lngLat ) ) {
        moving = { from: { lon: e.lngLat.lng, lat: e.lngLat.lat }, center: o.areaRef.current!.center, at: { x: e.point.x, y: e.point.y }, dragged: false };
        m.dragPan.disable();
      }
    };
    const move = ( e: maplibregl.MapMouseEvent ) => {
      if ( o.cursorEl.current ) o.cursorEl.current.textContent = lonLatText( { lon: e.lngLat.lng, lat: e.lngLat.lat } );
      if ( start ) {
        // from the press point to the cursor, rounded up to whole chunks
        const proj     = new LocalProjection( { lon: start.lng, lat: start.lat } );
        const [dx, dz] = proj.forward( { lon: e.lngLat.lng, lat: e.lngLat.lat } );
        const cx       = Math.min( MAX_CHUNKS, Math.max( 1, Math.ceil( Math.abs( dx ) / CHUNK ) ) );
        const cz       = Math.min( MAX_CHUNKS, Math.max( 1, Math.ceil( Math.abs( dz ) / CHUNK ) ) );
        const center   = proj.inverse( ( Math.sign( dx || 1 ) * cx * CHUNK ) / 2, ( Math.sign( dz || 1 ) * cz * CHUNK ) / 2 );
        put( { center, chunksX: cx, chunksZ: cz } );
      } else if ( moving ) {
        if ( !moving.dragged && Math.hypot( e.point.x - moving.at.x, e.point.y - moving.at.y ) < 4 ) return;
        moving.dragged = true;
        const a        = o.areaRef.current!;
        const proj     = new LocalProjection( moving.center );
        const [fx, fz] = proj.forward( moving.from ), [tx, tz] = proj.forward( { lon: e.lngLat.lng, lat: e.lngLat.lat } );
        put( { ...a, center: proj.inverse( tx - fx, tz - fz ) } );
      } else {
        m.getCanvas().style.cursor = o.drawingRef.current ? "crosshair" : inside( e.lngLat ) ? "move" : "";
      }
    };
    // let go anywhere ( over the sidebar, outside the window ): the drag ends and the map pans again
    const up = () => {
      // pressed and let go without moving: that chunk in or out of the import
      if ( moving && !moving.dragged ) {
        const a      = o.areaRef.current!;
        const [x, z] = new LocalProjection( a.center ).forward( moving.from );
        const i      = Math.floor( x / CHUNK + a.chunksX / 2 ), j = Math.floor( z / CHUNK + a.chunksZ / 2 );
        if ( i >= 0 && j >= 0 && i < a.chunksX && j < a.chunksZ )
          o.setSkip( ( old ) => {
            const next = new Set( old ), key = `${i},${j}`;
            if ( !next.delete( key ) ) next.add( key );
            return next.size >= a.chunksX * a.chunksZ ? old : next; // ( one at least stays in )
          } );
      }
      if ( start || moving ) m.dragPan.enable();
      if ( start ) o.setDrawing( false );
      start  = null;
      moving = null;
    };
    const out = () => o.cursorEl.current && ( o.cursorEl.current.textContent = "" );
    m.on( "mousedown", down );
    m.on( "mousemove", move );
    window.addEventListener( "mouseup", up );
    window.addEventListener( "blur",    up );
    m.on( "mouseout", out );
    return () => {
      cancelAnimationFrame( raf );
      m.off( "mousedown", down );
      m.off( "mousemove", move );
      window.removeEventListener( "mouseup", up );
      window.removeEventListener( "blur",    up );
      m.off( "mouseout", out );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [] );
}
