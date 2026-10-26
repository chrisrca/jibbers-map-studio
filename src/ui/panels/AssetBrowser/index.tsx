// The asset panel: the library's folders on the left ( the folders its files are in ), their objects or materials as
// a grid of previews. Objects are dragged into the scene; materials are dragged onto a surface.

import { useEffect, useMemo, useState } from "react";
import { type LibraryEntry, ipc } from "../../../core/ipc";
import { useEditor } from "../../../map/store";
import { loadLibrary, placeEntry } from "../../../pieces/library";
import { mapMaterials, materialKey, materialName, pickAndImportMaterials } from "../../../pieces/userAssets";
import { pickAndImportAny } from "../../importAny";
import { entryObject } from "../../previews";
import { getEngine } from "../../Viewport";
import { Icon } from "../../widgets/icons";
import { LIFT_NAMES, LiftCard, MapMaterialCard, MaterialCard, MeshCard, PreviewsPending } from "./cards";
import { LibraryMapsDialog } from "./LibraryMapsDialog";

// A folder in the catalog tree ( three levels deep ), with how many items are under it.
type Catalog = { path: string; name: string; depth: number; count: number };

const folderOf = ( e: LibraryEntry ) => e.folder || "Other";

function catalogsOf( entries: LibraryEntry[] ): Catalog[] {
  const counts = new Map<string, number>();
  for ( const e of entries ) {
    const parts = folderOf( e ).split( "/" ).filter( Boolean );
    for ( let i = 1; i <= Math.min( parts.length, 3 ); i++ ) {
      const k = parts.slice( 0, i ).join( "/" );
      counts.set( k, ( counts.get( k ) ?? 0 ) + 1 );
    }
  }
  return [...counts.entries()]
    .sort( ( a, b ) => a[0].localeCompare( b[0] ) )
    .map( ( [path, count] ) => ( { path, name: path.split( "/" ).pop()!, depth: path.split( "/" ).length - 1, count } ) );
}

