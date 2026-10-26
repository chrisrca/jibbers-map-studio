import { useEffect, useRef, useState } from "react";
import { PopupMenu, type MenuItem } from "./widgets/widgets";
import { useEditor, workspaceOf } from "../map/store";
import { useDecal, useStencil, type StencilState } from "../texture/stencil";
import { TextureView } from "./panels/TextureView";
import { ViewOverlays } from "./blender/ViewOverlays";
import { Engine } from "../viewport/engine/engine";
import { ToolColumn } from "./Toolbar";
import { RichText } from "./widgets/RichText";
import { customName } from "../core/types";

let current: Engine | null = null;
export const getEngine     = () => current;


/**
 * A menu the 3D view asks for ( Shift+A, Edit Mode's X / M / right-click menus ), where it asks.
**/
function ViewMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; title: string; items: MenuItem[] } | null>( null );
  useEffect( () => {
    const show = ( e: Event ) => setMenu( ( e as CustomEvent ).detail );
    window.addEventListener( "viewport-menu", show );
    return () => window.removeEventListener( "viewport-menu", show );
  }, [] );
  return menu ? <PopupMenu anchor={new DOMRect( menu.x, menu.y, 0, 0 )} title={menu.title} items={menu.items} onClose={() => setMenu( null )} /> : null;
}

/**
 * Texture Paint's brush: a circle over the piece, its size on the piece under it.
**/
function MeshBrush() {
  const on  = useEditor( ( s ) => s.tool === "material" && s.materialMode === "paint" );
  const ref = useRef<HTMLDivElement>( null );
  useEffect( () => {
    if ( !on ) return;
    const move = ( e: PointerEvent ) => {
      const el = ref.current, eng = getEngine();
      if ( !el || !eng ) return;
      const r          = eng.renderer.domElement.getBoundingClientRect();
      const x          = e.clientX - r.left, y = e.clientY - r.top;
      const px         = x >= 0 && y >= 0 && x <= r.width && y <= r.height ? eng.meshBrushPx( x, y ) : null;
      el.style.display = px ? "block" : "none";
      if ( px ) {
        el.style.width     = el.style.height = `${px * 2}px`;
        el.style.transform = `translate(${x - px}px, ${y - px}px)`;
      }
    };
    window.addEventListener( "pointermove", move );
    return () => window.removeEventListener( "pointermove", move );
  }, [on] );
  return on ? <div ref={ref} className="mesh-brush" style={{ display: "none" }} /> : null;
}

/**
 * Edit Mode's box select, as it's dragged.
**/
function BoxSelect() {
  const [r, setR] = useState<[number, number, number, number] | null>( null );
  useEffect( () => {
    const show = ( e: Event ) => setR( ( e as CustomEvent ).detail );
    window.addEventListener( "model-box", show );
    return () => window.removeEventListener( "model-box", show );
  }, [] );
  return r ? <div className="box-select" style={{ left: r[0], top: r[1], width: r[2] - r[0], height: r[3] - r[1] }} /> : null;
}

/**
 * Texture Paint's stencil over the view: see-through while painting; moved, scaled ( corners ) and turned ( knob ) while
 * being placed.
**/
function StencilOverlay() {
  const s    = useStencil();
  const tool = useEditor( ( x ) => x.tool ), mode = useEditor( ( x ) => x.materialMode );
  if ( !s.img || tool !== "material" || mode !== "paint" ) return null;
  const w    = s.img.w * s.scale, h = s.img.h * s.scale;
  const drag = ( kind: "move" | "scale" | "turn" ) => ( e: React.PointerEvent ) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture( e.pointerId );
    const host = el.closest( ".viewport" )!.getBoundingClientRect();
    const st0  = useStencil.getState(), x0 = e.clientX, y0 = e.clientY;
    const at   = ( ev: PointerEvent ) => [ev.clientX - host.left - st0.x, ev.clientY - host.top - st0.y];
    const r0   = Math.hypot( x0 - host.left - st0.x, y0 - host.top - st0.y );
    const move = ( ev: PointerEvent ) => {
      if ( kind === "move" ) useStencil.setState( { x: st0.x + ev.clientX - x0, y: st0.y + ev.clientY - y0 } );
      else if ( kind === "scale" ) useStencil.setState( { scale: Math.max( 0.01, ( st0.scale * Math.hypot( ...( at( ev ) as [number, number] ) ) ) / Math.max( 1, r0 ) ) } );
      else {
        const [dx, dy] = at( ev );
        let a          = Math.atan2( dx, -dy );
        // Ctrl: in steps of 15°
        if ( ev.ctrlKey ) a = Math.round( a / ( Math.PI / 12 ) ) * ( Math.PI / 12 );
        useStencil.setState( { angle: a } );
      }
    };
    const up = () => {
      el.removeEventListener( "pointermove", move );
      el.removeEventListener( "pointerup",   up   );
    };
    el.addEventListener( "pointermove", move );
    el.addEventListener( "pointerup",   up   );
  };
  return (
    <div
      className={`stencil${s.adjust ? " adjust" : ""}`}
      style={{ left: s.x, top: s.y, width: w, height: h, transform: `translate(-50%, -50%) rotate(${s.angle}rad)` }}
      onPointerDown={s.adjust ? drag( "move" ) : undefined}
      onWheel={s.adjust ? ( e ) => useStencil.setState( { scale: Math.max( 0.01, s.scale * ( e.deltaY < 0 ? 1.1 : 1 / 1.1 ) ) } ) : undefined}
    >
      <img src={s.img.url} style={{ opacity: s.opacity }} draggable={false} />
      { s.adjust && (
        <>
          {["nw", "ne", "sw", "se"].map( ( c ) => <i key={c} className={`corner ${c}`} onPointerDown={drag( "scale" )} /> )}
          <i className="knob" onPointerDown={drag( "turn" )} />
        </>
      ) }
    </div>
  );
}

