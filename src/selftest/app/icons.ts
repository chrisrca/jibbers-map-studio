import { log, sleep } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/icons ): every icon on a sheet over the window, to look at.
**/
export async function iconSheet() {
  const React                = await import( "react"                  );
  const { createRoot }       = await import( "react-dom/client"       );
  const { Icon, ICON_NAMES } = await import( "../../ui/widgets/icons" );
  const el                   = document.createElement( "div" );
  el.style.cssText           = "position:fixed;inset:0;z-index:9999;background:#232323;color:#d8d8d8;padding:16px;display:grid;grid-template-columns:repeat(8,1fr);gap:8px;font:11px sans-serif;overflow:auto";
  document.body.appendChild( el );
  createRoot( el ).render(
    ICON_NAMES.map( ( n ) =>
      React.createElement( "div", { key: n, style: { display: "flex", alignItems: "center", gap: 8, padding: 6, background: "#2c2c2c", borderRadius: 4 } },
        React.createElement( Icon, { name: n, size: 16 } ),
        React.createElement( Icon, { name: n, size: 40 } ),
        n,
      ),
    ),
  );
  await sleep( 800 );
  log( "ICONS READY" );
  await sleep( 10000 );
  el.remove();
  log( "SELFTEST OK" );
}
