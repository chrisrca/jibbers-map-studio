import type * as THREE from "three/webgpu";
import { toUnity, type V3 } from "../../core/coords";
import { ipc, joinPath } from "../../core/ipc";
import { history } from "../../map/history";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";
import type { ToolId } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

// a 240 Hz display's frame, a frame missed ( half a frame late again ), and a hitch anyone sees
const VSYNC  = 1000 / 240;
const MISSED = VSYNC * 1.5;
const HITCH  = 1000 / 60;

/**
 * Focused run ( STUDIO_SELFTEST=<...>/busyperf ): a project in the folder ( a copy: a busy park, or a big mountain )
 * opened and used the everyday way, hard, where userperf ( the ground's brushes ) doesn't go: left alone; the mouse
 * moved over it in every tool and mode, nothing pressed, close up and with the whole map in view, at a hand's speed
 * and frantic; flown and orbited round its pieces; pieces clicked one after another, one dragged about, a box dragged
 * over lots of them; undo and redo hammered; the outliner and the asset browser scrolled. A move a frame, as the
 * page gets them.
 *
 * Every phase is held to a 240 Hz display ( its typical frame on time, no more than 2% of frames missed, none over a
 * 60th of a second ). While the mouse is over the ground, the status bar's readout of where it is must keep up: never
 * two frames running behind. The folder's only.txt, when there is one, is a pattern: only the phases it matches run.
**/
export async function busyPerfSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    useEditor.setState( { splash: false } );
    const st        = () => useEditor.getState();
    let phase       = "settle";
    const io        = realInput( eng, () => phase );
    const { rc, m } = io;
    const failed: string[] = [];
    const only             = new RegExp( ( await ipc.readText( joinPath( dir, "only.txt" ) ).catch( () => "" ) ).trim() || "." );
    // every frame's time, and whether the readout showed the ground under the mouse then
    const seen: [number, string, boolean, number][] = [];
    const shows = () => {
      const c = eng.cursorWorld, el = document.querySelector<HTMLSpanElement>( ".cursor-readout" );
      if ( !c || !el ) return !c;
      const u = toUnity( c );
      return el.textContent!.startsWith( `${u[0].toFixed( 1 )}, ${u[1].toFixed( 1 )}, ${u[2].toFixed( 1 )} m` );
    };
    let last = performance.now(), on = true;
    const tick = ( t: number ) => {
      seen.push( [t - last, phase, shows(), t] );
      last = t;
      if ( on ) requestAnimationFrame( tick );
    };
    requestAnimationFrame( tick );

    // a material made on the frame that first draws it ( not made ready ahead ): a hitch, named by what it was for
    type RO     = { object: THREE.Object3D; material: THREE.Material };
    const nodes = ( eng.renderer as unknown as { _nodes: { getForRender( ro: RO, a?: boolean ): unknown } } )._nodes;
    const built = new Map<string, string[]>();
    const gfr   = nodes.getForRender.bind( nodes );
    nodes.getForRender = ( ro: RO, a?: boolean ) => {
      const t0 = performance.now(), r = gfr( ro, a ), dt = performance.now() - t0;
      if ( dt > 1 && !a ) ( built.get( phase ) ?? built.set( phase, [] ).get( phase )! ).push( `${ro.object.name || ro.object.parent?.name || ro.object.type}/${ro.material.name || ro.material.type} ${dt.toFixed( 0 )} ms` );
      return r;
    };

    // where the pieces are thickest: the middle of them
    const pieces = () => st().customObjects.filter( ( o ) => !o.scenery && !st().locked[o.uid] );
    const pts    = [...pieces().map( ( o ) => [o.position.x, o.position.z] ), ...st().objects.map( ( o ) => [o.position[0], o.position[2]] )];
    const mid    = ( k: 0 | 1 ) => ( pts.length ? [...pts.map( ( p ) => p[k] )].sort( ( a, b ) => a - b )[Math.floor( pts.length / 2 )] : terrain.chunks[0].position[k * 2] + 500 );
    const at     = [mid( 0 ), mid( 1 )] as const;
    const g      = ( x: number, z: number ) => terrain.heightAt( x, z );
    const close  = () => eng.nav.lookAtUnity( [at[0] - 50, g( at[0], at[1] ) + 30, at[1] - 20], [at[0], g( at[0], at[1] ), at[1]] );
    const wide   = () => {
      const b = terrain.bounds(), cx = ( b.x0 + b.x1 ) / 2, cz = ( b.z0 + b.z1 ) / 2, span = Math.max( b.x1 - b.x0, b.z1 - b.z0 );
      eng.nav.lookAtUnity( [cx - span * 0.6, g( cx, cz ) + span * 0.5, cz - span * 0.6], [cx, g( cx, cz ), cz] );
    };
    log( `${st().customObjects.length} pieces, ${st().objects.length} of the game's, ${terrain.chunks.length} chunks; looking at ${at.map( ( v ) => v.toFixed( 0 ) ).join( ", " )}` );

    const grade = ( name: string, readout: boolean ) => {
      const f   = seen.filter( ( s ) => s[1] === name ).slice( 1 );
      const a   = f.map( ( s ) => s[0] );
      const b   = [...a].sort( ( x, y ) => x - y ), q = ( p: number ) => b[Math.min( b.length - 1, Math.floor( p * b.length ) )] ?? 0;
      const mis = a.filter( ( x ) => x > MISSED ).length, hit = a.filter( ( x ) => x > HITCH ).length;
      // ( the readout a frame behind now and then is the frame the mouse moved in; two in a row is behind )
      let behind = 0;
      if ( readout ) for ( let k = 1; k < f.length; k++ ) if ( !f[k][2] && !f[k - 1][2] ) behind++;
      const ok  = a.length > 0 && q( 0.5 ) <= VSYNC * 1.1 && mis <= a.length * 0.02 && hit === 0 && behind === 0;
      if ( !ok ) failed.push( name );
      const bl  = built.get( name ) ?? [];
      log( `${ok ? "ok  " : "FAIL"} ${name}: ${a.length} frames, typical ${q( 0.5 ).toFixed( 1 )} ms (${( 1000 / Math.max( 0.01, q( 0.5 ) ) ).toFixed( 0 )} fps), 99% ${q( 0.99 ).toFixed( 1 )}, worst ${( b[b.length - 1] ?? 0 ).toFixed( 1 )}; missed ${mis} (${( ( 100 * mis ) / Math.max( 1, a.length ) ).toFixed( 1 )}%), over 16.7 ms ${hit}${readout ? `; readout behind ${behind} frames` : ""}${bl.length ? `; made while drawing: ${bl.length} (${bl.slice( 0, 6 ).join( ", " )})` : ""}` );
    };
    // a phase: set up ( not timed ), then timed while `what` runs
    const run = async ( name: string, what: () => Promise<unknown>, setup: () => unknown = () => {}, readout = false ) => {
      if ( !only.test( name ) ) return;
      phase = "between";
      await setup();
      await sleep( 800 );
      phase = name;
      await what();
      phase = "between";
      grade( name, readout );
      await sleep( 300 );
    };
    const send = ( type: string, extra: Record<string, unknown> = {} ) => {
      const init = { clientX: rc.left + m.x, clientY: rc.top + m.y, buttons: m.buttons, pointerId: 1, bubbles: true, cancelable: true, pointerType: "mouse", ...extra };
      ( type === "pointerup" ? window : eng.renderer.domElement ).dispatchEvent( new PointerEvent( type, init ) );
    };
    // the mouse looped across most of the view for ms, a move a frame, ~speed px/s
    const wander = async ( ms: number, speed: number, extra: Record<string, unknown> = {} ) => {
      const t0 = performance.now(), w = rc.width * 0.4, h = rc.height * 0.35;
      const k  = speed / ( 2 * Math.PI * Math.hypot( w * 1.3, h * 1.9 ) );
      for ( let t = 0; performance.now() - t0 < ms; ) {
        t   = ( performance.now() - t0 ) / 1000;
        m.x = rc.width  / 2 + w * Math.sin( 2 * Math.PI * 1.3 * k * t );
        m.y = rc.height / 2 + h * Math.sin( 2 * Math.PI * 1.9 * k * t + 0.7 );
        send( "pointermove", extra );
        await io.frame();
      }
    };
    const tool = ( t: ToolId, more: Record<string, unknown> = {} ) => () => {
      useEditor.setState( { designPick: null, selection: [], ...more } );
      st().setTool( t );
    };
    // the mouse over the map in a tool, at a hand's speed and frantic
    const hover = async ( name: string, setup: () => unknown, view = close ) => {
      for ( const [speed, how] of [[1500, ""], [6000, ", frantic"]] as const )
        await run( `hover: ${name}${how}`, () => wander( 2500, speed ), () => { setup(); view(); }, true );
      // ( what that tool has drawn: meshes in view, by the group they're in )
      if ( only.test( `hover: ${name}` ) ) {
        const by = new Map<string, number>();
        eng.scene.traverseVisible( ( o ) => {
          if ( !( o as THREE.Mesh ).isMesh ) return;
          let p: THREE.Object3D = o;
          while ( p.parent && p.parent !== eng.scene ) p = p.parent;
          const k = p.name || p.type;
          by.set( k, ( by.get( k ) ?? 0 ) + 1 );
        } );
        log( `  ( ${name}: ${[...by].map( ( [k, n] ) => `${k} ${n}` ).join( ", " )} )` );
      }
    };
    // pieces in view, on screen
    const onScreen = () =>
      pieces()
        .map( ( o ) => ( { o, p: io.scr( [o.position.x, o.position.y, o.position.z] as V3 ) } ) )
        .filter( ( { p } ) => p[0] > rc.width * 0.1 && p[0] < rc.width * 0.9 && p[1] > rc.height * 0.1 && p[1] < rc.height * 0.9 );

    // what a frame of it draws, close up: draw calls, and the scene's objects ( meshes shown, hidden, instanced )
    close();
    await sleep( 1500 );
    {
      let meshes = 0, hidden = 0, inst = 0, nodes = 0;
      eng.scene.traverse( ( o ) => {
        nodes++;
        if ( !( o as { isMesh?: boolean } ).isMesh ) return;
        if ( !o.visible ) hidden++;
        else if ( ( o as { isInstancedMesh?: boolean } ).isInstancedMesh ) inst++;
        else meshes++;
      } );
      const info = ( eng.renderer as unknown as { info: { render: { drawCalls: number; triangles: number } } } ).info.render;
      // ( the heaviest: triangles a mesh draws, times its copies )
      const heavy: [number, string][] = [];
      const groupOf = new Map<THREE.Object3D, string>(), geoOf = new Map<unknown, string>();
      for ( const [uid, sh] of eng.customR.shown ) {
        groupOf.set( sh.group, uid );
        sh.group.traverse( ( c ) => void ( ( c as THREE.Mesh ).geometry && geoOf.set( ( c as THREE.Mesh ).geometry, uid ) ) );
      }
      eng.scene.traverseVisible( ( o ) => {
        const m = o as unknown as { isMesh?: boolean; geometry?: { index: { count: number } | null; attributes: { position?: { count: number } } }; count?: number; isInstancedMesh?: boolean; name: string; parent: { name: string; userData: { uid?: string } } | null };
        if ( !m.isMesh || !m.geometry ) return;
        const tris = ( m.geometry.index?.count ?? m.geometry.attributes.position?.count ?? 0 ) / 3, n = m.isInstancedMesh ? m.count ?? 1 : 1;
        let p: THREE.Object3D | null = o, uid = "";
        while ( p && !uid ) { uid = groupOf.get( p ) ?? ""; p = p.parent; }
        if ( !uid && m.isInstancedMesh ) uid = geoOf.get( ( o as THREE.Mesh ).geometry ) ?? "";
        const label = uid ? st().labels[uid] ?? st().customObjects.find( ( c ) => c.uid === uid )?.parts[0]?.mesh ?? uid : o.name || o.parent?.name || o.type;
        heavy.push( [tris * n, `${label}${n > 1 ? ` x${n}` : ""} ${( tris / 1000 ).toFixed( 0 )}k` ] );
      } );
      heavy.sort( ( x, y ) => y[0] - x[0] );
      // ( the meshes drawn on their own: by whose, and how many share a mesh or a material with another )
      const own: THREE.Mesh[] = [];
      eng.scene.traverseVisible( ( o ) => void ( ( o as THREE.Mesh ).isMesh && !( o as THREE.InstancedMesh ).isInstancedMesh && own.push( o as THREE.Mesh ) ) );
      const under = new Map<string, number>(), geos = new Map<string, number>(), mats = new Map<string, number>();
      for ( const m of own ) {
        let p: THREE.Object3D | null = m, top = "";
        while ( p && p.parent && p.parent !== eng.scene ) p = p.parent;
        top = p?.name || p?.type || "?";
        let q: THREE.Object3D | null = m, uid = "";
        while ( q && !uid ) { uid = groupOf.get( q ) ?? ""; q = q.parent; }
        const k = uid ? `piece ${"fence" in ( st().customObjects.find( ( c ) => c.uid === uid ) ?? {} ) ? "repeat" : st().customObjects.find( ( c ) => c.uid === uid )?.model ? "modelled" : "library"}` : top;
        under.set( k, ( under.get( k ) ?? 0 ) + 1 );
        geos.set( m.geometry.uuid, ( geos.get( m.geometry.uuid ) ?? 0 ) + 1 );
        const mk = ( Array.isArray( m.material ) ? m.material : [m.material] ).map( ( x ) => x.uuid ).join( "," );
        mats.set( mk, ( mats.get( mk ) ?? 0 ) + 1 );
      }
      const cr = eng.customR as unknown as { batched: Map<string, { bm: { instanceCount?: number }; ids: Map<string, number> }> };
      const ims: number[] = [];
      eng.customR.group.traverse( ( o ) => void ( ( o as THREE.InstancedMesh ).isInstancedMesh && ims.push( ( o as THREE.InstancedMesh ).count ) ) );
      const sizes = new Map<string, number>();
      for ( const n of ims ) { const k = n >= 8 ? "8+" : `${n}`; sizes.set( k, ( sizes.get( k ) ?? 0 ) + 1 ); }
      log( `instanced: ${ims.length} meshes, by copies ${[...sizes].sort().map( ( [k, n] ) => `${k}: ${n}` ).join( ", " )}` );
      log( `batched by material: ${cr.batched.size} batches, ${[...cr.batched.values()].reduce( ( n, b ) => n + b.ids.size, 0 )} pieces' meshes in them` );
      log( `drawn on their own: ${own.length} meshes ( ${[...under].map( ( [k, n] ) => `${k} ${n}` ).join( ", " )} ); ${geos.size} meshes among them, ${[...geos.values()].filter( ( n ) => n > 1 ).length} shared; ${mats.size} materials, the most shared by ${Math.max( ...mats.values() )}` );
      const ts = eng.terrainR.stats, steps = new Map<number, number>();
      for ( const row of ( eng.terrainR as unknown as { tiles: { step: number; mesh: { visible: boolean } }[][] } ).tiles ) for ( const t of row ) if ( t.mesh.visible ) steps.set( t.step, ( steps.get( t.step ) ?? 0 ) + 1 );
      log( `the ground: ${ts.visible}/${ts.tiles} tiles shown, ${( ts.triangles / 1e6 ).toFixed( 2 )}M triangles; tiles by step ${[...steps].sort( ( x, y ) => x[0] - y[0] ).map( ( [k, n] ) => `${k}: ${n}` ).join( ", " )}; the view ${eng.renderer.domElement.width}x${eng.renderer.domElement.height}` );
      log( `heaviest: ${heavy.slice( 0, 12 ).map( ( h ) => `${h[1]} (${( h[0] / 1e6 ).toFixed( 2 )}M)` ).join( ", " )}` );
      log( `a frame close up: ${info.drawCalls} draw calls, ${( info.triangles / 1000 ).toFixed( 0 )}k triangles; the scene ${nodes} objects, ${meshes} meshes shown, ${inst} instanced, ${hidden} hidden` );
    }
    // ( the map as the screen shows it, to compare before and after a change to how it's drawn: close up, the whole
    // of it, a piece picked; only when asked for: only.txt "look" )
    if ( /look/.test( only.source ) ) {
      const snap = async ( name: string ) => {
        await sleep( 2500 );
        log( `SNAP look-${name}` );
        await sleep( 1500 );
      };
      tool( "select" )();
      close();
      await snap( "close" );
      wide();
      await snap( "wide" );
      close();
      const o = pieces().find( ( c ) => Math.hypot( c.position.x - at[0], c.position.z - at[1] ) < 30 );
      if ( o ) st().setSelection( [{ kind: "custom", uid: o.uid }] );
      await snap( "picked" );
      st().setSelection( [] );
      // ( the sculpt brush under the mouse, its size and strength by it )
      tool( "sculpt" )();
      eng.renderer.domElement.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
      for ( let k = 0; k < 5; k++ ) {
        eng.renderer.domElement.dispatchEvent( new PointerEvent( "pointermove", { clientX: rc.left + rc.width / 2 + k, clientY: rc.top + rc.height * 0.6, buttons: 0, pointerId: 1, bubbles: true } ) );
        await io.frame();
      }
      await snap( "sculpt" );
      tool( "select" )();
    }
    // ( a spawn up close, as the screen shows it )
    const sp = st().spawns[0];
    if ( sp && /spawn/.test( only.source ) ) {
      eng.nav.lookAtUnity( [sp.position[0] - 4, sp.position[1] + 3, sp.position[2] - 4], [sp.position[0], sp.position[1] + 1, sp.position[2]] );
      await sleep( 1000 );
      log( "SNAP spawn" );
      await sleep( 1200 );
    }
    log( "PROFILE: the phases begin" );
    await sleep( 500 );

    // ---- left alone ( nothing should be drawn again )
    await run( "idle, close up", () => sleep( 3000 ), tool( "select" ) );
    await run( "idle, whole map", () => sleep( 3000 ), () => { tool( "select" )(); wide(); } );

    // ---- the mouse over it, every tool
    await hover( "Select", tool( "select" ) );
    await hover( "Select, whole map in view", tool( "select" ), wide );
    await hover( "Select Box", () => { tool( "select" )(); useEditor.setState( { designPick: "box" } ); } );
    await hover( "a piece picked", () => {
      tool( "select" )();
      const o = pieces()[0];
      if ( o ) st().setSelection( [{ kind: "custom", uid: o.uid }] );
    } );
    await hover( "Place", tool( "place" ) );
    await hover( "Spawn", tool( "spawn" ) );
    await hover( "Scatter", tool( "scatter" ) );
    await hover( "Sculpt", tool( "sculpt" ) );
    await hover( "Sculpt, whole map in view", tool( "sculpt" ), wide );
    await hover( "Paint", tool( "paint" ) );
    await hover( "Trails", tool( "trail" ) );
    await hover( "Shapes", tool( "shape", { shapeKind: "curve" } ) );
    await hover( "Formations", tool( "shape", { shapeKind: "formation" } ) );

    // ---- round the pieces
    const orbit = async ( ms: number, speed: number, extra: Record<string, unknown> = {} ) => {
      m.x = rc.width / 2;
      m.y = rc.height / 2;
      send( "pointermove", extra );
      m.buttons = 4;
      send( "pointerdown", { button: 1, ...extra } );
      await wander( ms, speed, extra );
      m.buttons = 0;
      send( "pointerup", { button: 1, ...extra } );
      await io.frame();
    };
    await run( "orbit round the pieces", () => orbit( 3000, 2500 ), () => { tool( "select" )(); close(); } );
    await run( "pan over the pieces", () => orbit( 2500, 2500, { shiftKey: true } ), () => { tool( "select" )(); close(); } );
    await run( "zoom in and out over the pieces", async () => {
      m.x = rc.width / 2;
      m.y = rc.height / 2;
      for ( let j = 0; j < 4; j++ ) await io.wheel( j % 2 ? 120 : -120, 12 );
    }, () => { tool( "select" )(); close(); } );
    await run( "orbit, whole map in view", () => orbit( 3000, 2500 ), () => { tool( "select" )(); wide(); } );

    // ---- what a frame's made of ( only when asked for: only.txt "anatomy" ): the same orbit with each part of the map
    // left out in turn, so it's plain which costs what
    if ( /anatomy/.test( only.source ) ) {
      const parts: [string, THREE.Object3D][] = [["the ground", eng.terrainR.group], ["the pieces", eng.customR.group], ["the game's objects and spawns", eng.objectsR.group]];
      await run( "anatomy: all of it", () => orbit( 2500, 2500 ), () => { tool( "select" )(); wide(); } );
      // ( and the pieces split: their instanced batches, those drawn on their own, the grind guides )
      const shown = ( f: ( o: THREE.Object3D ) => boolean ) => {
        const out: THREE.Object3D[] = [];
        eng.customR.group.traverseVisible( ( o ) => void ( ( o as THREE.Mesh ).isMesh && f( o ) && out.push( o ) ) );
        return out;
      };
      const sets: [string, () => THREE.Object3D[]][] = [
        ...parts.map( ( [n, g] ) => [n, () => [g]] as [string, () => THREE.Object3D[]] ),
        ["the instanced pieces", () => shown( ( o ) => !!( o as THREE.InstancedMesh ).isInstancedMesh )],
        ["the pieces drawn on their own", () => shown( ( o ) => !( o as THREE.InstancedMesh ).isInstancedMesh && !eng.customR.guides.group.getObjectById( o.id ) )],
        ["the grind guides", () => [eng.customR.guides.group]],
      ];
      for ( const [name, of] of sets ) {
        let hidden: THREE.Object3D[] = [];
        await run( `anatomy: without ${name}`, async () => {
          hidden = of().filter( ( o ) => o.visible );
          for ( const o of hidden ) o.visible = false;
          try {
            await orbit( 2500, 2500 );
          } finally {
            for ( const o of hidden ) o.visible = true;
          }
        }, () => { tool( "select" )(); wide(); } );
        log( `  ( ${hidden.length} left out )` );
      }
    }

    // ---- pieces worked with
    await run( "pieces clicked one after another", async () => {
      for ( const { p } of onScreen().slice( 0, 12 ) ) await io.click( p[0], p[1], 150 );
    }, () => { tool( "select" )(); close(); } );
    if ( only.test( "clicked" ) ) {
      // ( the last one picked, outlined: as the screen shows it, partly behind others or not )
      log( "SNAP outline-picked" );
      await sleep( 1200 );
      const big = onScreen().sort( ( x, y ) => y.o.parts.length - x.o.parts.length )[0];
      if ( big ) st().setSelection( onScreen().slice( 0, 8 ).map( ( { o } ) => ( { kind: "custom" as const, uid: o.uid } ) ) );
      await sleep( 400 );
      log( "SNAP outline-eight" );
      await sleep( 1200 );
      if ( big ) st().setSelection( [{ kind: "custom", uid: big.o.uid }] );
      await sleep( 300 );
    }
    // ( what's put in or taken out of the scene while a piece is dragged: counted, and where from ( each makes the
    // pieces' matrices be worked out again ) )
    // ( Object3D's own: the scene's class's parent )
    const base  = Object.getPrototypeOf( Object.getPrototypeOf( eng.scene ) ) as { add: ( ...o: unknown[] ) => unknown; remove: ( ...o: unknown[] ) => unknown };
    const add0  = base.add, rem0 = base.remove, asked: string[] = [];
    const where = () => ( new Error().stack ?? "" ).split( "\n" ).slice( 3, 6 ).map( ( l ) => l.trim().replace( /\(.*\/assets\//, "(" ) ).join( " < " );
    base.add    = function ( this: unknown, ...o: unknown[] ) { if ( phase === "a piece dragged about" ) asked.push( `add ${where()}` ); return add0.apply( this, o ); };
    base.remove = function ( this: unknown, ...o: unknown[] ) { if ( phase === "a piece dragged about" ) asked.push( `remove ${where()}` ); return rem0.apply( this, o ); };
    // ( what of the page changes while a piece is dragged: each change has the page laid out and painted again )
    const changed = new Map<string, number>();
    const area    = ( n: Node | null ) => {
      const el = ( n instanceof Element ? n : n?.parentElement ) ?? null;
      const a  = el?.closest( ".area, .statusbar, .tool-settings, .topbar, .viewport" );
      // ( a panel by its own first child's class, and the element changed )
      const inner = a?.firstElementChild?.className.split( " " )[0] ?? "";
      return a ? `${a.className.split( " " ).slice( 0, 2 ).join( "." )}/${inner}/${el?.tagName.toLowerCase()}.${( el?.className as string | undefined )?.split?.( " " )[0] ?? ""}` : el?.tagName ?? "?";
    };
    const watch = new MutationObserver( ( list ) => {
      if ( phase !== "a piece dragged about" ) return;
      for ( const r of list ) {
        const k = `${area( r.target )}${r.type === "attributes" ? `[${r.attributeName}${( r.target as HTMLInputElement ).type ? ` ${( r.target as HTMLInputElement ).type}` : ""}]` : ` ${r.type}`}`;
        changed.set( k, ( changed.get( k ) ?? 0 ) + 1 );
      }
    } );
    watch.observe( document.body, { subtree: true, childList: true, characterData: true, attributes: true } );
    await run( "a piece dragged about", async () => {
      const o = st().selection[0] && pieces().find( ( c ) => c.uid === st().selection[0].uid );
      if ( !o ) return;
      const p = io.scr( [o.position.x, o.position.y, o.position.z] as V3 );
      await io.glide( p[0], p[1], 150 );
      await io.press( 0 );
      for ( let t = 0; t < 2; t += 1 / 240 ) {
        m.x = p[0] + Math.sin( t * 5 ) * 120;
        m.y = p[1] + ( 1 - Math.cos( t * 5 ) ) * 60;
        send( "pointermove" );
        await io.frame();
      }
      await io.release( 0 );
    } );
    watch.disconnect();
    log( `the page changed while dragging: ${[...changed].sort( ( x, y ) => y[1] - x[1] ).map( ( [k, n] ) => `${k} ${n}` ).join( ", " )}` );
    if ( asked.length ) log( `the scene changed ${asked.length} times dragging; from ${[...new Set( asked )].slice( 0, 4 ).join( " | " )}` );
    base.add    = add0;
    base.remove = rem0;
    await run( "a box dragged over lots of pieces", async () => {
      await io.drag( rc.width * 0.15, rc.height * 0.15, rc.width * 0.85, rc.height * 0.85, 1200 );
      await sleep( 300 );
    }, () => { tool( "select" )(); useEditor.setState( { designPick: "box" } ); close(); } );
    const picked = st().selection.length;
    await run( "undo and redo hammered", async () => {
      for ( let k = 0; k < 6; k++ ) {
        history.undo();
        await io.frame();
        await io.frame();
      }
      for ( let k = 0; k < 6; k++ ) {
        history.redo();
        await io.frame();
        await io.frame();
      }
    }, () => useEditor.setState( { designPick: null } ) );

    // ---- the Assets workspace and back to the map ( the map hidden, then all of it shown again )
    await run( "to Assets and back", async () => {
      st().setTool( "model" );
      for ( let k = 0; k < 120; k++ ) await io.frame();
      st().setTool( "select" );
      for ( let k = 0; k < 240; k++ ) await io.frame();
    }, () => { tool( "select" )(); close(); } );

    // ---- the panels
    const scroll = async ( el: Element | null | undefined, ms: number ) => {
      if ( !el ) return;
      const t0 = performance.now(), top = el.scrollHeight - el.clientHeight;
      while ( performance.now() - t0 < ms ) {
        el.scrollTop = ( ( Math.sin( ( performance.now() - t0 ) / 300 ) + 1 ) / 2 ) * top;
        await io.frame();
      }
    };
    const scroller = ( root: string ) => [...document.querySelectorAll( `${root} *` )].find( ( e ) => e.scrollHeight > e.clientHeight + 40 && getComputedStyle( e ).overflowY !== "visible" );
    await run( "outliner scrolled", () => scroll( scroller( ".area.outliner" ), 2500 ), () => st().setSelection( [] ) );
    await run( "asset browser scrolled", () => scroll( scroller( ".area.assets" ), 2500 ) );

    on = false;
    io.stop();
    st().setTool( "select" );
    // ( every frame: when it came, how long, in which phase, to line up with a profile )
    await ipc.writeText( joinPath( dir, "frames.json" ), JSON.stringify( seen.filter( ( f ) => f[1] !== "between" && f[1] !== "settle" ).map( ( f ) => [f[3], f[0], f[1]] ) ) );
    log( `( the box picked ${picked} )` );
    log( failed.length ? `SELFTEST FAILED: ${failed.length} phases short of 240 Hz or the readout behind: ${failed.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