/**
 * The Decal tool's image under the mouse, as big as it'll be stamped on the piece there ( nothing off the piece ).
**/
function DecalCursor() {
  const d           = useDecal();
  const on          = useEditor( ( x ) => x.tool === "material" && x.materialMode === "paint" && x.paint.texTool === "decal" );
  const [at, setAt] = useState<StencilState | null>( null );
  useEffect( () => {
    if ( !on || !d.img ) return setAt( null );
    const canvas = current?.renderer.domElement;
    if ( !canvas ) return;
    const move = ( e: PointerEvent ) => {
      const r = canvas.getBoundingClientRect();
      setAt( current?.meshPainter.decalAt( e.clientX - r.left, e.clientY - r.top ) ?? null );
    };
    const leave = () => setAt( null );
    canvas.addEventListener( "pointermove",  move  );
    canvas.addEventListener( "pointerleave", leave );
    return () => {
      canvas.removeEventListener( "pointermove",  move  );
      canvas.removeEventListener( "pointerleave", leave );
    };
  }, [on, d.img, d.size, d.angle] );
  if ( !at?.img ) return null;
  const w = at.img.w * at.scale, h = at.img.h * at.scale;
  return (
    <div className="decal-cursor" style={{ left: at.x, top: at.y, width: w, height: h, transform: `translate(-50%, -50%) rotate(${at.angle}rad)` }}>
      <img src={at.img.url} draggable={false} />
    </div>
  );
}

/**
 * Texture Paint's gradient line, as it's dragged.
**/
function GradientLine() {
  const [l, setL] = useState<[number, number, number, number] | null>( null );
  useEffect( () => {
    const show = ( e: Event ) => setL( ( e as CustomEvent ).detail );
    window.addEventListener( "gradient-line", show );
    return () => window.removeEventListener( "gradient-line", show );
  }, [] );
  return l ? (
    <svg className="gradient-line">
      <line x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} />
      <circle cx={l[0]} cy={l[1]} r={4} />
      <circle cx={l[2]} cy={l[3]} r={4} />
    </svg>
  ) : null;
}

