// The 3D view's overlays, as Blender's: the navigation gizmo ( top right, in Design and Assets: the axes to click or
// drag, zoom and pan to drag ), and in Assets the 3D cursor and the text at the top left ( the view, the active
// object, statistics ).

import { useEffect, useRef, useState } from "react";
import { toThree } from "../../core/coords";
import { customName } from "../../core/types";
import { useAssetFile } from "../../pieces/assetFiles";
import { useEditor } from "../../map/store";
import { evaluate } from "../../model/build";
import { getEngine } from "../Viewport";
import { BlIcon } from "./BlIcon";
import { BL_AXES } from "../../core/blenderAxes";

// Blender's axes ( core/blenderAxes.ts ) and colours: X red, Y green ( into the scene ), Z blue ( up )
const AXES = [
  { label: "X", dir: BL_AXES[0], col: "#ff3352", dim: "#7c2433", view: "Right" },
  { label: "Y", dir: BL_AXES[1], col: "#8bdc00", dim: "#4b7212", view: "Back"  },
  { label: "Z", dir: BL_AXES[2], col: "#2890ff", dim: "#24508a", view: "Top"   },
];
const R = 36, BALL = 9, PAD = BALL + 3, SIDE = 2 * ( R + PAD );

/**
 * Blender's navigation gizmo: each axis a ball ( its far end a dim one ), drawn over each other by depth. A click on
 * a ball looks along it, a drag turns the view; zoom and pan below it.
**/
function NavGizmo() {
  const [, tick]      = useState( 0 );
  const [hot, setHot] = useState<string | null>( null );
  const drag          = useRef<{ kind: "orbit" | "zoom" | "pan"; x: number; y: number; moved: boolean } | null>( null );
  useEffect( () => {
    let raf    = 0, last = "";
    const loop = () => {
      const q   = getEngine()?.camera.quaternion;
      const key = q ? `${q.x.toFixed( 4 )},${q.y.toFixed( 4 )},${q.z.toFixed( 4 )},${q.w.toFixed( 4 )}` : "";
      if ( key !== last ) { last = key; tick( ( n ) => n + 1 ); }
      raf = requestAnimationFrame( loop );
    };
    raf = requestAnimationFrame( loop );
    return () => cancelAnimationFrame( raf );
  }, [] );
  const eng = getEngine();
  if ( !eng ) return null;
  const inv   = eng.camera.quaternion.clone().invert();
  const c     = R + PAD;
  const balls = AXES.flatMap( ( a ) =>
    [1, -1].map( ( s ) => {
      const v = a.dir.clone().multiplyScalar( s ).applyQuaternion( inv );
      return { a, s, key: `${s > 0 ? "" : "-"}${a.label}`, x: c + v.x * R, y: c - v.y * R, z: v.z };
    } ),
  ).sort( ( p, q ) => p.z - q.z );
  /**
   * the ball under a point of the gizmo ( the nearest one in front, within its size )
  **/
  const ballAt = ( x: number, y: number ) => {
    let best: ( typeof balls )[number] | null = null;
    for ( const b of balls ) if ( Math.hypot( b.x - x, b.y - y ) <= BALL + 1 ) best = b;
    return best;
  };
  const local = ( e: React.PointerEvent ) => {
    const r = ( e.currentTarget as Element ).getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = ( kind: "orbit" | "zoom" | "pan" ) => ( e: React.PointerEvent ) => {
    if ( e.button !== 0 ) return;
    e.preventDefault();
    drag.current = { kind, x: e.clientX, y: e.clientY, moved: false };
    try {
      ( e.currentTarget as Element ).setPointerCapture( e.pointerId );
    } catch {
      // ( a pointer that's gone: the drag works without )
    }
  };
  const move = ( e: React.PointerEvent ) => {
    const d = drag.current, en = getEngine();
    if ( !d ) {
      if ( e.currentTarget instanceof SVGSVGElement ) setHot( ballAt( ...local( e ) )?.key ?? null );
      return;
    }
    if ( !en ) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if ( !d.moved && Math.abs( dx ) + Math.abs( dy ) < 3 ) return;
    d.moved = true;
    if ( d.kind === "orbit" ) en.nav.orbitBy( dx, dy );
    else if ( d.kind === "zoom" ) en.nav.zoomBy( dy );
    else en.nav.panBy( dx, dy );
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const up = ( e: React.PointerEvent ) => {
    const d      = drag.current;
    drag.current = null;
    // a click on a ball: looking along its axis ( from its side )
    if ( d && !d.moved && d.kind === "orbit" ) {
      const b = ballAt( ...local( e ) );
      if ( b ) getEngine()?.nav.viewFrom( b.a.dir.clone().multiplyScalar( b.s ) );
    }
  };
  return (
    <div className="nav-gizmo">
      <svg width={SIDE} height={SIDE} onPointerDown={down( "orbit" )} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHot( null )} className="nav-ball">
        <circle cx={c} cy={c} r={R + BALL + 1} className="nav-bg" />
        {balls.map( ( b ) => b.s > 0 && <line key={`l${b.a.label}`} x1={c} y1={c} x2={b.x} y2={b.y} stroke={b.a.col} strokeWidth={2} /> )}
        { balls.map( ( b ) => {
          const lit = hot === b.key;
          return (
            <g key={b.key} className="nav-axis">
              <title>{b.s > 0 ? b.a.view : ""}</title>
              <circle cx={b.x} cy={b.y} r={BALL} fill={b.s > 0 ? b.a.col : b.a.dim} stroke={lit ? "#fff" : b.s > 0 ? "none" : b.a.col} strokeWidth={lit ? 1.5 : 1} />
              {( b.s > 0 || lit ) && <text x={b.x} y={b.y + 3.6} textAnchor="middle" className={b.s > 0 ? "" : "neg"}>{b.s > 0 ? b.a.label : `-${b.a.label}`}</text>}
            </g>
          );
        } ) }
      </svg>
      <button className="nav-btn" title="Zoom" onPointerDown={down( "zoom" )} onPointerMove={move} onPointerUp={up}><BlIcon name="view_zoom" /></button>
      <button className="nav-btn" title="Move the View" onPointerDown={down( "pan" )} onPointerMove={move} onPointerUp={up}><BlIcon name="view_pan" /></button>
    </div>
  );
}

/**
 * While turning or scaling: Blender's dashed line from the pivot to the mouse.
**/
function TransformLine() {
  const ref = useRef<SVGLineElement>( null );
  useEffect( () => {
    let raf    = 0;
    const loop = () => {
      // ( a turn or scale under way, or a piece from the asset browser being aimed )
      const eng  = getEngine(), g = eng?.blGizmo?.info;
      const info = g?.line ? g : eng?.placing.aimLine;
      const el   = ref.current;
      if ( el ) {
        el.style.display = info ? "" : "none";
        if ( info ) {
          el.setAttribute( "x1", `${info.from[0]}` );
          el.setAttribute( "y1", `${info.from[1]}` );
          el.setAttribute( "x2", `${info.to[0]}`   );
          el.setAttribute( "y2", `${info.to[1]}`   );
        }
      }
      raf = requestAnimationFrame( loop );
    };
    raf = requestAnimationFrame( loop );
    return () => cancelAnimationFrame( raf );
  }, [] );
  return (
    <svg className="transform-line">
      <line ref={ref} stroke="#fff" strokeWidth={1} strokeDasharray="4 4" style={{ display: "none" }} />
    </svg>
  );
}

/**
 * What a transform's doing, for the header ( Blender writes it there in place of the menus ): the gizmo's, or Edit
 * Mode's operator's.
**/
export function useTransformReadout() {
  const edit            = useEditor( ( s ) => s.modelEdit?.status ?? "" );
  const [text, setText] = useState<string | null>( null );
  useEffect( () => {
    let raf    = 0;
    const loop = () => {
      const t = getEngine()?.blGizmo?.info?.text ?? null;
      setText( ( cur ) => ( cur === t ? cur : t ) );
      raf = requestAnimationFrame( loop );
    };
    raf = requestAnimationFrame( loop );
    return () => cancelAnimationFrame( raf );
  }, [] );
  return text ?? ( edit || null );
}

/**
 * Blender's 3D cursor: a red and white ring with a cross, where things are added.
**/
function Cursor3D() {
  const ref = useRef<HTMLDivElement>( null );
  useEffect( () => {
    let raf    = 0;
    const loop = () => {
      const el = ref.current, eng = getEngine();
      if ( el && eng ) {
        const [x, y, front] = eng.screenOf( toThree( useEditor.getState().cursor3d ) );
        el.style.display    = front ? "block" : "none";
        el.style.transform  = `translate(${x - 11}px, ${y - 11}px)`;
      }
      raf = requestAnimationFrame( loop );
    };
    raf = requestAnimationFrame( loop );
    return () => cancelAnimationFrame( raf );
  }, [] );
  return (
    <div ref={ref} className="cursor3d">
      <svg width={22} height={22}>
        <circle cx={11} cy={11} r={8} fill="none" stroke="#fff" strokeWidth={1.6} />
        <circle cx={11} cy={11} r={8} fill="none" stroke="#e8232d" strokeWidth={1.6} strokeDasharray="3.1 3.1" />
        <path d="M11 0v6M11 16v6M0 11h6M16 11h6" stroke="#111" strokeWidth={1} />
      </svg>
    </div>
  );
}

/**
 * The text at the top left: the view, the active object, and ( when on ) what's in the scene.
**/
function ViewText() {
  const objects   = useEditor( ( s ) => s.customObjects         );
  const selection = useEditor( ( s ) => s.selection             );
  const labels    = useEditor( ( s ) => s.labels                );
  const stats     = useEditor( ( s ) => s.view3d.overlays.stats );
  const asset     = useAssetFile( ( s ) => s.ref?.name ?? "New Asset" );
  const active    = objects.find( ( o ) => o.uid === selection[selection.length - 1]?.uid );
  let verts       = 0, faces = 0, tris = 0;
  if ( stats )
    for ( const o of objects ) {
      if ( !o.model ) continue;
      const g = evaluate( o.model );
      verts  += g.v.length;
      faces  += g.f.length;
      for ( const f of g.f ) tris += f.length - 2;
    }
  return (
    <div className="view-text">
      <div>User Perspective</div>
      <div>({asset}){active ? ` | ${labels[active.uid] || customName( active )}` : ""}</div>
      { stats && (
        <div className="stats">
          <div>Objects <b>{selection.length}/{objects.length}</b></div>
          <div>Vertices <b>{verts.toLocaleString()}</b></div>
          <div>Faces <b>{faces.toLocaleString()}</b></div>
          <div>Triangles <b>{tris.toLocaleString()}</b></div>
        </div>
      ) }
    </div>
  );
}

export function ViewOverlays() {
  const assets = useEditor( ( s ) => s.tool       === "model" || s.tool === "material" );
  // ( the navigator in Design too; not while riding )
  const riding = useEditor( ( s ) => s.cameraMode === "rider" );
  if ( riding ) return null;
  return (
    <>
      <NavGizmo />
      <TransformLine />
      {assets && <Cursor3D />}
      {assets && <ViewText />}
    </>
  );
}
