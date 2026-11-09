import { toThree, type V3 } from "../../core/coords";
import { joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { edgesOf, faceCenter, type Mesh, type PrimitiveId } from "../../model/mesh";
import { selFromEdges, selFromFaces, selFromVerts } from "../../model/ops";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";
import cases from "../../../tests/model/blender/cases.json";
import reference from "../../../tests/model/blender/reference.json";

type Where = [string, ">" | "<", number][];
type Step  = { sel?: Kind; add?: Kind; where?: Where; op?: string; pivot?: string; prop?: number; cursor?: V3; active?: Kind; [k: string]: unknown };
type Kind  = "verts" | "edges" | "faces";
type Case  = { name: string; prim: PrimitiveId; steps: Step[]; app?: boolean };

const THREE_DEG = ( r: number ) => ( r * 180 ) / Math.PI;

const LABEL: Partial<Record<PrimitiveId, string>> = { cube: "Cube", grid: "Grid", plane: "Plane", cylinder: "Cylinder" };

/**
 * Focused run ( STUDIO_SELFTEST=<...>/blendertransform ): Edit Mode's G / R / S done as a person does them ( the axis
 * and the number typed, Blender's letters ) about each pivot ( median, bounding box, 3D cursor, individual origins,
 * active element ) and with proportional editing, each against what Blender itself made of it ( tests/model/blender,
 * the cases marked "app" ).
**/
export async function blenderTransformSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const P = await import( "../../map/project" );
    await P.newEmptyProject( joinPath( dir, `xform-${Date.now()}.jbrproj` ), "Blender Transform" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 1000 );
    const st = () => useEditor.getState();
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Assets" )?.click();
    await sleep( 1200 );
    const io    = realInput( eng, () => "xform" );
    const frame = () => new Promise<void>( ( r ) => requestAnimationFrame( () => r() ) );
    const key   = async ( k: string, m: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {} ) => {
      const init = { key: k, code: k.length === 1 ? ( /[0-9]/.test( k ) ? `Digit${k}` : `Key${k.toUpperCase()}` ) : k, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, bubbles: true, cancelable: true };
      window.dispatchEvent( new KeyboardEvent( "keydown", init ) );
      window.dispatchEvent( new KeyboardEvent( "keyup", init ) );
      await frame();
      await sleep( 50 );
    };
    const type = async ( s: string ) => { for ( const ch of s ) await key( ch ); };
    const menu = async ( label: string ) => {
      await sleep( 200 );
      const it = [...document.querySelectorAll<HTMLElement>( ".bmenu .bmenu-item" )].find( ( x ) => x.textContent?.trim().startsWith( label ) );
      it?.click();
      await sleep( 300 );
      return !!it;
    };
    await io.glide( io.rc.width / 2, io.rc.height / 2, 200 );
    const holds = ( p: V3, where: Where ) => where.every( ( [a, op, v] ) => ( op === ">" ? p["xyz".indexOf( a )] > v : p["xyz".indexOf( a )] < v ) );
    const mid   = ( g: Mesh, k: string ) => {
      const [a, b] = k.split( "_" ).map( Number );
      return g.v[a].map( ( x, i ) => ( x + g.v[b][i] ) / 2 ) as V3;
    };
    // ( how far Blender's points are from the studio's, and the other way )
    const off = ( a: V3[], b: V3[] ) => Math.max( 0, ...a.map( ( p ) => Math.min( ...b.map( ( q ) => Math.hypot( p[0] - q[0], p[1] - q[1], p[2] - q[2] ) ) ) ) );
    const REF = ( reference as unknown as { cases: Record<string, { v: V3[] }> } ).cases;

    for ( const c of ( cases as unknown as { cases: Case[] } ).cases.filter( ( x ) => x.app ) ) {
      // a fresh primitive at the origin, nothing else about
      if ( eng.editing ) await key( "Tab" );
      useEditor.setState( ( s ) => ( { cursor3d: [0, 0, 0], modelTools: { ...s.modelTools, pivot: "median", proportional: false } } ) );
      if ( st().customObjects.length ) {
        st().setSelection( st().customObjects.map( ( o ) => ( { kind: "custom" as const, uid: o.uid } ) ) );
        await key( "Delete" );
      }
      await key( "A", { shift: true } );
      await menu( LABEL[c.prim] ?? "Cube" );
      await sleep( 300 );
      const uid = st().selection[0]?.uid;
      await key( "Tab" );
      const ed = eng.modelEd, g = () => st().customObjects.find( ( o ) => o.uid === uid )!.model!.mesh;
      let kind: Kind = "verts";
      for ( const s of c.steps ) {
        if ( s.pivot ) useEditor.setState( ( x ) => ( { modelTools: { ...x.modelTools, pivot: s.pivot as "median" } } ) );
        else if ( s.prop ) useEditor.setState( ( x ) => ( { modelTools: { ...x.modelTools, proportional: true, propRadius: s.prop! } } ) );
        else if ( s.cursor ) useEditor.setState( { cursor3d: s.cursor } );
        else if ( s.sel || s.add ) {
          // ( what's selected set as the case says: selecting itself is blenderselect's )
          kind       = ( s.sel ?? s.add )!;
          const m    = g(), where = s.where!;
          const pick = kind === "verts" ? m.v.flatMap( ( p, i ) => ( holds( p, where ) ? [i] : [] ) ) : kind === "edges" ? [...edgesOf( m ).keys()].filter( ( k ) => holds( mid( m, k ), where ) ) : m.f.flatMap( ( _, i ) => ( holds( faceCenter( m, i ), where ) ? [i] : [] ) );
          const was  = s.add ? ( kind === "verts" ? [...ed.sel.v] : kind === "edges" ? [...ed.sel.e] : [...ed.sel.f] ) : [];
          ed.mode    = kind === "verts" ? "vert" : kind === "edges" ? "edge" : "face";
          ed.sel     = kind === "verts" ? selFromVerts( m, [...( was as number[] ), ...( pick as number[] )] ) : kind === "edges" ? selFromEdges( m, [...( was as string[] ), ...( pick as string[] )] ) : selFromFaces( m, [...( was as number[] ), ...( pick as number[] )] );
          ed.sync();
          ed.publish();
        } else if ( s.active ) {
          ed.active = g().v.findIndex( ( p ) => holds( p, s.where! ) );
        } else if ( s.op === "rotate" ) {
          await key( "r" ); await key( s.axis as string ); await type( String( s.deg ) ); await key( "Enter" );
        } else if ( s.op === "scale" ) {
          await key( "s" ); if ( s.axis ) await key( s.axis as string ); await type( String( s.by ) ); await key( "Enter" );
        } else if ( s.op === "grab" ) {
          await key( "g" ); await key( s.axis as string ); await type( String( s.by ) ); await key( "Enter" );
        }
        await sleep( 60 );
      }
      const ref = REF[c.name], m = g();
      const far = off( ref.v, m.v ), extra = off( m.v, ref.v );
      check( m.v.length === ref.v.length && far < 1e-3 && extra < 1e-3, `${c.name}: ${m.v.length} vertices ( Blender ${ref.v.length} ), points off by ${far.toFixed( 4 )} / ${extra.toFixed( 4 )} m` );
    }
    if ( eng.editing ) await key( "Tab" );

    // ---------------------------------------------------------------- what isn't numbers: keys, snapping, the cursor
    useEditor.setState( ( s ) => ( { cursor3d: [0, 0, 0], modelTools: { ...s.modelTools, pivot: "median", proportional: false, snap: false, snapTo: "increment" } } ) );
    st().setSelection( st().customObjects.map( ( o ) => ( { kind: "custom" as const, uid: o.uid } ) ) );
    await key( "Delete" );
    await key( "A", { shift: true } );
    await menu( "Cube" );
    await sleep( 300 );
    const uid  = st().selection[0]?.uid;
    const cube = () => st().customObjects.find( ( o ) => o.uid === uid )!;
    eng.nav.lookAtUnity( [3.2, 3.4, -4.2], [0, 0, 0] );
    await sleep( 600 );
    // G X X: Blender's second press, the piece's own X ( turned a quarter about up: Blender's Y, the game's Z )
    await key( "r" ); await key( "z" ); await type( "90" ); await key( "Enter" );
    await key( "g" ); await key( "x" ); await key( "x" ); await type( "2" ); await key( "Enter" );
    const p = cube().position;
    check( Math.abs( p.x ) < 1e-4 && Math.abs( p.z - 2 ) < 1e-4, `G X X 2 on a piece turned 90° about up: along its own X ( ${p.x.toFixed( 3 )}, ${p.y.toFixed( 3 )}, ${p.z.toFixed( 3 )} ); Blender: ( 0, 0, 2 )` );
    await key( "g" ); await key( "x" ); await key( "x" ); await key( "x" ); await io.glide( io.rc.width / 2 + 80, io.rc.height / 2, 200 ); await key( "Escape" );
    check( Math.abs( cube().position.z - 2 ) < 1e-6, "G X X X: free again ( Esc put it back )" );
    await key( "g", { alt: true } ); await key( "r", { alt: true } );
    // Edit Mode: Ctrl during R, 5° steps; Ctrl during G, the grid's
    await key( "Tab" );
    await key( "3" ); await key( "a", { alt: true } );
    const g   = () => cube().model!.mesh;
    // ( a click with Ctrl held through it, where the mouse is )
    const ctrlClick = async () => { await io.press( 0, { ctrlKey: true } ); await sleep( 60 ); await io.release( 0, { ctrlKey: true } ); };
    const scr = ( q: V3 ) => eng.screenOf( toThree( q ) ).slice( 0, 2 ) as [number, number];
    await io.click( ...scr( [0, 1, 0] ) ); await sleep( 150 );
    const c0 = scr( [0, 1, 0] );
    await io.glide( c0[0] + 120, c0[1], 150 );
    await key( "r" ); await key( "z" );
    await io.glide( c0[0] + 60, c0[1] - 104, 300, { ctrlKey: true } );
    await ctrlClick();
    const corner = g().v.find( ( q ) => q[1] > 0.99 && q[0] > 0 && q[2] > 0 ) ?? g().v.find( ( q ) => q[1] > 0.99 )!;
    const ang    = ( ( THREE_DEG( Math.atan2( corner[2], corner[0] ) ) - 45 ) % 90 + 90 ) % 90;
    check( Math.abs( ang % 5 ) < 1e-3 || Math.abs( ( ang % 5 ) - 5 ) < 1e-3, `R Z with Ctrl: turned in 5° steps ( ${ang.toFixed( 3 )}° past a quarter )` );
    await key( "z", { ctrl: true } );
    const before = g().v.map( ( q ) => [...q] );
    await key( "g" );
    await io.glide( c0[0] + 47, c0[1] + 23, 250, { ctrlKey: true } );
    await ctrlClick();
    // ( each corner's move, every part of it whole tenths at least: the grid's step here )
    const moved = g().v.flatMap( ( q, i ) => q.map( ( x, k ) => x - before[i][k] ) );
    const on    = moved.every( ( d ) => Math.abs( d * 10 - Math.round( d * 10 ) ) < 1e-6 );
    check( on && moved.some( ( d ) => Math.abs( d ) > 1e-6 ), `G with Ctrl: moved by whole grid steps ( ${moved.filter( ( d ) => Math.abs( d ) > 1e-6 ).slice( 0, 3 ).map( ( d ) => d.toFixed( 4 ) ).join( ", " )} )` );
    await key( "z", { ctrl: true } );
    // snapping to a vertex: the selected vertex nearest it lands on it ( Blender's "Closest" )
    useEditor.setState( ( s ) => ( { modelTools: { ...s.modelTools, snapTo: "vertex" } } ) );
    await key( "1" ); await key( "a", { alt: true } );
    await io.click( ...scr( [1, 1, -1] ) ); await sleep( 120 );
    const target = scr( [-1, 1, -1] );
    await key( "g" );
    await io.glide( target[0] + 2, target[1] + 1, 300, { ctrlKey: true } );
    await ctrlClick();
    const landed = g().v.filter( ( q ) => Math.abs( q[0] + 1 ) < 1e-6 && Math.abs( q[1] - 1 ) < 1e-6 && Math.abs( q[2] + 1 ) < 1e-6 ).length;
    check( landed === 2, `G with Ctrl, snapping to vertices: it landed on the other corner ( ${landed} there now )` );
    await key( "z", { ctrl: true } );
    useEditor.setState( ( s ) => ( { modelTools: { ...s.modelTools, snapTo: "increment" } } ) );
    // Shift+S: Cursor to Selected; Selection to Cursor
    await key( "3" ); await key( "a", { alt: true } );
    await io.click( ...scr( [0, 1, 0] ) ); await sleep( 120 );
    await key( "S", { shift: true } );
    await menu( "Cursor to Selected" );
    const cur = st().cursor3d;
    check( Math.abs( cur[0] ) < 1e-6 && Math.abs( cur[1] - 1 ) < 1e-6 && Math.abs( cur[2] ) < 1e-6, `Shift+S › Cursor to Selected: the cursor at the top's middle ( ${cur.map( ( x ) => x.toFixed( 3 ) ).join( ", " )} )` );
    useEditor.setState( { cursor3d: [0, 3, 0] } );
    await key( "S", { shift: true } );
    await menu( "Selection to Cursor" );
    check( g().v.filter( ( q ) => q[1] > 0.5 ).every( ( q ) => Math.abs( q[1] - 3 ) < 1e-6 ), "Shift+S › Selection to Cursor: the top's middle at the cursor ( 3 up )" );
    await key( "z", { ctrl: true } );
    // Shift+right-click: the 3D cursor on what's clicked
    const sv = scr( [0.3, 1, -0.4] );
    await io.glide( ...sv, 200 );
    await io.press( 2, { shiftKey: true } ); await io.release( 2, { shiftKey: true } );
    await sleep( 150 );
    const c2 = st().cursor3d;
    check( Math.abs( c2[1] - 1 ) < 0.02 && Math.abs( c2[0] - 0.3 ) < 0.05 && Math.abs( c2[2] + 0.4 ) < 0.05, `Shift+right-click on the top: the cursor there ( ${c2.map( ( x ) => x.toFixed( 3 ) ).join( ", " )} )` );
    // O: proportional on; the wheel during G its size
    const wasProp = st().modelTools.proportional;
    await key( "o" );
    const r0 = st().modelTools.propRadius;
    await key( "g" );
    await io.wheel( -100, 3 );
    const r1 = st().modelTools.propRadius;
    await key( "Escape" );
    await key( "o" );
    check( !wasProp && r1 > r0 && !st().modelTools.proportional, `O: proportional on; the wheel during G made it ${r0.toFixed( 2 )} → ${r1.toFixed( 2 )} m; O again: off` );
    // G G: edge slide; a typed half
    await key( "Tab" );
    await key( "Tab" );
    await key( "a" );
    const ring = g().v.length;
    await io.glide( ...scr( [1, 0, -1] ), 200 );
    await key( "r", { ctrl: true } );
    await io.glide( scr( [1, 0, -1] )[0] + 2, scr( [1, 0, -1] )[1], 120 );
    await io.click( scr( [1, 0, -1] )[0] + 2, scr( [1, 0, -1] )[1], 30 );
    await io.press( 2 ); await io.release( 2 );
    await sleep( 200 );
    const cut = g().v.filter( ( q ) => Math.abs( q[1] ) < 1e-6 );
    await key( "g" ); await key( "g" ); await io.glide( io.rc.width / 2 + 40, io.rc.height / 2 - 60, 200 ); await type( "0.5" ); await key( "Enter" );
    const slid = g().v.filter( ( q ) => Math.abs( Math.abs( q[1] ) - 0.5 ) < 1e-6 ).length;
    check( g().v.length === ring + 4 && cut.length === 4 && slid === 4, `Ctrl+R then G G 0.5: the new loop slid halfway to its neighbour ( ${slid} of its 4 corners at a half )` );
    await key( "Tab" );
    io.stop();
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