export function Viewport( { onStats, hidden }: { onStats: ( s: Parameters<NonNullable<Engine["onStats"]>>[0] ) => void; hidden?: boolean } ) {
  const host            = useRef<HTMLDivElement>( null );
  const tool            = useEditor( ( s ) => s.tool       );
  const cameraMode      = useEditor( ( s ) => s.cameraMode );
  const selection       = useEditor( ( s ) => s.selection  );
  const spawns          = useEditor( ( s ) => s.spawns     );
  const [ride, setRide] = useState<{ maxAirtime: number; endSpeed: number } | null>( null );
  const sculpt          = useEditor( ( s ) => s.sculpt );
  const label           = useRef<HTMLDivElement>( null );

  useEffect( () => {
    const e   = new Engine( host.current! );
    current   = e;
    e.onStats = onStats;
    e.loadTerrain();
    return () => {
      e.dispose();
      current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [] );

  useEffect( () => {
    current?.setPaused( "game tab", !!hidden );
  }, [hidden] );

  useEffect( () => {
    const t = setTimeout( () => setRide( current?.rideInfo() ?? null ), 50 );
    return () => clearTimeout( t );
  }, [selection, spawns] );

  const selectedSpawn = selection.find( ( s ) => s.kind === "spawn" );

  return (
    <div
      // ( asset cards are dragged in with pointer events and toggle "drop-target" themselves, see AssetBrowser )
      className="viewport"
      ref={host}
      style={{ visibility: hidden ? "hidden" : "visible" }}
      // never start a native drag from the 3D view: it shows a "not allowed" cursor and steals the gizmo drag
      onDragStart={( e ) => e.preventDefault()}
      // the brush size readout follows the cursor ( moved directly, no re-render per mouse move )
      onPointerMove={( e ) => {
        const el = label.current;
        if ( !el || !host.current ) return;
        const r            = host.current.getBoundingClientRect();
        el.style.transform = `translate(${e.clientX - r.left + 18}px, ${e.clientY - r.top + 14}px)`;
        el.style.opacity   = getEngine()?.cursorOnTerrain() ? "1" : "0";
      }}
      onPointerLeave={() => label.current && ( label.current.style.opacity = "0" )}
    >
      { tool === "sculpt" && cameraMode !== "rider" && (
        <div ref={label} className="brush-label" style={{ opacity: 0 }}>
          {sculpt.radius < 10 ? sculpt.radius.toFixed( 1 ) : Math.round( sculpt.radius )} m
          <span> · {Math.round( sculpt.brushes[sculpt.brush].strength * 100 )}%</span>
        </div>
      ) }
      <ToolColumn />
      <ViewMenu />
      <MeshBrush />
      <BoxSelect />
      <GradientLine />
      <StencilOverlay />
      <DecalCursor />
      <TextureView />
      <ViewOverlays />
      <ViewInfo />
      <LoadingVeil />
      { selectedSpawn && ride && (
        <div className="overlay ride">
          Ride preview · longest air {ride.maxAirtime.toFixed( 1 )} s · speed after 8 s {( ride.endSpeed * 3.6 ).toFixed( 0 )} km/h
        </div>
      ) }
    </div>
  );
}

/**
 * Over the view while a map's pieces load ( Engine.loading ): it can't be used meanwhile, and it stutters.
**/
function LoadingVeil() {
  // ( up from the first paint when a map is opening: the view isn't made yet )
  const [l, setL] = useState<{ done: number; total: number } | null>( () => ( useEditor.getState().projectDir ? { done: 0, total: 0 } : null ) );
  useEffect( () => {
    const t = setInterval( () => {
      const v = current?.veil.loading ?? null;
      setL( ( cur ) => ( cur?.done === v?.done && cur?.total === v?.total ? cur : v && { ...v } ) );
    }, 120 );
    return () => clearInterval( t );
  }, [] );
  if ( !l ) return null;
  return (
    <div className="vp-loading">
      <div className="box">
        <div className="spinner" />
        Loading
        { l.total > 0 && (
          <>
            <div className="count">
              {l.done} / {l.total}
            </div>
            <div className="bar">
              <i style={{ width: `${( 100 * l.done ) / l.total}%` }} />
            </div>
          </>
        ) }
      </div>
    </div>
  );
}

/**
 * Blender's text in the corner of the 3D view: what the camera is doing, then the map and what's selected.
**/
function ViewInfo() {
  // ( the Assets workspace has its own: ui/blender/ViewOverlays.tsx )
  const assets     = useEditor( ( s ) => workspaceOf( s.tool ) === "assets" );
  const cameraMode = useEditor( ( s ) => s.cameraMode                       );
  const map        = useEditor( ( s ) => s.map?.name ?? ""                  );
  const selection  = useEditor( ( s ) => s.selection                        );
  const objects    = useEditor( ( s ) => s.objects                          );
  const spawns     = useEditor( ( s ) => s.spawns                           );
  const custom     = useEditor( ( s ) => s.customObjects                    );
  const shapes     = useEditor( ( s ) => s.shapes                           );
  const last       = selection[selection.length - 1];
  const name       = !last
    ? null
    : last.kind === "object"
      ? objects.find( ( o ) => o.uid === last.uid )?.id
      : last.kind === "spawn"
        ? spawns.find( ( o ) => o.uid === last.uid )?.name
        : last.kind === "shape"
          ? shapes.find( ( o ) => o.uid === last.uid )?.name
          : ( () => {
              const o = custom.find( ( x ) => x.uid === last.uid );
              return o ? useEditor.getState().labels[o.uid] || customName( o ) : null;
            } )();
  if ( assets ) return null;
  return (
    <div className="vp-info">
      <div>{cameraMode === "rider" ? "Rider View · 1.75 m" : "User Perspective"}</div>
      <div className="dim">
        <RichText text={map} />
        {name ? ` | ${name}` : ""}
        {selection.length > 1 ? ` (+${selection.length - 1})` : ""}
      </div>
    </div>
  );
}
