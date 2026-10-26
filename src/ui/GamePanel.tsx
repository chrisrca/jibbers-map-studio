import { Icon } from "./widgets/icons";
import { useEffect, useRef, useState } from "react";
import { ipc } from "../core/ipc";
import { playInGame } from "../map/project";
import { useEditor } from "../map/store";

type Status = "notRunning" | "running" | "embedded";

/**
 * Physical-pixel rect of `el` in the window's client area ( the webview fills it ).
**/
function areaOf( el: HTMLElement ) {
  const r = el.getBoundingClientRect();
  const d = window.devicePixelRatio;
  return { x: Math.round( r.left * d ), y: Math.round( r.top * d ), w: Math.round( r.width * d ), h: Math.round( r.height * d ) };
}

/**
 * The Game tab: the running Jibbers window is pulled in over this panel's area ( see src-tauri/src/game/embed.rs ).
 * What's rendered here only shows when the game isn't inside.
**/
export function GamePanel( { active }: { active: boolean } ) {
  const host                = useRef<HTMLDivElement>( null );
  const [status, setStatus] = useState<Status>( "notRunning" );
  const poppedOut           = useEditor( ( s ) => s.gamePoppedOut );
  const launch              = useEditor( ( s ) => s.gameLaunch    );
  const [, tick]            = useState( 0 );

  // the launch indicator ends when the game is there ( or gives up after a while ); elapsed time ticks meanwhile
  useEffect( () => {
    if ( !launch ) return;
    if ( launch.started && ( status === "embedded" || ( poppedOut && status === "running" ) ) ) {
      useEditor.setState( { gameLaunch: null } );
      return;
    }
    const t = setInterval( () => {
      if ( Date.now() - launch.since > 3 * 60_000 ) useEditor.setState( { gameLaunch: null } );
      else tick( ( n ) => n + 1 );
    }, 1000 );
    return () => clearInterval( t );
  }, [launch, status, poppedOut] );

  useEffect( () => {
    if ( !active || poppedOut ) {
      ipc.gameSetVisible( false );
      return;
    }
    let stopped  = false;
    let embedded = false;
    let last     = 0;
    const place  = async () => {
      if ( stopped || !host.current ) return;
      const ok = await ipc.gameAttach( areaOf( host.current ) );
      if ( stopped ) return;
      if ( ok && !embedded ) await ipc.gameSetVisible( true ); // first time in ( or back to this tab ): show + focus
      embedded = ok;
      setStatus( ok ? "embedded" : await ipc.gameStatus() );
    };
    const ro = new ResizeObserver( () => place() );
    let poll = 0;
    // First say the Game tab wants the game ( a game window is only pulled in while it's wanted, so a pull still on
    // its way after "Pop out" can't take it back ), then pull it in. The poll picks up a game that's still starting,
    // notices when it closes, and puts the window back in place if the game moves it ( it re-centres itself when
    // the game link changes its resolution ).
    ipc.gameSetVisible( true ).finally( () => {
      if ( stopped || !host.current ) return;
      place();
      ro.observe( host.current );
      // ( quickly while the game is starting, so its window is pulled in the moment it's there )
      poll = window.setInterval( () => {
        if ( useEditor.getState().gameLaunch || Date.now() - last >= 1000 ) { last = Date.now(); place(); }
      }, 100 );
    } );
    return () => {
      stopped = true;
      ro.disconnect();
      clearInterval( poll );
      ipc.gameSetVisible( false );
    };
  }, [active, poppedOut] );

  // Release the game if the panel goes away ( project closed ).
  useEffect( () => () => void ipc.gameRelease(), [] );

  return (
    <div className="game-panel" ref={host} style={{ visibility: active ? "visible" : "hidden" }}>
      <div className="game-empty">
        { launch && status !== "embedded" ? (
          <div className="game-launch">
            <div className="spinner" />
            <p>{launch.stage}</p>
            { launch.progress !== null ? (
              <div className="progress"><div style={{ width: `${Math.round( launch.progress * 100 )}%` }} /></div>
            ) : (
              <p className="muted">{Math.floor( ( Date.now() - launch.since ) / 1000 )} s</p>
            ) }
          </div>
        ) : poppedOut ? (
          <>
            <p>Jibbers is in its own window.</p>
            <button onClick={() => useEditor.setState( { gamePoppedOut: false } )}>Bring it back in here</button>
          </>
        ) : status === "notRunning" ? (
          <>
            <p>Jibbers isn't running.</p>
            <button className="primary" onClick={() => playInGame()}><Icon name="play" size={12} /> Play this map here (F5)</button>
          </>
        ) : (
          <p>Waiting for the Jibbers window…</p>
        ) }
      </div>
    </div>
  );
}

/**
 * Header above the game while the Game workspace is showing ( its controls can't sit over the game window ).
**/
export function GameHeader() {
  const poppedOut = useEditor( ( s ) => s.gamePoppedOut );
  return (
    <div className="vp-header">
      <span className="editor-icon" title="Game"><Icon name="game" /></span>
      <b>Jibbers</b>
      <span className="muted">Click into the game to control it · Ctrl+Tab back to the editor</span>
      <span style={{ flex: 1 }} />
      <button
        className="btn small"
        title="Close Jibbers (it keeps running in the background otherwise). Play starts it again."
        onClick={() => {
          useEditor.setState( { gameLaunch: null } );
          ipc.gameClose().then( () => useEditor.getState().toast( "Closed Jibbers", "info" ) ).catch( ( e ) => useEditor.getState().toast( String( e ), "error" ) );
        }}
      >
        <Icon name="close" size={12} /> Close game
      </button>
      <button
        className="btn small"
        style={{ marginLeft: 4 }}
        title={poppedOut ? "Put the game back inside the studio" : "Move the game to its own window"}
        onClick={() => {
          if ( !poppedOut ) ipc.gamePopOut();
          useEditor.setState( { gamePoppedOut: !poppedOut } );
        }}
      >
        <Icon name="popOut" size={13} /> {poppedOut ? "Bring back in" : "Pop out"}
      </button>
    </div>
  );
}
