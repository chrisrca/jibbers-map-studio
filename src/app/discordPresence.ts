// The Discord status: the map being edited and the mode it's in ( through the Discord app, when it runs ), unless it's
// turned off in the Help menu.
import { discordPresence } from "../core/ipc";
import { isUntitled } from "../map/project";
import { useEditor, workspaceOf } from "../map/store";
import { plainText } from "../ui/widgets/RichText";

const KEY = "jibbers.discord";

export const discordShown = () => {
  try {
    return localStorage.getItem( KEY ) !== "off";
  } catch {
    return true;
  }
};

export function setDiscordShown( on: boolean ) {
  try {
    localStorage.setItem( KEY, on ? "on" : "off" );
  } catch {
    // ( shown as chosen this time )
  }
  show();
}

// ( Discord wants 2 to 128 characters )
const fit = ( s: string ) => ( s.length > 128 ? `${s.slice( 0, 127 )}…` : s.padEnd( 2, " " ) );

function show() {
  if ( !discordShown() ) return discordPresence( null, null );
  const s       = useEditor.getState();
  const ws      = workspaceOf( s.tool );
  const name    = s.map && !isUntitled( s.projectDir ) ? plainText( s.map.name ) : "";
  const details = s.centerTab === "game" ? ( name ? `Riding ${name}` : "Riding a new map" ) : ws === "assets" ? "Making an asset" : name ? `Editing ${name}` : "Editing a new map";
  const state   = s.centerTab === "game" ? "" : { layout: "Object Mode", sculpting: "Terrain Mode", painting: "Paint Mode", assets: "Assets" }[ws];
  discordPresence( fit( details ), state );
}

/**
 * Kept up to date while the studio runs.
**/
export function startDiscordPresence() {
  show();
  return useEditor.subscribe( ( s, p ) => {
    if ( s.tool !== p.tool || s.centerTab !== p.centerTab || s.map?.name !== p.map?.name || s.projectDir !== p.projectDir ) show();
  } );
}