/**
 * Blender's asset browser: catalogs on the left, the library's pieces ( or materials ) as tiles.
**/
export function AssetBrowser() {
  const library                 = useEditor( ( s ) => s.assetLibrary  );
  const customObjects           = useEditor( ( s ) => s.customObjects );
  const placeEntryId            = useEditor( ( s ) => s.placeEntry    );
  const placeId                 = useEditor( ( s ) => s.placeId       );
  const placeholders            = useEditor( ( s ) => s.placeholders  );
  const lifts                   = useMemo( () => placeholders.filter( ( p ) => p.lift ).map( ( p ) => p.id ), [placeholders] );
  const tool                    = useEditor( ( s ) => s.tool );
  const [tab,      setTab     ] = useState<"mesh" | "material">( "mesh" );
  const [q,        setQ       ] = useState( "" );
  const [cat,      setCat     ] = useState( "" );
  const [mapsOpen, setMapsOpen] = useState( false );

  useEffect( () => {
    loadLibrary();
  }, [] );

  // the place tool puts down the chosen library piece; the real piece follows the cursor meanwhile
  useEffect( () => {
    const eng = getEngine();
    if ( !eng ) return;
    eng.placing.onPlaceEntry = ( id, at, rot ) => placeEntry( id, at, rot );
    const entry              = tool === "place" && placeEntryId ? library.find( ( e ) => e.id === placeEntryId ) : null;
    if ( !entry ) return;
    let alive = true;
    entryObject( entry ).then( ( g ) => alive && eng.placing.setLibraryGhost( g ) );
    return () => {
      alive = false;
      eng.placing.setLibraryGhost( null );
    };
  }, [tool, placeEntryId, library] );

  const ql       = q.toLowerCase();
  const ofTab    = useMemo( () => library.filter( ( e ) => e.kind === tab ), [library, tab] );
  const catalogs = useMemo( () => catalogsOf( ofTab ),                       [ofTab]        );
  // folder by folder, as the tree lists them
  const shown    = useMemo(
    () =>
      ofTab
        .filter( ( e ) => ( !ql || e.name.toLowerCase().includes( ql ) ) && ( !cat || folderOf( e ) === cat || folderOf( e ).startsWith( `${cat}/` ) ) )
        .sort( ( a, b ) => folderOf( a ).localeCompare( folderOf( b ) ) || a.name.localeCompare( b.name, undefined, { numeric: true } ) ),
    [ofTab, ql, cat],
  );
  // materials the open map uses that aren't in the library ( e.g. from another imported map )
  const mapMats = useMemo( () => {
    if ( tab !== "material" || ( cat && cat !== "In this map" ) ) return [];
    const known = new Set( library.filter( ( e ) => e.material ).map( ( e ) => materialKey( e.material! ) ) );
    return mapMaterials( customObjects ).filter( ( m ) => !known.has( m.key ) && ( !ql || materialName( m.material ).toLowerCase().includes( ql ) ) );
  }, [tab, library, customObjects, ql, cat] );
  const switchTab = ( t: "mesh" | "material" ) => {
    setTab( t );
    setCat( "" );
  };

  return (
    <>
      <div className="area-header">
        <span className="editor-icon" title="Asset browser"><Icon name="assets" /></span>
        <div className="seg">
          <button className={tab === "mesh" ? "on" : ""} onClick={() => switchTab( "mesh" )}><Icon name="cube" size={14} /> Objects</button>
          <button className={tab === "material" ? "on" : ""} onClick={() => switchTab( "material" )}><Icon name="paintSnow" size={14} /> Materials</button>
        </div>
        <label className="search">
          <Icon name="search" size={13} />
          <input placeholder={tab === "mesh" ? "Search objects" : "Search materials"} value={q} onChange={( e ) => setQ( e.target.value )} />
        </label>
        <PreviewsPending />
        <span style={{ flex: 1 }} />
        <button className="btn ghost" title="Show your library in Explorer" onClick={() => ipc.showLibraryFolder()}><Icon name="folderOpen" size={14} /> Folder</button>
        { tab === "mesh" ? (
          <>
            <button className="btn ghost" title="Maps (.jbrmap), 3D models and images — or drop them on the window" onClick={() => pickAndImportAny()}><Icon name="import" size={14} /> Import</button>
            <button className="btn ghost" title="Add every piece a map uses to your library" onClick={() => setMapsOpen( true )}><Icon name="libraryAdd" size={14} /> Maps</button>
          </>
        ) : (
          <button className="btn ghost" title="Make a material from an image" onClick={() => pickAndImportMaterials().then( loadLibrary )}><Icon name="plus" size={14} /> From image</button>
        ) }
      </div>
      <div className="assets-main">
        <div className="catalogs">
          <div className={`catalog ${cat === "" ? "on" : ""}`} onClick={() => setCat( "" )}>
            <Icon name="assets" size={14} />
            <span className="name">All</span>
            <span className="count">{ofTab.length}</span>
          </div>
          { catalogs.map( ( c ) => (
            <div key={c.path} className={`catalog ${cat === c.path ? "on" : ""}`} style={{ ["--indent" as string]: `${c.depth * 14}px` }} onClick={() => setCat( c.path )}>
              <Icon name="folder" size={14} />
              <span className="name">{c.name}</span>
              <span className="count">{c.count}</span>
            </div>
          ) ) }
          { tab === "mesh" && lifts.length > 0 && (
            <div className={`catalog ${cat === "Lifts" ? "on" : ""}`} onClick={() => setCat( "Lifts" )}>
              <Icon name="folder" size={14} />
              <span className="name">Lifts</span>
              <span className="count">{lifts.length}</span>
            </div>
          ) }
          { tab === "material" && (
            <div className={`catalog ${cat === "In this map" ? "on" : ""}`} onClick={() => setCat( "In this map" )}>
              <Icon name="mountain" size={14} />
              <span className="name">In this map</span>
            </div>
          ) }
        </div>
        <div className="grid">
          {tab === "mesh" && ( cat === "" || cat === "Lifts" ) && lifts.filter( ( id ) => !ql || ( LIFT_NAMES[id] ?? id ).toLowerCase().includes( ql ) ).map( ( id ) => <LiftCard key={id} id={id} on={tool === "place" && placeId === id} /> )}
          { tab === "mesh"
            ? cat !== "Lifts" && shown.map( ( e ) => <MeshCard key={e.id} e={e} on={tool === "place" && placeEntryId === e.id} /> )
            : cat !== "In this map" && shown.map( ( e ) => <MaterialCard key={e.id} e={e} /> ) }
          {mapMats.map( ( m ) => <MapMaterialCard key={m.key} m={m} /> )}
          {shown.length + mapMats.length === 0 && <div className="muted" style={{ padding: 8 }}>Nothing here{q ? ` matches “${q}”` : ""}.</div>}
        </div>
      </div>
      {mapsOpen && <LibraryMapsDialog onClose={() => setMapsOpen( false )} />}
    </>
  );
}
