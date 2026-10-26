import * as THREE from "three/webgpu";
import { type V3, toThree } from "../../core/coords";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, pressCard, realInput, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/wheels ): the lifts' wheels turning as the game turns them ( its stations' wheels
 * spun by the cable: a T-bar's bullwheel and sheaves, a rope tow's pulley; a chairlift's has none ). Each lift put
 * down from the Lifts catalog as a person does, then: its wheels found, turning in the view, at the game's rate
 * ( whole turns per 1000 m of cable ), and rolling with the cable where it runs round them ( its rim going the cable's
 * way ). Shots of each station.
**/
export async function wheelsSelftest( dir: string ) {
  try {
    const P = await import( "../../map/project" );
    await P.newUntitled();
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 1500 );
    const st  = () => useEditor.getState();
    let phase = "start";
    const io  = realInput( eng, () => phase );
    eng.nav.lookAtUnity( [40, 45, -70], [0, 0, 0] );
    await sleep( 600 );
    type W                                  = { mesh: THREE.Mesh; place: THREE.Matrix4; pivot: THREE.Vector3; axis: THREE.Vector3; cycles: number };
    type L                                  = { g: THREE.Group; speed: number; looks: Map<string, unknown>; wheels: Map<string, W[]> };
    const R                                 = eng.objectsR.lifts as unknown as { drawn: Map<string, L>; turnWheels( ws: W[], speed: number, t: number ): void };
    const matOf                             = ( w: W ) => w.mesh.matrix.clone();
    const ids                               = ["chairlift", "tbar", "ropetow"], names: Record<string, string> = { chairlift: "Chairlift", tbar: "T-Bar", ropetow: "Rope Tow" };
    // ( a chairlift's stations have none, its masts' sheaves do; a rope tow has no masts )
    const stations: Record<string, boolean> = { chairlift: false, tbar: true, ropetow: true  };
    const masts:    Record<string, boolean> = { chairlift: true,  tbar: true, ropetow: false };
    for ( let k = 0; k < ids.length; k++ ) {
      const id = ids[k], name = names[id];
      phase    = `put down a ${id}`;
      eng.nav.lookAtUnity( [40, 45, -70], [0, 0, 0] );
      await sleep( 400 );
      [...document.querySelectorAll<HTMLElement>( ".catalog" )].find( ( c ) => c.textContent?.includes( "Lifts" ) )?.click();
      await sleep( 300 );
      const card = [...document.querySelectorAll<HTMLElement>( ".card" )].find( ( c ) => c.textContent?.trim() === name );
      if ( !card ) {
        log( `${name} card: missing (FAIL)` );
        continue;
      }
      pressCard( card );
      await sleep( 200 );
      const n0 = st().objects.length, spot: V3 = [k * 40 - 40, 0, 0];
      await io.click( ...io.scr( spot ), 250 );
      const o = await waitFor( () => st().objects.find( ( x, i ) => i >= n0 && x.id === id ) ?? null, `the ${id}`, 5000 );
      // ( picked, a T-bar shows how far each bar's rope reels out: its Extension )
      if ( id === "tbar" ) {
        type G      = { line: THREE.LineSegments; bottom: number; reach: number };
        const guide = await waitFor( () => ( R.drawn.get( o.uid ) as unknown as { carriers: { guide: G | null } | null } | undefined )?.carriers?.guide ?? null, "the T-bar's reach", 30000 ).catch( () => null );
        const ext   = Number( o.params?.extension?.value ?? 3.5 );
        const pos   = guide?.line.geometry.attributes.position;
        const len   = pos ? pos.getY( 0 ) - pos.getY( 1 ) : NaN;
        log( `T-Bar picked: reach shown ${guide ? `${( pos!.count / 6 ).toFixed( 0 )} bars, ${len.toFixed( 2 )} m down (Extension ${ext} m)` : "no (FAIL)"}${guide && Math.abs( len - ext ) < 0.01 ? "" : " (FAIL)"}` );
        // its Extension typed into its panel, still picked: the reach follows straight away
        const field = ( [...document.querySelectorAll<HTMLElement>( ".bpanel label, .props label" )].find( ( x ) => x.textContent?.trim().toLowerCase() === "extension" )?.nextElementSibling?.querySelector<HTMLElement>( ".drag-num" ) ) ?? null;
        if ( field ) {
          field.dispatchEvent( new PointerEvent( "pointerdown", { bubbles: true, button: 0, buttons: 1, clientX: 5, clientY: 5 } ) );
          window.dispatchEvent( new PointerEvent( "pointerup", { bubbles: true, button: 0, clientX: 5, clientY: 5 } ) );
          field.dispatchEvent( new MouseEvent( "click", { bubbles: true } ) );
          await sleep( 200 );
          const inp = document.activeElement as HTMLInputElement | null;
          if ( inp?.tagName === "INPUT" ) {
            Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, "value" )!.set!.call( inp, "6" );
            inp.dispatchEvent( new Event( "input", { bubbles: true } )         );
            inp.dispatchEvent( new FocusEvent( "focusout", { bubbles: true } ) );
            inp.blur();
          }
          const reachNow = () => {
            const p = ( R.drawn.get( o.uid ) as unknown as { carriers: { guide: G | null } | null } | undefined )?.carriers?.guide?.line.geometry.attributes.position;
            return p ? p.getY( 0 ) - p.getY( 1 ) : NaN;
          };
          const got = await waitFor( () => ( Math.abs( reachNow() - 6 ) < 0.01 ? reachNow() : null ), "the new reach", 2000 ).catch( () => reachNow() );
          const now = st().objects.find( ( x ) => x.uid === o.uid )?.params?.extension?.value;
          log( `T-Bar Extension typed 6 (now ${now}), still picked: reach ${got.toFixed( 2 )} m down${Math.abs( got - 6 ) < 0.01 && st().selection.some( ( s ) => s.kind === "object" && s.uid === o.uid ) ? "" : " (FAIL)"}` );
        } else log( "T-Bar Extension field: missing (FAIL)" );
      }
      await io.key( "Escape" );
      // its pieces in the game's look ( the wheels come with them )
      const { liftPieces } = await import( "../../pieces/lift" );
      const hasMasts       = liftPieces( st().objects.find( ( x ) => x.uid === o.uid )! )!.masts.length > 0;
      const lift           = await waitFor( () => {
        const l = R.drawn.get( o.uid );
        return l && l.looks.has( "base" ) && l.looks.has( "top" ) && ( !hasMasts || l.looks.has( "mast" ) ) ? l : null;
      }, `the ${id}'s pieces in the game's look`, 30000 );
      lift.wheels ??= new Map();
      // ( a rope tow clicked on, then Ctrl+click on the ground: it has no masts, so none goes down, and the window carries on )
      if ( id === "ropetow" ) {
        const at = liftPieces( st().objects.find( ( x ) => x.uid === o.uid )! )!.base.at;
        await io.click( ...io.scr( [at[0], at[1] + 0.6, at[2]] ), 250 );
        await sleep( 400 );
        const picked = st().selection.some( ( x ) => x.kind === "object" && x.uid === o.uid ) && st().tool === "select";
        await io.click( ...io.scr( [at[0] + 8, at[1], at[2] + 20] ), 250, { ctrlKey: true } );
        await sleep( 600 );
        const now   = st().objects.find( ( x ) => x.uid === o.uid ), n = now?.lift?.masts.length;
        const alive = !!document.querySelector( ".workspaces" ) && !!document.querySelector( ".props, .bpanel" );
        log( `Rope Tow clicked on (${picked ? "picked" : "not picked (FAIL)"}), Ctrl+click on the ground: masts ${n ?? "gone"}${n === 0 ? "" : " (FAIL)"}; the window ${alive ? "carries on" : "gone grey (FAIL)"}` );
      }
      if ( id === "tbar" ) log( `T-Bar let go of: reach ${( lift as unknown as { carriers: { guide: unknown } | null } ).carriers?.guide ? "still shown (FAIL)" : "gone"}` );
      const all = [...lift.wheels.values()].flat();
      const per = [...lift.wheels.entries()].map( ( [part, ws] ) => `${part} ${ws.length}` ).join( ", " );
      const has = ( part: string ) => ( lift.wheels.get( part )?.length ?? 0 ) > 0;
      const ok  = has( "base" ) === stations[id] && has( "top" ) === stations[id] && has( "mast" ) === masts[id];
      log( `${name}: wheels ${per}${ok ? "" : " (FAIL)"}; cable ${lift.speed} m/s` );
      // looked at close, its base station
      phase    = `${id} looked at`;
      const pc = liftPieces( st().objects.find( ( x ) => x.uid === o.uid )! )!;
      const b  = pc.base.at;
      eng.nav.lookAtUnity( [b[0] + 4, b[1] + 4, b[2] - 6], [b[0], b[1] + 1.5, b[2]] );
      await sleep( 800 );
      if ( all.length ) {
        // turning in the view ( the frame loop ): the first wheel's matrix two frames apart
        const w0 = all[0], m1 = matOf( w0 );
        await io.frame();
        await io.frame();
        log( `  turning in the view: ${matOf( w0 ).equals( m1 ) ? "no (FAIL)" : "yes"}` );
        // at the game's rate: the turn between two moments, against whole turns per 1000 m of cable
        let worst = 0;
        for ( const w of all ) {
          const t = 12.345, dt = 0.01;
          R.turnWheels( [w], lift.speed, t );
          const a = matOf( w );
          R.turnWheels( [w], lift.speed, t + dt );
          const rel = matOf( w ).multiply( a.clone().invert() );
          const q   = new THREE.Quaternion().setFromRotationMatrix( rel );
          const got = 2 * Math.acos( Math.min( 1, Math.abs( q.w ) ) );
          const exp = Math.abs( 2 * Math.PI * w.cycles * lift.speed * dt / 1000 ) % ( 2 * Math.PI );
          worst     = Math.max( worst, Math.abs( got - Math.min( exp, 2 * Math.PI - exp ) ) );
        }
        log( `  rate: ${all.length} wheels, worst ${worst.toFixed( 4 )} rad off the game's in 10 ms${worst < 0.01 ? "" : " (FAIL)"}` );
        // rolling with the cable: each station's wheel where the cable comes in and goes out ( in towards the station,
        // out along the line ), its rim there going the cable's way
        const { liftStationEnds } = await import( "../../pieces/lift" );
        const ends                = liftStationEnds( st().objects.find( ( x ) => x.uid === o.uid )!, eng.lib.info( id )!.lift! )!;
        const S                   = new THREE.Matrix4().makeScale( 1, 1, -1 );
        for ( const part of ["base", "top"] as const ) {
          const ws = lift.wheels.get( part ) ?? [];
          if ( !ws.length ) continue;
          for ( const [k, e] of ends[part].entries() ) {
            const C    = toThree( e.at ), V = toThree( e.dir ).normalize().multiplyScalar( Math.sign( lift.speed ) );
            const near = ws.reduce( ( x, y ) => ( y.pivot.clone().applyMatrix4( S ).applyMatrix4( y.place ).distanceTo( C ) < x.pivot.clone().applyMatrix4( S ).applyMatrix4( x.place ).distanceTo( C ) ? y : x ) );
            const d    = near.pivot.clone().applyMatrix4( S ).applyMatrix4( near.place ).distanceTo( C );
            R.turnWheels( [near], lift.speed, 3 );
            const local = C.clone().applyMatrix4( matOf( near ).invert() );
            R.turnWheels( [near], lift.speed, 3.01 );
            const moved   = local.applyMatrix4( matOf( near ) ).sub( C );
            const along   = moved.clone().normalize().dot( V );
            const touches = d < 1.5;
            log( `  ${part} station, cable ${k ? "out" : "in"}: nearest wheel (${near.cycles} turns per 1000 m) ${d.toFixed( 2 )} m from it${touches ? `, its rim going ${( moved.length() / 0.01 ).toFixed( 2 )} m/s ${along > 0.7 ? "with the cable" : along < -0.7 ? "against the cable (FAIL)" : `across the cable (${along.toFixed( 2 )}) (FAIL)`}` : " (not on it)"}` );
          }
        }
        // turned round from the game's way: only where it runs against the cable
        const baked  = ( await ipc.gameSpins() ) as Record<string, { cycles: number }[]>;
        const turned = [...lift.wheels.entries()].map( ( [part, ws] ) => {
          const was = new Set( ( baked[`${id}:${part}`] ?? [] ).map( ( x ) => x.cycles ) );
          return `${part} ${ws.filter( ( w ) => !was.has( w.cycles ) ).length}`;
        } );
        log( `  turned round from the game's: ${turned.join( ", " )}` );
      }
      phase = `${id} shot`;
      await ipc.writeBinary( joinPath( dir, `${id}-base.png` ), await eng.pictures.capture() );
      log( `  SHOT ${id}-base.png` );
      // frames while they turn, the view still
      phase = `${id} turning`;
      await sleep( 3000 );
    }
    io.stop();
    for ( const line of io.report() ) log( line );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
