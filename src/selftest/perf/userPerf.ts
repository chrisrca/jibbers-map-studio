import * as THREE from "three/webgpu";
import { feature, log, realInput, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { newUid, useEditor } from "../../map/store";
import { toUnity } from "../../core/coords";

// a 240 Hz display's frame, and the most a frame may take
const VSYNC  = 1000 / 240;
const HITCH  = 1000 / 60;
// ( a frame later than half a frame again has missed its turn on the screen )
const MISSED = VSYNC * 1.5;

/**
 * Focused run ( STUDIO_SELFTEST=<...>/userperf ): a project in the folder ( a copy ) opened and worked as a busy user
 * works it, hard: the camera thrown about ( orbit, pan, zoom in bursts ), every ground paint tool and every sculpt
 * brush scribbled fast at sizes up to huge, the mask painted and erased, the camera turned while the ground settles,
 * undo and redo hammered, tools flicked between, a formation drawn and its outline edited ( a point dragged about, one
 * added on its edge, one taken out ), and a piece texture painted. The mouse moves once a frame, as the
 * page gets it ( the window hands moves over a frame at a time ), at a scribbling hand's speed.
 *
 * Every phase is held to a 240 Hz display: its typical frame on time, no more than 2% of frames missing their turn,
 * none over a 60th of a second ( a hitch anyone sees ). A stroke is laid down a frame's share at a time, so the brush
 * can trail the cursor: it must have caught up within a second of letting go. The ones that fall short are listed,
 * and fail the run.
 *
 * The folder's only.txt, when there is one, is a pattern: only the phases it matches are run. Every frame ( when it
 * came, how long, in which phase ) is left in frames.json, to line up with a profile.
**/
export async function userPerfSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st       = () => useEditor.getState();
    let phase      = "settle";
    const io       = realInput( eng, () => phase );
    const { rc, m } = io;
    const failed: string[] = [];
    const only             = new RegExp( ( await ipc.readText( joinPath( dir, "only.txt" ) ).catch( () => "" ) ).trim() || "." );
    const seen: [number, number, string][] = [];
    let last               = performance.now(), on = true;
    const tick             = ( t: number ) => {
      seen.push( [t, t - last, phase] );
      last = t;
      if ( on ) requestAnimationFrame( tick );
    };
    requestAnimationFrame( tick );
    // a material built on the frame that first draws it ( not made ready ahead ): a hitch, named by what it was for
    type RO     = { object: THREE.Object3D; material: THREE.Material };
    const nodes = ( eng.renderer as unknown as { _nodes: { getForRender( ro: RO, a?: boolean ): unknown } } )._nodes;
    const built = new Map<string, string[]>();
    const gfr   = nodes.getForRender.bind( nodes );
    nodes.getForRender = ( ro: RO, a?: boolean ) => {
      const t0 = performance.now(), r = gfr( ro, a );
      const dt = performance.now() - t0;
      if ( dt > 1 && !a ) {
        const o = ro.object;
        ( built.get( phase ) ?? built.set( phase, [] ).get( phase )! ).push( `${o.name || o.parent?.name || o.type}/${ro.material.type} ${dt.toFixed( 0 )} ms` );
      }
      return r;
    };

    // where the work goes: the ground's middle, seen from 70 m off
    const c  = terrain.chunks[Math.floor( terrain.chunks.length / 2 )];
    const at = [c.position[0] + c.size[0] / 2, c.position[2] + c.size[2] / 2] as const;
    const g  = ( x: number, z: number ) => terrain.heightAt( x, z );
    const home = () => eng.nav.lookAtUnity( [at[0] - 60, g( at[0], at[1] ) + 40, at[1] - 10], [at[0], g( at[0], at[1] ), at[1]] );
    home();
    await sleep( 3000 );
    // ( a profiler watching waits for this )
    log( "PROFILE: the phases begin" );
    await sleep( 500 );

    // a phase's frames held to the display, logged ( by the frames' own times, as the screen gets them: a callback
    // run a little late inside a frame that still shows on time isn't a missed frame )
    const grade = ( name: string, behind = 0 ) => {
      const a   = seen.filter( ( f ) => f[2] === name ).map( ( f ) => f[1] ).slice( 1 );
      const b   = [...a].sort( ( x, y ) => x - y ), q = ( f: number ) => b[Math.min( b.length - 1, Math.floor( f * b.length ) )] ?? 0;
      const mis = a.filter( ( x ) => x > MISSED ).length, hit = a.filter( ( x ) => x > HITCH ).length, max = b[b.length - 1] ?? 0;
      const ok  = q( 0.5 ) <= VSYNC * 1.1 && mis <= a.length * 0.02 && hit === 0 && behind < 1000;
      if ( !ok ) failed.push( name );
      const bl  = built.get( name ) ?? [];
      log( `${ok ? "ok  " : "FAIL"} ${name}: ${a.length} frames, typical ${q( 0.5 ).toFixed( 1 )} ms (${( 1000 / q( 0.5 ) ).toFixed( 0 )} fps), 99% ${q( 0.99 ).toFixed( 1 )}, worst ${max.toFixed( 1 )}; missed ${mis} (${( ( 100 * mis ) / Math.max( 1, a.length ) ).toFixed( 1 )}%), over 16.7 ms ${hit}${behind > 20 ? `; laid down ${behind.toFixed( 0 )} ms after letting go` : ""}${bl.length ? `; built while drawing: ${bl.length} (${bl.slice( 0, 6 ).join( ", " )})` : ""}` );
    };
    const run = async ( name: string, what: () => Promise<unknown> ) => {
      if ( !only.test( name ) ) return;
      phase = name;
      await what();
      // ( the stroke's last dabs, if it's still being laid down: their frames count too )
      const t1 = performance.now();
      while ( ( eng.input.sculpting || eng.meshPainter.busy ) && performance.now() - t1 < 10000 ) await io.frame();
      const behind = performance.now() - t1;
      phase = "between";
      grade( name, behind );
      await sleep( 250 );
    };
    const send = ( type: string, extra: Record<string, unknown> = {} ) => {
      const init = { clientX: rc.left + m.x, clientY: rc.top + m.y, buttons: m.buttons, pointerId: 1, bubbles: true, cancelable: true, ...extra };
      ( type === "pointerup" ? window : eng.renderer.domElement ).dispatchEvent( new PointerEvent( type, init ) );
    };
    // a scribbling hand for ms: loops across the middle of the view, a move a frame, ~speed px/s on average
    const scribble = async ( ms: number, speed: number, extra: Record<string, unknown> = {} ) => {
      const t0 = performance.now(), w = rc.width * 0.25, h = rc.height * 0.18;
      // ( the loop's length at these frequencies is ~ 2π·√( ( w·f1 )² + ( h·f2 )² ), its speed made to match )
      const k  = speed / ( 2 * Math.PI * Math.hypot( w * 1.3, h * 1.9 ) );
      for ( let t = 0; performance.now() - t0 < ms; ) {
        t   = ( performance.now() - t0 ) / 1000;
        m.x = rc.width  / 2 + w * Math.sin( 2 * Math.PI * 1.3 * k * t );
        m.y = rc.height / 2 + h * Math.sin( 2 * Math.PI * 1.9 * k * t + 0.7 );
        send( "pointermove", extra );
        await io.frame();
      }
    };
    const stroke = async ( button: 0 | 1, ms: number, speed: number, extra: Record<string, unknown> = {} ) => {
      m.x = rc.width / 2;
      m.y = rc.height / 2 + rc.height * 0.18 * Math.sin( 0.7 );
      send( "pointermove", extra );
      await io.frame();
      m.buttons = button === 0 ? 1 : 4;
      send( "pointerdown", { button, ...extra } );
      await io.frame();
      await scribble( ms, speed, extra );
      m.buttons = 0;
      send( "pointerup", { button, ...extra } );
      await io.frame();
    };
    const keys = async ( k: string, n: number, mods: { ctrl?: boolean; shift?: boolean } = {} ) => {
      for ( let j = 0; j < n; j++ ) await io.key( k, mods );
    };

    // ---- the camera
    await run( "idle", () => sleep( 3000 ) );
    await run( "orbit, fast", () => stroke( 1, 3000, 2500 ) );
    home();
    await run( "pan, fast", () => stroke( 1, 2500, 2500, { shiftKey: true } ) );
    home();
    await run( "zoom bursts", async () => {
      for ( let j = 0; j < 3; j++ ) {
        for ( let k = 0; k < 15; k++ ) {
          eng.renderer.domElement.dispatchEvent( new WheelEvent( "wheel", { deltaY: j % 2 ? 120 : -120, clientX: rc.left + m.x, clientY: rc.top + m.y, bubbles: true, cancelable: true } ) );
          await io.frame();
        }
      }
    } );
    home();
    await sleep( 1500 );

    // ---- painting the ground
    st().setTool( "paint" );
    await sleep( 800 );
    for ( const tool of ["snow", "marking", "powder", "flow"] as const )
      for ( const radius of [1.5, 6, 25, 80] ) {
        st().setPaint( { tool, radius } );
        await run( `paint ${tool} r${radius}`, () => stroke( 0, 2000, 1500 ) );
        await run( `  after paint ${tool} r${radius}`, () => sleep( 600 ) );
      }
    st().setPaint( { tool: "snow", radius: 25 } );
    await run( "paint snow r25, frantic", () => stroke( 0, 2000, 6000 ) );
    st().setPaint( { tool: "flow", radius: 25 } );
    await run( "paint flow r25, frantic", () => stroke( 0, 2000, 6000 ) );
    st().setPaint( { tool: "snow", radius: 6 } );

    // ---- sculpting
    st().setTool( "sculpt" );
    await sleep( 800 );
    const { BRUSHES } = await import( "../../sculpt/brushes" );
    for ( const radius of [12, 40, 120] )
      for ( const b of BRUSHES ) {
        if ( b.id === "mask" ) continue;
        st().setSculpt( { brush: b.id, radius } );
        await run( `sculpt ${b.id} r${radius}`, () => stroke( 0, 1500, 1500 ) );
      }
    await run( "  settling after", () => sleep( 800 ) );
    st().setSculpt( { brush: "draw", radius: 40 } );
    await run( "sculpt draw r40, frantic", () => stroke( 0, 2000, 6000 ) );
    st().setSculpt( { brush: "draw", radius: 250 } );
    await run( "sculpt draw r250", () => stroke( 0, 1500, 1500 ) );
    st().setSculpt( { brush: "mask", radius: 30 } );
    await run( "mask paint r30", () => stroke( 0, 1500, 2000 ) );
    await run( "mask erase r30", () => stroke( 0, 1500, 2000, { ctrlKey: true } ) );
    st().setSculpt( { brush: "draw", radius: 40 } );
    await run( "orbit straight after a stroke", async () => {
      await stroke( 0, 600, 1500 );
      await stroke( 1, 1500, 2500 );
    } );
    home();

    // ---- formations, laid as trails are: two drawn, one grown from a point picked, a point dragged, one put in on an
    // edge, one taken out, the two joined ( Ctrl+click ), undone
    if ( only.test( "formation" ) ) {
      st().setTool( "shape" );
      useEditor.setState( { shapeKind: "formation" } );
      await sleep( 500 );
      const ring  = ( c: [number, number], k: number, n: number, r: number ): [number, number] => [c[0] + Math.cos( ( k / n ) * Math.PI * 2 ) * r, c[1] + Math.sin( ( k / n ) * Math.PI * 2 ) * r];
      const on    = ( [x, z]: [number, number] ) => io.scr( [x, g( x, z ), z] );
      const forms = () => st().shapes.filter( ( s ) => s.kind === "formation" ) as { uid: string; points: [number, number][] }[];
      // ( far enough apart that a click on the next point isn't on the picked one's gizmo; seen from high above )
      const A0: [number, number] = [at[0] - 30, at[1]], B0: [number, number] = [at[0] + 34, at[1] + 6];
      eng.nav.lookAtUnity( [at[0], g( at[0], at[1] ) + 170, at[1] - 60], [at[0], g( at[0], at[1] ), at[1]] );
      await sleep( 600 );
      await run( "formation drawn", async () => {
        for ( let k = 0; k < 6; k++ ) await io.click( ...on( ring( A0, k, 6, 24 ) ), 100 );
        await io.key( "Enter" );
        for ( let k = 0; k < 5; k++ ) await io.click( ...on( ring( B0, k, 5, 18 ) ), 100 );
        await io.key( "Enter" );
        await sleep( 400 );
      } );
      const drawn = forms().map( ( f ) => f.points.length ).join( "+" );
      const A     = () => forms()[0], B = () => forms()[1];
      await run( "formation: a point dragged about", async () => {
        const p0 = A().points[0];
        await io.glide( ...on( p0 ), 200 );
        await io.press( 0 );
        for ( let t = 0; t < 1.5; t += 1 / 240 ) {
          const [x, z] = [p0[0] + Math.sin( t * 6 ) * 6, p0[1] + ( 1 - Math.cos( t * 6 ) ) * 4];
          [m.x, m.y]   = on( [x, z] );
          send( "pointermove", {} );
          await io.frame();
        }
        await io.release( 0 );
      } );
      // ( a point picked: the gizmo on it, as on a trail's point; the ground clicked out beyond the side between
      // points 3 and 4: put into that side, the outline still not crossing itself )
      await io.click( ...on( A().points[3] ), 150 );
      const pv     = ( eng.blGizmo as unknown as { pivot: THREE.Vector3 } ).pivot, p3 = A().points[3];
      const gizmo  = eng.blGizmo.attached && Math.hypot( pv.x - p3[0], -pv.z - p3[1] ) < 0.5;
      await io.click( ...on( ring( A0, 3.5, 6, 36 ) ), 150 );
      const grown  = A().points.length;
      const inSide = Math.hypot( A().points[4][0] - ring( A0, 3.5, 6, 36 )[0], A().points[4][1] - ring( A0, 3.5, 6, 36 )[1] ) < 0.5 && !crosses( A().points );
      await run( "formation: a point added on its edge", async () => {
        const [p, q] = [A().points[1], A().points[2]];
        await io.glide( ...on( [( p[0] + q[0] ) / 2, ( p[1] + q[1] ) / 2] ), 200 );
        await io.press( 0 );
        await io.glide( ...on( [( p[0] + q[0] ) / 2 + 1, ( p[1] + q[1] ) / 2 - 1] ), 300 );
        await io.release( 0 );
      } );
      const added = A().points.length;
      await run( "formation: a point taken out", async () => {
        await io.click( ...on( A().points[5] ), 200 );
        await io.key( "x" );
        await sleep( 300 );
      } );
      const taken = A().points.length;
      // ( a point of the first picked, Ctrl+click on one of the second's: one formation of them both )
      await io.click( ...on( A().points[0] ), 150 );
      await io.click( ...on( B().points[2] ), 150, { ctrlKey: true } );
      await sleep( 300 );
      const joined = forms().map( ( f ) => f.points.length ).join( "+" ), simple = forms().length === 1 && !crosses( forms()[0].points );
      history.undo();
      await sleep( 300 );
      const undone = forms().map( ( f ) => f.points.length ).join( "+" );
      const want   = [`6+5`, 7, 8, 7, `12`, `7+5`];
      const right  = drawn === want[0] && grown === want[1] && added === want[2] && taken === want[3] && joined === want[4] && undone === want[5] && gizmo && inSide && simple;
      if ( !right ) failed.push( "formation editing" );
      log( `${right ? "ok  " : "FAIL"} formation points: drawn ${drawn}, grown from a point ${grown}, one put in ${added}, one taken out ${taken}, joined ${joined}, undone ${undone} (want ${want.join( ", " )}); gizmo on the picked point ${gizmo}; a new point in its nearest side ${inSide}; joined without crossing itself ${simple}` );
      for ( let k = 0; k < 12 && st().shapes.some( ( s ) => s.kind === "formation" ); k++ ) history.undo();
      st().setTool( "sculpt" );
      await sleep( 800 );
    }

    // ---- fences, as lifts are: a piece of your own ( a board, turned ) made a fence from its panel, pulled out over
    // the ground, a point dragged about, one Ctrl+clicked in, one taken out
    if ( only.test( "fence" ) ) {
      const { fenceOf, fenceWorld, postSpots } = await import( "../../pieces/fence" );
      const { toView }                         = await import( "../../pieces/rail" );
      const { newModelObject }                 = await import( "../../model/objects" );
      const { primitive }                      = await import( "../../model/mesh" );
      const { transformCustom, composeUnity }  = await import( "../../core/transform" );
      const on                                 = ( [x, z]: [number, number] ) => io.scr( [x, g( x, z ), z] );
      const b0                                 = [at[0] - 4, at[1] - 4] as [number, number];
      const plain                              = newModelObject( newUid(), primitive( "cube", { size: 1 } ), [0, 0, 0] );
      // ( a cube 1 m each way about its middle: made a board 2.4 m long, 1 m tall, 0.1 thick, standing on the ground )
      const board                              = transformCustom( plain, composeUnity( [b0[0], g( ...b0 ) + 0.5, b0[1]], [0, 35, 0], [2.4, 1, 0.1] ) );
      st().addCustom( board, "Board" );
      st().setTool( "select" );
      st().setSelection( [{ kind: "custom", uid: board.uid }] );
      await sleep( 600 );
      const button = [...document.querySelectorAll( "button" )].find( ( b ) => b.textContent?.trim() === "Make Repeat" );
      if ( button ) button.click();
      else void eng.menus.makeFence();
      for ( let k = 0; k < 40 && !st().customObjects.some( ( o ) => fenceOf( o ) && st().selection[0]?.uid === o.uid ); k++ ) await sleep( 50 );
      const uid   = st().selection[0]?.uid;
      const fence = () => st().customObjects.find( ( o ) => o.uid === uid );
      const world = ( i: number ): [number, number] => {
        const o = fence()!, w = fenceWorld( o, fenceOf( o )!.points[i] );
        return [w[0], w[2]];
      };
      const made  = !!fence() && !st().customObjects.some( ( o ) => o.uid === board.uid ) && Math.abs( ( fenceOf( fence()! )!.style.infill.length ?? 0 ) - 2.4 ) < 0.01;
      // ( pulled out 12 m the way it ran: five sections; each section's bottom corners on the ground at its feet )
      const run0  = [world( 0 ), world( 1 )], way = [( run0[1][0] - run0[0][0] ) / 2.4, ( run0[1][1] - run0[0][1] ) / 2.4];
      const to    = [run0[0][0] + way[0] * 12, run0[0][1] + way[1] * 12] as [number, number];
      eng.nav.lookAtUnity( [( b0[0] + to[0] ) / 2 - 10, g( ...b0 ) + 18, ( b0[1] + to[1] ) / 2 - 10], [( b0[0] + to[0] ) / 2, g( ...b0 ), ( b0[1] + to[1] ) / 2] );
      await sleep( 400 );
      await io.click( ...on( world( 1 ) ), 150 );
      await io.drag( ...on( world( 1 ) ), ...on( to ), 400 );
      await sleep( 600 );
      const o     = fence()!, f = fenceOf( o )!;
      const feet  = postSpots( f.points, false, f.style.spacing, true ).map( ( p ) => fenceWorld( o, p ) );
      const verts = o.model!.mesh.v.map( ( v ) => toUnity( toView( o, v ) ) );
      const sat   = feet.map( ( w ) => verts.filter( ( v ) => Math.hypot( v[0] - w[0], v[1] - g( w[0], w[2] ), v[2] - w[2] ) < 0.08 ).length );
      const laid  = feet.length === 6 && sat.every( ( n, k ) => n >= ( k === 0 || k === feet.length - 1 ? 2 : 4 ) );
      const placed = f.points.length;
      await run( "fence: a point dragged about", async () => {
        const p0 = world( 1 );
        await io.glide( ...on( p0 ), 200 );
        await io.press( 0 );
        for ( let t = 0; t < 1.5; t += 1 / 240 ) {
          [m.x, m.y] = on( [p0[0] + Math.sin( t * 5 ) * 5, p0[1] + ( 1 - Math.cos( t * 5 ) ) * 4] );
          send( "pointermove", {} );
          await io.frame();
        }
        await io.release( 0 );
      } );
      await run( "fence: a point Ctrl+clicked in, one taken out", async () => {
        const [p, q] = [world( 0 ), world( 1 )];
        await io.click( ...on( [( p[0] + q[0] ) / 2 + 0.5, ( p[1] + q[1] ) / 2] ), 200, { ctrlKey: true } );
        await sleep( 200 );
        await io.click( ...on( world( 2 ) ), 200 );
        await io.key( "x" );
        await sleep( 200 );
      } );
      const left  = fence() ? fenceOf( fence()! )!.points.length : 0;
      const full  = ( fence()?.colliders.length ?? 0 ) > 0;
      // ( the repeat clicked on, near its far end: that point picked, the gizmo on it, as a lift's piece clicked is )
      await sleep( 300 );
      const p0 = world( 0 ), p1 = world( 1 ), near = [p0[0] + ( p1[0] - p0[0] ) * 0.85, p0[1] + ( p1[1] - p0[1] ) * 0.85] as [number, number];
      await io.click( ...io.scr( [near[0], g( ...near ) + 0.5, near[1]] ), 150 );
      await sleep( 300 );
      // ( the gizmo where the point's ball is, not under it )
      const gz     = eng.fenceTool.gizmoAt(), ball = eng.fenceTool.group.children.find( ( c ) => c.userData.picked );
      const picks  = !!gz && Math.hypot( gz.x - p1[0], -gz.z - p1[1] ) < 0.1 && st().selection[0]?.uid === uid && !!ball && ball.position.distanceTo( gz ) < 1e-3;
      // ( that point moved down into the ground with the gizmo: it stays there, the sections' ends with it )
      eng.fenceTool.gizmoStart();
      eng.fenceTool.gizmoMove( new THREE.Matrix4().makeTranslation( 0, -0.4, 0 ) );
      eng.fenceTool.gizmoEnd();
      await sleep( 300 );
      const sunk   = Math.abs( ( fenceOf( fence()! )!.lift?.[1] ?? 0 ) + 0.4 ) < 1e-6;
      const lowest = Math.min( ...fence()!.model!.mesh.v.map( ( v ) => toUnity( toView( fence()!, v ) ) ).filter( ( v ) => Math.hypot( v[0] - p1[0], v[2] - p1[1] ) < 0.1 ).map( ( v ) => v[1] - g( v[0], v[2] ) ) );
      // ( made a jib in Riding: it stays one through a point moved, as any piece's surface does )
      const jibBtn = [...document.querySelectorAll<HTMLButtonElement>( ".seg button" )].find( ( b ) => b.textContent?.trim() === "Jib" );
      jibBtn?.click();
      await sleep( 300 );
      await io.drag( ...on( world( 0 ) ), ...on( [world( 0 )[0] + 1, world( 0 )[1] + 1] ), 300 );
      await sleep( 600 );
      const rides  = fence()?.surface_type === "Jib" && !!jibBtn && !!fence()?.rail;
      // ( the gizmo's middle on the picked point dragged: the point over the ground, its own ball not drawn under it )
      eng.fenceTool.pickAt( uid!, ...on( world( 1 ) ) );
      await sleep( 300 );
      const w1     = world( 1 ), c1 = io.scr( [w1[0], g( ...w1 ) - 0.4, w1[1]] );
      const hidden = eng.fenceTool.group.children.filter( ( c ) => c.userData.picked ).every( ( c ) => !c.visible ) && eng.blGizmo.centreAt( ...c1 );
      await io.drag( ...c1, c1[0] + 40, c1[1] + 15, 300 );
      await sleep( 500 );
      const slid   = Math.hypot( world( 1 )[0] - w1[0], world( 1 )[1] - w1[1] ) > 0.5 && Math.abs( ( fenceOf( fence()! )!.lift?.[1] ?? 0 ) + 0.4 ) < 1e-6;
      // ( Rotate out: a ring of the gizmo on the picked point dragged, every section turned about its own middle, the path
      // left as it was )
      const pts0   = JSON.stringify( fenceOf( fence()! )!.points ), sec0 = JSON.stringify( fenceOf( fence()! )!.style.infill.sectionMesh?.mesh.v );
      useEditor.setState( { gizmoMode: "rotate" } );
      eng.gizmo.sync();
      await sleep( 300 );
      const gp     = ( eng.blGizmo as unknown as { pick( x: number, y: number ): { kind: string } | null; pivot: THREE.Vector3 } );
      const [px, py] = io.scr( toUnity( gp.pivot ) );
      let ring: [number, number] | null = null;
      for ( let r = 20; r < 160 && !ring; r += 4 )
        for ( let a = 0; a < 360 && !ring; a += 10 ) {
          const x = px + r * Math.cos( ( a * Math.PI ) / 180 ), y = py + r * Math.sin( ( a * Math.PI ) / 180 );
          if ( gp.pick( x, y )?.kind === "ring" ) ring = [x, y];
        }
      if ( ring ) await io.drag( ...ring, ring[0] + 50, ring[1] + 40, 400 );
      await sleep( 500 );
      // ( Scale out: its sections 1.5 times as long along the gizmo's X, the way they run; the path left as it was )
      useEditor.setState( { gizmoMode: "scale" } );
      eng.gizmo.sync();
      const len0   = fenceOf( fence()! )!.style.infill.length ?? 0, piv = gp.pivot.clone(), ax = new THREE.Matrix4().makeRotationFromQuaternion( eng.fenceTool.sectionAxes()! );
      eng.fenceTool.gizmoStart( "scale" );
      eng.fenceTool.gizmoMove( new THREE.Matrix4().makeTranslation( piv.x, piv.y, piv.z ).multiply( ax ).multiply( new THREE.Matrix4().makeScale( 1.5, 1, 1 ) ).multiply( ax.clone().invert() ).multiply( new THREE.Matrix4().makeTranslation( -piv.x, -piv.y, -piv.z ) ) );
      eng.fenceTool.gizmoEnd();
      await sleep( 400 );
      const scaled = Math.abs( ( fenceOf( fence()! )!.style.infill.length ?? 0 ) - len0 * 1.5 ) < 1e-3 && JSON.stringify( fenceOf( fence()! )!.points ) === pts0 && eng.blGizmo.mode === "scale";
      useEditor.setState( { gizmoMode: "translate" } );
      const tq     = fenceOf( fence()! )!.style.infill.sectionTurn;
      const turned = JSON.stringify( fenceOf( fence()! )!.points ) === pts0 && !!tq && Math.abs( tq[3] ) < 0.9999 && fence()!.rotation.y === 0 && !!sec0;
      // ( any piece: the gizmo's middle drags it over the ground, as high off it as it was )
      const crate = newModelObject( newUid(), primitive( "cube", { size: 1 } ), [b0[0] + 6, g( b0[0] + 6, b0[1] ) + 0.5, b0[1]] );
      st().addCustom( crate, "Crate" );
      st().setSelection( [{ kind: "custom", uid: crate.uid }] );
      await sleep( 400 );
      const cp     = ( eng.blGizmo as unknown as { pivot: THREE.Vector3 } ).pivot.clone(), cs = io.scr( toUnity( cp ) );
      await io.drag( ...cs, cs[0] + 80, cs[1] + 40, 400 );
      await sleep( 300 );
      const cr     = st().customObjects.find( ( o ) => o.uid === crate.uid )!, gone = Math.hypot( cr.position.x - crate.position.x, cr.position.z - crate.position.z );
      const along  = gone > 1 && Math.abs( cr.position.y - g( cr.position.x, cr.position.z ) - 0.5 ) < 0.02;
      const right = made && laid && placed === 2 && left === 2 && full && picks && sunk && Math.abs( lowest + 0.4 ) < 0.05 && rides && hidden && slid && turned && scaled && along;
      if ( !right ) failed.push( "fence editing" );
      log( `${right ? "ok  " : "FAIL"} fence: made of a board from its panel ${made} (${button ? "its button" : "the menu"}); pulled out 12 m: ${feet.length - 1} sections, corners on the ground at each foot ${sat.join( "," )} ${laid}; ${placed} points, ${left} after one put in and one taken out, made in full after moving ${full}; clicked near its end, that point picked ${picks}; moved 0.4 m into the ground ${sunk}, its sections' ends ${lowest.toFixed( 2 )} m off it; made a jib in Riding, still one after a point moved ${rides}; the gizmo's middle, the ball under it hidden ${hidden}, dragged it over the ground ${slid}; a Rotate ring turned each section, not the whole ${turned}; Scale made each 1.5 times as long ${scaled}; a crate dragged by the gizmo's middle ${gone.toFixed( 1 )} m over the ground ${along} (want true, 5 sections, true, 2, 2, true, true, true, -0.40, true, true, true, true, true, true)` );
      // ( a repeat of one of the game's features, a jib: pulled out, then a point dragged about by the gizmo's middle )
      {
        const { loadLibrary, placeEntry } = await import( "../../pieces/library" );
        await loadLibrary();
        const f0 = [at[0] + 10, at[1] + 6] as [number, number];
        st().setTool( "select" );
        await placeEntry( feature( "battleship_box_wide" ), [f0[0], g( ...f0 ), f0[1]] );
        await sleep( 1500 );
        const box = st().selection[0]?.uid;
        st().setSelection( box ? [{ kind: "custom", uid: box }] : [] );
        await eng.menus.makeFence();
        await sleep( 1500 );
        const rid  = st().selection[0]?.uid, rep = () => st().customObjects.find( ( o ) => o.uid === rid );
        // ( its grind guide green as soon as it's made: grabbed along its rail, nothing else on it grindable )
        const first = eng.customR.guides.of( rid! );
        const wpt  = ( i: number ): [number, number] => { const o = rep()!, w = fenceWorld( o, fenceOf( o )!.points[i] ); return [w[0], w[2]]; };
        const len  = fenceOf( rep()! )?.style.infill.length ?? 4, [q0, q1] = [wpt( 0 ), wpt( 1 )];
        const out  = [q0[0] + ( ( q1[0] - q0[0] ) / len ) * len * 5, q0[1] + ( ( q1[1] - q0[1] ) / len ) * len * 5] as [number, number];
        eng.nav.lookAtUnity( [( q0[0] + out[0] ) / 2 - 14, g( ...q0 ) + 22, ( q0[1] + out[1] ) / 2 - 14], [( q0[0] + out[0] ) / 2, g( ...q0 ), ( q0[1] + out[1] ) / 2] );
        await sleep( 500 );
        await io.click( ...on( wpt( 1 ) ), 150 );
        await io.drag( ...on( wpt( 1 ) ), ...on( out ), 400 );
        await sleep( 2000 );
        const jib = rep()?.surface_type === "Jib" && !!rep()?.rail;
        await run( "fence: a jib repeat, a point dragged by the gizmo's middle", async () => {
          const c = io.scr( toUnity( eng.fenceTool.gizmoAt()! ) );
          await io.glide( ...c, 150 );
          await io.press( 0 );
          for ( let t = 0; t < 1.5; t += 1 / 240 ) {
            [m.x, m.y] = [c[0] + Math.sin( t * 4 ) * 60, c[1] + ( 1 - Math.cos( t * 4 ) ) * 30];
            send( "pointermove", {} );
            await io.frame();
            if ( t > 0.5 && t < 0.51 ) log( `  mid-drag: its grind guide ${eng.customR.guides.of( rid! ) ? "shown (FAIL)" : "not shown"}` );
          }
          await io.release( 0 );
        } );
        await sleep( 2500 );
        // ( bent: two points Ctrl+clicked in off to one side; its rail still along it, not across the bend )
        for ( const k of [0.35, 0.7] ) {
          const p = wpt( 0 ), q = wpt( fenceOf( rep()! )!.points.length - 1 ), dx = q[0] - p[0], dz = q[1] - p[1];
          await io.click( ...on( [p[0] + dx * k - dz * 0.25, p[1] + dz * k + dx * 0.25] ), 200, { ctrlKey: true } );
          await sleep( 600 );
        }
        await sleep( 1500 );
        const path  = fenceOf( rep()! )!.points, rp = rep()?.rail?.points ?? [];
        const off   = ( p: number[] ) => Math.min( ...path.slice( 1 ).map( ( b, i ) => {
          const a = path[i], ux = b[0] - a[0], uz = b[1] - a[1], t = Math.max( 0, Math.min( 1, ( ( p[0] - a[0] ) * ux + ( p[2] - a[1] ) * uz ) / ( ux * ux + uz * uz || 1 ) ) );
          return Math.hypot( p[0] - a[0] - ux * t, p[2] - a[1] - uz * t );
        } ) );
        const worst = rp.length ? Math.max( ...rp.map( off ) ) : Infinity;
        const bent  = path.length === 4 && worst < 0.5;
        log( `${jib && !!rep()?.rail && bent && !!first?.ok ? "ok  " : "FAIL"} repeat of a feature: its guide green when made ${!!first?.ok}; a jib with its rail ${jib}; after the drag, its rail ${!!rep()?.rail}, its guide back ${!!eng.customR.guides.of( rid! )}; bent with ${path.length} points, its rail ${rp.length} points, at most ${worst.toFixed( 2 )} m off the path (want true, true, true, 4, under 0.5)` );
      }
      st().setTool( "sculpt" );
      await sleep( 500 );
    }

    // ---- undo, redo, switching
    await run( "undo x10, a frame apart", () => keys( "z", 10, { ctrl: true } ) );
    await run( "redo x10, a frame apart", () => keys( "z", 10, { ctrl: true, shift: true } ) );
    await run( "tools flicked between", async () => {
      for ( let j = 0; j < 4; j++ )
        for ( const t of ["paint", "sculpt", "trail", "select"] as const ) {
          st().setTool( t );
          await io.frame();
          await io.frame();
          await io.frame();
        }
    } );
    while ( history.canUndo ) history.undo();
    await sleep( 1000 );

    // ---- painting a piece ( Texture Paint )
    if ( only.test( "texture paint" ) ) await texturePaint( eng, run, stroke );

    if ( only.test( "new map" ) ) {
      const { newEmptyProject } = await import( "../../map/project/sessions" );
      st().setTool( "shape" );
      useEditor.setState( { shapeKind: "formation" } );
      // ( a formation that makes ground, a point of it being dragged as the map's let go )
      home();
      await sleep( 400 );
      for ( let k = 0; k < 5; k++ ) {
        const a = ( k / 5 ) * Math.PI * 2;
        await io.click( ...io.scr( [at[0] + Math.cos( a ) * 12, g( at[0] + Math.cos( a ) * 12, at[1] + Math.sin( a ) * 12 ), at[1] + Math.sin( a ) * 12] ), 80 );
      }
      await io.press( 0 );
      await io.glide( rc.width / 2 + 30, rc.height / 2, 200 );
      await newEmptyProject( joinPath( dir, `new-${Date.now()}.jbrproj` ), "New" );
      await sleep( 1500 );
      st().setTool( "shape" );
      useEditor.setState( { shapeKind: "formation" } );
      await sleep( 300 );
      await io.release( 0 );
      const tile  = terrain.chunks.length === 1 && terrain.chunks[0].size[0] === 1000 && terrain.chunks[0].heights.every( ( h ) => h === terrain.chunks[0].heights[0] );
      const clean = st().shapes.length === 0;
      eng.nav.lookAtUnity( [0, 40, -60], [0, 0, 0] );
      await sleep( 500 );
      await io.click( ...io.scr( [0, terrain.heightAt( 0, 0 ), 0] ), 100 );
      const fresh = st().shapes.length === 1 && ( st().shapes[0] as { points?: unknown[] } ).points?.length === 1;
      // ( Terrain Mode's tools: what's laid on the ground first, the brushes after )
      st().setTool( "trail" );
      await sleep( 300 );
      const order = [...document.querySelectorAll<HTMLButtonElement>( ".tool-column .tool" )].slice( 0, 4 ).map( ( b ) => b.title.split( " (" )[0] ).join( ", " );
      const top   = order === "Trails, Formation, Ramp, Copy Terrain";
      log( `${top ? "ok  " : "FAIL"} Terrain Mode's tools start: ${order}` );
      if ( !top ) failed.push( "tool order" );
      const right = tile && clean && fresh;
      if ( !right ) failed.push( "new map" );
      log( `${right ? "ok  " : "FAIL"} new map: a 1 km tile, flat all over ${tile}, no shapes from before ${clean}, a click starts a new formation of one point ${fresh}` );
    }

    io.stop();
    on = false;
    await ipc.writeText( joinPath( dir, "frames.json" ), JSON.stringify( seen.filter( ( f ) => f[2] !== "between" && f[2] !== "settle" ) ) );
    if ( failed.length ) log( `SELFTEST FAILED: ${failed.length} phases short of 240 Hz: ${failed.map( ( f ) => f.trim() ).join( ", " )}` );
    else log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}

