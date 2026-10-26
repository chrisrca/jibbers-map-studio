// Maps whose custom pieces and materials are in your library.

import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { ipc } from "../../../core/ipc";
import { useEditor } from "../../../map/store";
import { loadLibrary } from "../../../pieces/library";
import { resetLibraryPreviews } from "../../previews";
import { TrashIcon } from "../../widgets/controls";

/**
 * Maps whose custom pieces and materials are in your library: any .jbrmap you have ( e.g. MLNZ Park from your game's
 * Maps folder ). Adding one takes its pieces into a folder of its own there; removing it deletes that folder.
**/
export function LibraryMapsDialog( { onClose }: { onClose: () => void } ) {
  const [maps, setMaps] = useState<{ path: string; label: string }[] | null>( null );
  const [busy, setBusy] = useState<string | null>( null );
  const refresh         = () => ipc.listLibraryMaps().then( setMaps ).catch( () => setMaps( [] ) );
  useEffect( () => void refresh(), [] );

  const change = async ( path: string, add: boolean, label: string ) => {
    setBusy( add ? `Adding the pieces from ${label}…` : `Removing ${label}…` );
    try {
      const n = await ipc.setLibraryMap( path, add );
      resetLibraryPreviews();
      await loadLibrary();
      await refresh();
      useEditor.getState().toast( add ? `Added ${n} pieces from ${label}` : `Removed ${label}`, "success" );
    } catch ( e ) {
      useEditor.getState().toast( `Couldn't change the library: ${e}`, "error" );
    } finally {
      setBusy( null );
    }
  };
  const add = async () => {
    const info = await ipc.appInfo().catch( () => null );
    const file = await open( { title: "Take the pieces from a map", defaultPath: info?.mapsDir, filters: [{ name: "Jibbers map", extensions: ["jbrmap"] }] } );
    if ( typeof file === "string" ) await change( file, true, file.split( /[\\/]/ ).pop()!.replace( /\.jbrmap$/, "" ) );
  };

  return (
    <div className="modal-back" onMouseDown={( e ) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ width: "min(560px, 94vw)" }}>
        <h2>Pieces from maps</h2>
        { maps === null ? (
          <div className="note">Loading…</div>
        ) : maps.length === 0 ? (
          <div className="note">No maps added yet.</div>
        ) : (
          maps.map( ( m ) => (
            <div key={m.path} className="row" style={{ justifyContent: "space-between" }}>
              <span title={m.path}>{m.label}</span>
              <button className="btn" disabled={!!busy} title="Take this map's pieces out of the library" onClick={() => change( m.path, false, m.label )}>
                <TrashIcon />
              </button>
            </div>
          ) )
        ) }
        { busy && (
          <div className="note">
            <span className="spinner-inline" /> {busy}
          </div>
        ) }
        <div className="actions">
          <button className="btn" disabled={!!busy} onClick={onClose}>Close</button>
          <button className="btn primary" disabled={!!busy} onClick={add}>Add a map…</button>
        </div>
      </div>
    </div>
  );
}
