import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./app/styles.css";
import { invoke } from "@tauri-apps/api/core";
import { installTooltips } from "./ui/widgets/widgets";
import { bootMark } from "./core/ipc";

bootMark( "page: script running" );

// Mirror errors and warnings to the Rust console ( visible in the `tauri dev` terminal ).
for ( const level of ["error", "warn"] as const ) {
  const orig     = console[level].bind( console );
  console[level] = ( ...args: unknown[] ) => {
    orig( ...args );
    const msg = args.map( ( a ) => ( a instanceof Error ? `${a.message}
${a.stack}` : typeof a === "string" ? a : JSON.stringify( a ) ) ).join( " " );
    invoke( "frontend_log", { level, message: msg.slice( 0, 4000 ) } ).catch( () => {} );
  };
}
window.addEventListener( "error",              ( e ) => console.error( "uncaught:",            e.message,          e.error?.stack ?? ""  ) );
window.addEventListener( "unhandledrejection", ( e ) => console.error( "unhandled rejection:", String( e.reason ), e.reason?.stack ?? "" ) );

installTooltips();
// the app's context menu is its own; the browser's ( Back, Reload, Inspect… ) has no place in an editor
window.addEventListener( "contextmenu", ( e ) => {
  if ( !( e.target as HTMLElement )?.closest?.( "input, textarea" ) ) e.preventDefault();
} );

createRoot( document.getElementById( "root" )! ).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