/**
 * Whether an outline crosses itself ( two of its sides that don't share a point cross ).
**/
function crosses( p: [number, number][] ) {
  const n    = p.length;
  const side = ( a: [number, number], b: [number, number], c: [number, number] ) => Math.sign( ( b[0] - a[0] ) * ( c[1] - a[1] ) - ( b[1] - a[1] ) * ( c[0] - a[0] ) );
  for ( let i = 0; i < n; i++ )
    for ( let j = i + 2; j < n; j++ ) {
      if ( i === 0 && j === n - 1 ) continue;
      const [a, b, c, d] = [p[i], p[( i + 1 ) % n], p[j], p[( j + 1 ) % n]];
      if ( side( a, b, c ) * side( a, b, d ) < 0 && side( c, d, a ) * side( c, d, b ) < 0 ) return true;
    }
  return false;
}

/**
 * A game feature ( Rail Long ) opened in Assets, made a model and painted, small and big brushes.
**/
async function texturePaint( eng: NonNullable<ReturnType<typeof getEngine>>, run: ( n: string, f: () => Promise<unknown> ) => Promise<void>, stroke: ( b: 0 | 1, ms: number, speed: number ) => Promise<void> ) {
  const { loadLibrary  } = await import( "../../pieces/library"      );
  const { openAsset    } = await import( "../../pieces/assetFiles"   );
  const { setAssetMode } = await import( "../../ui/blender/AssetsUI" );
  const st               = () => useEditor.getState();
  await loadLibrary();
  await openAsset( feature( "rail_long" ), "Rail Long" );
  await sleep( 1500 );
  const o = st().customObjects[0];
  useEditor.setState( { selection: [{ kind: "custom", uid: o.uid }] } );
  eng.modelling.toggleEditMode();
  await sleep( 800 );
  eng.modelling.toggleEditMode();
  await sleep( 500 );
  const p = st().customObjects.find( ( x ) => x.model );
  if ( !p ) throw new Error( "not a model after Tab" );
  useEditor.setState( { selection: [{ kind: "custom", uid: p.uid }] } );
  setAssetMode( "paint" );
  await waitFor( () => st().materialMode === "paint" && !st().busy, "Texture Paint", 60000 );
  // ( close in on the piece: it fills the view, as when painting it )
  const box = new THREE.Box3().setFromObject( eng.customR.objectGroup( p.uid )! );
  const mid = box.getCenter( new THREE.Vector3() ), r = box.getSize( new THREE.Vector3() ).length() / 2;
  eng.camera.position.copy( mid ).add( new THREE.Vector3( 0, r * 0.5, r * 0.9 ) );
  eng.nav.frameAll();
  await sleep( 1000 );
  for ( const radius of [0.1, 0.4, 1.5] ) {
    st().setPaint( { rgb: [0.9, 0.1, 0.1], radius, strength: 1, texTool: "brush" } );
    await run( `texture paint r${radius}`, () => stroke( 0, 2000, 1500 ) );
  }
  await run( "texture paint r0.4, frantic", () => stroke( 0, 2000, 6000 ) );
}
