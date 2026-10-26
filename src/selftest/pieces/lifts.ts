import type { ObjectEntry } from "../../core/types";
import * as THREE from "three/webgpu";
import type { V3 } from "../../core/coords";
import { domShot, log, pressCard, realInput, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/lifts ): Map-Tools 0.5 lifts, driven as a person does. Joyosa Park ( the game's
 * own map, with a chairlift and a T-bar ) imported: its lifts drawn; the chairlift picked by clicking it, its base
 * station dragged ( the rest staying put ), its top station dragged, a mast put down with Ctrl+click and taken away
 * with X; Auto masts ticked, spaced afresh as the top moves, and left where they are once one's dragged; saved and
 * opened again; a new chairlift put down from the Lifts catalog. Frame times by phase.
**/
export async function liftsSelftest( dir: string ) {
  try {
    const P              = await import( "../../map/project" );
    const { liftPieces } = await import( "../../pieces/lift" );
    const src            = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Jibbers Playtest\\Jibbers_Data\\StreamingAssets\\Maps\\joyosa-park.jbrmap";
    const proj           = joinPath( dir, "joyosa.jbrproj" );
    await P.importMap( src, proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 3000 );
    const st      = () => useEditor.getState();
    const lifts   = () => st().objects.filter( ( o ) => o.lift );
    const drawn   = () => ( eng.objectsR.lifts as unknown as { drawn: Map<string, unknown> } ).drawn.size;
    const handles = () => eng.liftTool.group.children.length;
    log( `imported: ${lifts().length} lifts (${lifts().map( ( o ) => `${o.id} ${o.lift!.masts.length} masts` ).join( ", " )}); drawn ${drawn()}; author "${st().map?.author}", map version ${st().map?.modVersion}, scale ${st().map?.scale}` );
    let phase                       = "start";
    const io                        = realInput( eng, () => phase );
    const { click, drag, key, scr } = io;
    const chair                     = () => st().objects.find( ( o ) => o.id === "chairlift" )!;
    const pieces                    = () => liftPieces( chair() )!;
    /**
     * The selection box round the lift's piece picked: as big as that piece ( not the cube standing in while its model
     * loads, nor another piece ), round where it stands.
    **/
    const checkBox = async ( what: string, o: ObjectEntry = chair(), part: "base" | "top" | number = eng.liftTool.pickedOf( o.uid ) ) => {
      await sleep( 250 );
      const boxes = ( eng.objectsR as unknown as { boxes: THREE.Group } ).boxes;
      if ( !boxes.children.length ) return log( `  selection box ${what}: none (FAIL)` );
      const b     = new THREE.Box3().setFromObject( boxes ), size = b.getSize( new THREE.Vector3() ), c = b.getCenter( new THREE.Vector3() );
      const info  = eng.lib.info( o.id )!.lift!, pi = part === "base" ? info.base : part === "top" ? info.top : info.mast!;
      const want  = ( pi.boundsMax[1] - pi.boundsMin[1] ) * o.scale[1];
      const reach = Math.hypot( Math.max( -pi.boundsMin[0], pi.boundsMax[0] ), Math.max( -pi.boundsMin[2], pi.boundsMax[2] ) ) + 1;
      const pc    = liftPieces( o )!, foot = part === "base" ? pc.base.at : part === "top" ? pc.top.at : pc.masts[part].at;
      const off   = Math.hypot( c.x - foot[0], -c.z - foot[2] );
      const ok    = Math.abs( size.y - want ) < want * 0.15 && off < reach;
      log( `  selection box ${what} (${part === "base" ? "base station" : part === "top" ? "top station" : `mast ${part + 1}`}): ${size.x.toFixed( 1 )} × ${size.y.toFixed( 1 )} × ${size.z.toFixed( 1 )} m, the piece ${want.toFixed( 1 )} m tall; ${off.toFixed( 1 )} m from its foot${ok ? "" : " (FAIL)"}` );
    };
    const look = async () => {
      const p = pieces(), b = p.base.at, t = p.top.at, mid: V3 = [( b[0] + t[0] ) / 2, ( b[1] + t[1] ) / 2, ( b[2] + t[2] ) / 2];
      eng.nav.lookAtUnity( [mid[0] + 330, mid[1] + 260, mid[2] - 230], mid );
      await sleep( 800 );
    };
    await look();
    await ipc.writeBinary( joinPath( dir, "joyosa-lifts.png" ), await eng.pictures.capture() );
    log( "SHOT joyosa-lifts.png" );
    // the asset browser as it opens ( the official features carry the game's mark )
    await domShot( document.querySelector<HTMLElement>( ".area.assets" ), joinPath( dir, "assets.png" ) );
    log( `SHOT assets.png (${document.querySelectorAll( ".card .thumb img.official" ).length} cards with the mark)` );
    // ---- the game's look: stations, masts and carriers, going round
    type Inst   = { isInstancedMesh?: boolean; count: number; visible: boolean; userData: Record<string, unknown>; instanceMatrix: { array: ArrayLike<number> } };
    type Draw   = { g: { children: Inst[] }; carriers: { n: number; speed: number; meshes: Inst[] } | null };
    const draws = () => ( eng.objectsR.lifts as unknown as { drawn: Map<string, Draw> } ).drawn;
    await waitFor( () => ( [...draws().values()].filter( ( d ) => d.carriers ).length >= 2 ? true : null ), "the lifts' carriers", 40000 ).catch( () => null );
    await sleep( 500 );
    for ( const o of lifts() ) {
      const d = draws().get( o.uid );
      if ( !d ) {
        log( `${o.id}: not drawn (FAIL)` );
        continue;
      }
      const inst    = d.g.children.filter( ( c ) => c.isInstancedMesh ), shown = d.g.children.filter( ( c ) => c.userData.kind && c.visible ).length;
      const objMesh = eng.objectsR.objectMesh( o.uid ) as unknown as { visible: boolean } | undefined;
      log( `${o.id}: look ${inst.length} instanced meshes (${inst.map( ( c ) => c.count ).join( "," )}), placeholders still shown ${shown + ( objMesh?.visible ? 1 : 0 )}; carriers ${d.carriers ? `${d.carriers.n} at ${d.carriers.speed} m/s` : "none (FAIL)"}` );
      if ( d.carriers ) {
        const at              = () => Array.from( d.carriers!.meshes[0].instanceMatrix.array ).slice( 12, 15 );
        // ( in tenths of a second, the middle one taken: a carrier passing the next one's place takes over its number )
        const steps: number[] = [];
        let a                 = at(), t0 = performance.now();
        for ( let k = 0; k < 9; k++ ) {
          await sleep( 100 );
          const b = at(), t1 = performance.now();
          steps.push( ( Math.hypot( b[0] - a[0], b[1] - a[1], b[2] - a[2] ) * 1000 ) / ( t1 - t0 ) );
          a  = b;
          t0 = t1;
        }
        const went = steps.sort( ( x, y ) => x - y )[4];
        log( `  a carrier goes ${went.toFixed( 2 )} m a second (want ~${Math.abs( d.carriers.speed )}${Math.abs( went - Math.abs( d.carriers.speed ) ) < 1.5 ? "" : ", FAIL"})` );
      }
    }
    const close = async ( o: ( typeof lifts extends () => ( infer T )[] ? T : never ), name: string, which: "base" | "mast" | "top" ) => {
      const p        = liftPieces( o )!, at = which === "base" ? p.base.at : which === "top" ? p.top.at : p.masts[Math.floor( p.masts.length / 2 )]?.at ?? p.base.at;
      const side: V3 = [Math.cos( p.base.yaw ) * 16, 0, -Math.sin( p.base.yaw ) * 16];
      eng.nav.lookAtUnity( [at[0] + side[0] + 6, at[1] + ( which === "mast" ? 14 : 7 ), at[2] + side[2] + 6], [at[0], at[1] + ( which === "mast" ? 9 : 2 ), at[2]] );
      await sleep( 900 );
      await ipc.writeBinary( joinPath( dir, name ), await eng.pictures.capture() );
      log( `SHOT ${name}` );
    };
    for ( const o of lifts() ) {
      await close( o, `${o.id}-base.png`, "base" );
      await close( o, `${o.id}-mast.png`, "mast" );
      await close( o, `${o.id}-top.png`,  "top"  );
    }
    await look();
    st().setTool( "select" );
    await sleep( 300 );
    phase = "pick the chairlift";
    {
      const b = pieces().base.at;
      await click( ...scr( [b[0], b[1] + 3, b[2]] ) );
      await sleep( 300 );
      log( `picked: ${st().selection.map( ( x ) => x.kind ).join( "," )} ${st().selection[0]?.uid === chair().uid ? "(the chairlift)" : "(FAIL: not the chairlift)"}; handles ${handles()} (2 stations + ${chair().lift!.masts.length} masts)` );
      await checkBox( "on picking" );
    }
    // ( where the pieces are, in the world )
    const spots = () => [pieces().top.at, ...pieces().masts.map( ( m ) => m.at )];
    const apart = ( a: V3[], b: V3[] ) => ( a.length === b.length ? Math.max( ...a.map( ( v, i ) => Math.hypot( v[0] - b[i][0], v[1] - b[i][1], v[2] - b[i][2] ) ) ) : Infinity );
    /**
     * a spot on the screen on a piece of the lift itself ( not its handle, not the gizmo ): looked for round its foot
    **/
    const onPiece = ( which: "base" | "top" | number ): [number, number] | null => {
      const tool = eng.liftTool as unknown as { pieceAt( o: unknown, x: number, y: number ): unknown; handleAt( x: number, y: number ): unknown };
      const p    = pieces(), at = which === "base" ? p.base.at : which === "top" ? p.top.at : p.masts[which].at;
      for ( const h of [3, 5, 2, 7, 1.5, 9] )
        for ( const along of [0, 2, -2, 4, -4] )
          for ( const side of [0, 1.5, -1.5] ) {
            const yaw    = which === "base" ? p.base.yaw : which === "top" ? p.top.yaw : p.masts[which].yaw;
            const w: V3  = [at[0] + Math.sin( yaw ) * along + Math.cos( yaw ) * side, at[1] + h, at[2] + Math.cos( yaw ) * along - Math.sin( yaw ) * side];
            const [x, y] = scr( w );
            if ( tool.pieceAt( chair(), x, y ) === which && tool.handleAt( x, y ) === null && !( eng.blGizmo as unknown as { pick( x: number, y: number ): unknown } ).pick( x, y ) ) return [x, y];
          }
      return null;
    };
    phase = "drag the base station";
    {
      // ( close enough that the station's bigger on screen than its handle )
      {
        const b        = pieces().base.at, t = pieces().top.at, d = Math.hypot( t[0] - b[0], t[2] - b[2] ) || 1;
        const side: V3 = [-( t[2] - b[2] ) / d, 0, ( t[0] - b[0] ) / d];
        eng.nav.lookAtUnity( [b[0] + side[0] * 30 - ( ( t[0] - b[0] ) / d ) * 10, b[1] + 14, b[2] + side[2] * 30 - ( ( t[2] - b[2] ) / d ) * 10], [b[0], b[1] + 3, b[2]] );
        await sleep( 800 );
      }
      const before = spots(), b = pieces().base.at;
      const spot   = onPiece( "base" );
      if ( !spot ) log( "  (no spot on the base station's body: FAIL)" );
      const [x, y] = spot ?? scr( [b[0], b[1] + 1, b[2]] );
      await drag( x, y, x - 180, y + 70, 900 );
      await sleep( 300 );
      const nb = pieces().base.at, moved = Math.hypot( nb[0] - b[0], nb[2] - b[2] );
      log( `base station dragged by its body ${moved.toFixed( 1 )} m${moved > 3 ? "" : " (FAIL)"}, on the ground (${( nb[1] - terrain.heightAt( nb[0], nb[2] ) ).toFixed( 2 )} m off); top and masts moved ${apart( spots(), before ).toFixed( 3 )} m${apart( spots(), before ) < 0.05 ? "" : " (FAIL)"}; still picked ${st().selection[0]?.uid === chair().uid ? "yes" : "no (FAIL)"}; undo step "${history.nextUndo}"` );
      await checkBox( "after the drag" );
    }
    await look();
    phase = "a gizmo on each piece";
    {
      const gz = eng.blGizmo as unknown as { pivot: { x: number; y: number; z: number }; pick( x: number, y: number ): { kind: string } | null };
      const on = ( at: V3 ) => Math.hypot( gz.pivot.x - at[0], gz.pivot.z + at[2] ) < 0.5;
      log( `gizmo on the base station (the piece last moved): ${on( pieces().base.at ) ? "yes" : "no (FAIL)"}` );
      // picked afresh by clicking one of its masts: the gizmo starts there
      {
        await key( "Escape" );
        await sleep( 300 );
        const spot = onPiece( 2 );
        if ( !spot ) log( "  (no spot on the third mast: FAIL)" );
        else {
          await click( ...spot, 300 );
          await sleep( 300 );
          const boxes = ( eng.objectsR as unknown as { boxes: THREE.Group } ).boxes, bc = new THREE.Box3().setFromObject( boxes ).getCenter( new THREE.Vector3() );
          const mm    = pieces().masts[2].at, boxOff = Math.hypot( bc.x - mm[0], -bc.z - mm[2] );
          log( `lift picked by a click on its third mast: ${st().selection[0]?.uid === chair().uid ? "picked" : "not picked (FAIL)"}, gizmo ${on( mm ) ? "on that mast" : "not on it (FAIL)"}, selection box ${boxOff < 5 ? "round it" : `${boxOff.toFixed( 0 )} m off (FAIL)`}` );
          await checkBox( "on the mast clicked" );
        }
      }
      // the top station clicked ( its handle ): the gizmo goes to it
      const t = pieces().top.at;
      await click( ...scr( [t[0], t[1] + 1, t[2]] ), 300 );
      await sleep( 300 );
      log( `top station clicked: gizmo ${on( pieces().top.at ) ? "on it" : "not on it (FAIL)"}` );
      await checkBox( "on the top station clicked" );
      // its arrow along the ground dragged: only the top station moves
      const p0                        = pieces(), [cx, cy] = scr( p0.top.at );
      let at: [number, number] | null = null;
      for ( let r = 20; r < 140 && !at; r += 6 )
        for ( let a = 0; a < 360 && !at; a += 15 ) {
          const x = cx + r * Math.cos( ( a * Math.PI ) / 180 ), y = cy + r * Math.sin( ( a * Math.PI ) / 180 ), h = gz.pick( x, y );
          if ( h && h.kind === "axis" ) at = [x, y];
        }
      if ( !at ) log( "  (no gizmo arrow found: FAIL)" );
      else {
        await drag( at[0], at[1], at[0] + 60, at[1] + 20, 800 );
        await sleep( 300 );
        const p1 = pieces(), db = Math.hypot( p1.base.at[0] - p0.base.at[0], p1.base.at[2] - p0.base.at[2] ), dt = Math.hypot( p1.top.at[0] - p0.top.at[0], p1.top.at[2] - p0.top.at[2] );
        log( `gizmo arrow dragged: top moved ${dt.toFixed( 1 )} m (on the ground ${( p1.top.at[1] - terrain.heightAt( p1.top.at[0], p1.top.at[2] ) ).toFixed( 2 )} m off), base ${db.toFixed( 2 )} m${dt > 1 && db < 0.01 ? "" : " (FAIL)"}; gizmo ${on( p1.top.at ) ? "went with it" : "left behind (FAIL)"}; undo step "${history.nextUndo}"` );
        await checkBox( "after the gizmo drag" );
        await key( "z", { ctrl: true } );
        await sleep( 300 );
        await checkBox( "after undo" );
      }
    }
    phase = "drag the top station";
    {
      const before = { ...chair().lift!.endPosition }, t = pieces().top.at;
      const [x, y] = scr( [t[0], t[1] + 1, t[2]] );
      await drag( x, y, x + 70, y + 25, 900 );
      await sleep( 300 );
      const e   = chair().lift!.endPosition, moved = Math.hypot( e.x - before.x, e.z - before.z );
      const top = pieces().top.at, ground = terrain.heightAt( top[0], top[2] );
      log( `top station dragged ${moved.toFixed( 1 )} m${moved > 3 ? "" : " (FAIL)"}; on the ground (${( top[1] - ground ).toFixed( 2 )} m off); undo step "${history.nextUndo}"` );
    }
    phase = "add and take away a mast";
    {
      const n0 = chair().lift!.masts.length, p = pieces();
      const a  = p.masts[1].at, b = p.masts[2].at, mid: V3 = [( a[0] + b[0] ) / 2 + 6, 0, ( a[2] + b[2] ) / 2];
      mid[1]   = terrain.heightAt( mid[0], mid[2] );
      await click( ...scr( mid ), 400, { ctrlKey: true } );
      await sleep( 300 );
      const n1 = chair().lift!.masts.length, at = liftPieces( chair() )!.masts.findIndex( ( m ) => Math.hypot( m.at[0] - mid[0], m.at[2] - mid[2] ) < 2 );
      log( `Ctrl+click on the ground: masts ${n0} -> ${n1}; the new one ${at === 2 ? "third, between the 2nd and 3rd (in order)" : `at ${at} (FAIL)`}; handles ${handles()}` );
      const m = liftPieces( chair() )!.masts[at].at;
      await click( ...scr( [m[0], m[1] + 1, m[2]] ), 300 );
      await key( "x" );
      await sleep( 300 );
      log( `picked mast, X: masts ${n1} -> ${chair().lift!.masts.length}; lift ${lifts().some( ( o ) => o.id === "chairlift" ) ? "still there" : "deleted (FAIL)"}; undo step "${history.nextUndo}"` );
    }
    phase = "auto masts";
    {
      const box = [...document.querySelectorAll<HTMLLabelElement>( ".props label" )].find( ( l ) => l.textContent?.trim() === "Auto" )?.querySelector( "input" );
      log( `Auto box: ${box ? ( box.checked ? "ticked (FAIL: an imported lift's masts are its own)" : "not ticked" ) : "missing (FAIL)"}` );
      box?.click();
      await sleep( 400 );
      const e       = chair().lift!.endPosition, len = Math.hypot( e.x, e.y, e.z );
      const spacing = [...document.querySelectorAll<HTMLElement>( ".props label" )].some( ( l ) => l.textContent?.trim() === "Spacing" );
      log( `Auto ticked: spacing ${chair().liftAuto} m, ${chair().lift!.masts.length} masts over ${len.toFixed( 0 )} m (every ~40 m: ${Math.floor( len / 40 )}); Spacing field ${spacing ? "shown" : "missing (FAIL)"}; handles ${handles()}` );
      const n0     = chair().lift!.masts.length, t = pieces().top.at;
      const [x, y] = scr( [t[0], t[1] + 1, t[2]] );
      await drag( x, y, x + 90, y - 50, 900 );
      await sleep( 300 );
      const e2   = chair().lift!.endPosition, len2 = Math.hypot( e2.x, e2.y, e2.z ), n1 = chair().lift!.masts.length;
      const gaps = [pieces().base.at, ...pieces().masts.map( ( m ) => m.at ), pieces().top.at].slice( 1 ).map( ( v, i, a ) => {
        const u = i === 0 ? pieces().base.at : a[i - 1];
        return Math.hypot( v[0] - u[0], v[2] - u[2] );
      } );
      log( `top dragged with Auto on: ${len.toFixed( 0 )} -> ${len2.toFixed( 0 )} m, masts ${n0} -> ${n1} (want ~${Math.floor( len2 / 40 )}); gaps ${Math.min( ...gaps ).toFixed( 0 )}..${Math.max( ...gaps ).toFixed( 0 )} m` );
      const mi       = 1, m = pieces().masts[mi].at, m0 = [...m];
      const [mx, my] = onPiece( mi ) ?? ( log( "  (no spot on the mast itself: FAIL)" ), scr( [m[0], m[1] + 1, m[2]] ) );
      await drag( mx, my, mx + 25, my + 15, 600 );
      const m1 = pieces().masts[mi].at;
      log( `a mast dragged by itself: moved ${Math.hypot( m1[0] - m0[0], m1[2] - m0[2] ).toFixed( 1 )} m${Math.hypot( m1[0] - m0[0], m1[2] - m0[2] ) > 1 ? "" : " (FAIL)"}` );
      await sleep( 300 );
      const box2 = [...document.querySelectorAll<HTMLLabelElement>( ".props label" )].find( ( l ) => l.textContent?.trim() === "Auto" )?.querySelector( "input" );
      log( `a mast dragged: Auto ${chair().liftAuto ? "still on (FAIL)" : "off"} (box ${box2?.checked ? "ticked (FAIL)" : "not ticked"}), masts ${chair().lift!.masts.length}; undo step "${history.nextUndo}"` );
    }
    phase = "orbit round the lifts";
    await drag( io.rc.width * 0.6, io.rc.height * 0.5, io.rc.width * 0.42, io.rc.height * 0.45, 900, 1 );
    phase = "a new chairlift";
    {
      await key( "Escape" );
      const catalog = [...document.querySelectorAll<HTMLElement>( ".catalog" )].find( ( c ) => c.textContent?.includes( "Lifts" ) );
      catalog?.click();
      await sleep( 300 );
      const card = [...document.querySelectorAll<HTMLElement>( ".card" )].find( ( c ) => c.textContent?.trim() === "Chairlift" );
      await waitFor( () => ( document.querySelectorAll( ".card .thumb img:not(.official)" ).length >= 3 ? true : null ), "the lifts' pictures", 30000 ).catch( () => null );
      const pics = [...document.querySelectorAll<HTMLImageElement>( ".card .thumb img:not(.official)" )].filter( ( i ) => i.naturalWidth > 0 ).length;
      log( `lift cards: ${pics} of 3 with their station's picture${pics === 3 ? "" : " (FAIL)"}` );
      await domShot( document.querySelector<HTMLElement>( ".area.assets" ), joinPath( dir, "lift-cards.png" ) );
      pressCard( card );
      await sleep( 300 );
      const b  = pieces().base.at, spot: V3 = [b[0] + 80, 0, b[2] - 60];
      spot[1]  = terrain.heightAt( spot[0], spot[2] );
      const n0 = lifts().length;
      await click( ...scr( spot ), 400 );
      await sleep( 500 );
      const fresh = lifts().find( ( o ) => Math.hypot( o.position[0] - spot[0], o.position[2] - spot[2] ) < 5 );
      // put down fresh: it's what's picked, its box round its base station ( its model only just in )
      if ( fresh ) {
        log( `fresh chairlift ${st().selection.length === 1 && st().selection[0].uid === fresh.uid ? "picked" : `not picked (selection ${st().selection.length})`}` );
        if ( st().selection[0]?.uid !== fresh.uid ) {
          st().setTool( "select" );
          st().setSelection( [{ kind: "object", uid: fresh.uid }] );
        }
        await checkBox( "on the fresh chairlift", st().objects.find( ( o ) => o.uid === fresh.uid )! );
        const t = liftPieces( fresh )!.top.at;
        st().setTool( "select" );
        await sleep( 200 );
        await click( ...scr( [t[0], t[1] + 1, t[2]] ), 300 );
        await checkBox( "on the fresh chairlift's top station clicked", st().objects.find( ( o ) => o.uid === fresh.uid )! );
      }
      log( `Lifts catalog ${catalog ? "there" : "missing (FAIL)"}, Chairlift card ${card ? "there" : "missing (FAIL)"}; placed: lifts ${n0} -> ${lifts().length}; ${fresh ? `${fresh.id}, ${Math.hypot( fresh.lift!.endPosition.x, fresh.lift!.endPosition.z ).toFixed( 0 )} m long, ${fresh.lift!.masts.length} masts, Auto ${fresh.liftAuto ? `${fresh.liftAuto} m` : "off (FAIL)"}, drawn ${drawn()}` : "not where clicked (FAIL)"}` );
    }
    phase = "idle";
    await sleep( 1200 );
    io.stop();
    for ( const line of io.report() ) log( line );
    await look();
    await ipc.writeBinary( joinPath( dir, "edited-lifts.png" ), await eng.pictures.capture() );
    log( "SHOT edited-lifts.png" );
    // kept: saved and opened again
    // ( numbers kept as 32-bit floats: the same to a millimetre )
    const flat = () => lifts().flatMap( ( o ) => [o.lift!.endPosition, ...o.lift!.masts].flatMap( ( v ) => [v.x, v.y, v.z] ) );
    const want = flat();
    await P.saveProject();
    await P.openProject( proj );
    await sleep( 2500 );
    const got = flat(), off = got.length === want.length ? Math.max( ...got.map( ( v, i ) => Math.abs( v - want[i] ) ) ) : Infinity;
    log( `reopened: ${lifts().length} lifts, ${off < 1e-3 ? "the same" : `changed by ${off} (FAIL)`}; drawn ${drawn()}` );
    // ---- a map with no terrain: a lift put down and its pieces moved all the same
    {
      await P.newUntitled();
      await sleep( 1500 );
      const io2 = realInput( eng, () => "no terrain" );
      st().setTool( "select" );
      useEditor.setState( { placeId: "chairlift", placeEntry: null, tool: "place" } );
      await sleep( 300 );
      eng.nav.lookAtUnity( [60, 90, -120], [0, 0, 0] );
      await sleep( 600 );
      await io2.click( ...io2.scr( [0, 0, 0] ), 300 );
      await sleep( 500 );
      const lift = st().objects.find( ( o ) => o.lift );
      log( `no terrain: chunks ${terrain.chunks.length}; lift placed ${lift ? "yes" : "no (FAIL)"}` );
      if ( lift ) await checkBox( "on the lift put down on no terrain", lift, eng.liftTool.pickedOf( lift.uid ) );
      if ( lift ) {
        st().setTool( "select" );
        st().setSelection( [{ kind: "object", uid: lift.uid }] );
        await sleep( 400 );
        const p0 = liftPieces( st().objects.find( ( o ) => o.uid === lift.uid )! )!, [x, y] = io2.scr( [p0.top.at[0], p0.top.at[1] + 1, p0.top.at[2]] );
        await io2.drag( x, y, x + 80, y + 40, 700 );
        await sleep( 300 );
        const p1 = liftPieces( st().objects.find( ( o ) => o.uid === lift.uid )! )!;
        const dt = Math.hypot( p1.top.at[0] - p0.top.at[0], p1.top.at[2] - p0.top.at[2] ), db = Math.hypot( p1.base.at[0] - p0.base.at[0], p1.base.at[2] - p0.base.at[2] );
        log( `no terrain: top station dragged ${dt.toFixed( 1 )} m (level ${( p1.top.at[1] - p0.top.at[1] ).toFixed( 2 )} m), base ${db.toFixed( 2 )} m${dt > 3 && db < 0.01 ? "" : " (FAIL)"}` );
      }
      io2.stop();
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
