// Files dragged in from Explorer: where they're let go says what happens, and while they're held over the window each
// place they can go shows what it'll do.
//  - The view: a map is opened in place of yours ( you're asked about saving yours first, or can cancel ), and its
//    pieces and materials are added to your library; a model is put down where it's let go and kept in My imports;
//    an image becomes a material, put on the piece it's let go on and kept in My materials.
//  - The asset bar: added to your library and nothing else ( a map's pieces and materials, a model, an image as a
//    material ).
// Where pieces are edited on their own ( Modeling, Materials ) the view adds to the library too: there's no map there
// to put things in. Painting with the Decal tool, an image let go on the view is the decal.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";
import { ipc, type UserMaterial } from "../core/ipc";
import { applyMaterial, loadLibrary, placeEntry, userPath } from "../pieces/library";
import { useEditor } from "../map/store";
import { IMAGE_EXTENSIONS, importAssetFiles, importMaterialFiles, MODEL_EXTENSIONS } from "../pieces/userAssets";
import { pickAndImportMap } from "./dialogs/Dialogs";
import { Icon } from "./widgets/icons";
import { resetLibraryPreviews } from "./previews";
import { getEngine } from "./Viewport";

type Kind = "map"  | "model" | "image";
type Zone = "view" | "dock";

// A place files can go, and where it is on the page.
type DropZone = { zone: Zone; rect: DOMRect };

const ext    = ( p: string ) => p.split( "." ).pop()?.toLowerCase() ?? "";
const kindOf = ( p: string ): Kind | null =>
  ext( p ) === "jbrmap" ? "map" : MODEL_EXTENSIONS.includes( ext( p ) ) ? "model" : IMAGE_EXTENSIONS.includes( ext( p ) ) ? "image" : null;
export const mapName = ( p: string ) => p.split( /[\\/]/ ).pop()!.replace( /\.jbrmap$/i, "" );
const same           = ( a: string, b: string ) => a.replace( /\//g, "\\" ).toLowerCase() === b.replace( /\//g, "\\" ).toLowerCase();

/**
 * Whether the view puts things in the map ( not where pieces are edited on their own ).
**/
const viewPlaces = () => {
  const t = useEditor.getState().tool;
  return t !== "model" && t !== "material";
};

/**
 * Whether the Decal tool is out ( an image let go on the view is its image ).
**/
const decalOut = () => {
  const s = useEditor.getState();
  return s.tool === "material" && s.materialMode === "paint" && s.paint.texTool === "decal";
};

/**
 * The place under a point of the window that files can be let go on.
**/
function zoneAt( x: number, y: number ): Zone | null {
  // ( the start window not counted: it's closed as files come in, and may not be gone yet )
  const el = ( document.elementsFromPoint( x, y ) as HTMLElement[] ).find( ( e ) => !e.closest( ".splash-back" ) ) ?? null;
  if ( el?.closest( ".area.assets" ) ) return "dock";
  if ( el?.closest( ".viewport"    ) || !useEditor.getState().projectDir ) return "view";
  return null;
}

/**
 * What letting `kinds` go on `zone` does: an icon and a few words for each.
**/
function actions( zone: Zone, kinds: Kind[] ): { icon: string; text: string }[] {
  if ( zone === "view" && decalOut() && kinds.includes( "image" ) ) return [{ icon: "image", text: "Use as decal" }];
  if ( zone === "dock" || !viewPlaces() ) return [{ icon: "libraryAdd", text: "Add to library" }];
  const out: { icon: string; text: string }[] = [];
  if ( kinds.includes( "map"   ) ) out.push( { icon: "folderOpen", text: "Open map"       } );
  if ( kinds.includes( "model" ) ) out.push( { icon: "place",      text: "Place"          } );
  if ( kinds.includes( "image" ) ) out.push( { icon: "texture",    text: "Apply material" } );
  return out;
}

/**
 * A map's custom pieces and materials added to your library.
**/
export async function addMapToLibrary( path: string ) {
  const st = useEditor.getState();
  try {
    const n = await ipc.setLibraryMap( path, true );
    resetLibraryPreviews();
    await loadLibrary();
    st.toast( `Added the pieces and materials from “${mapName( path )}” to your library (${n} meshes)`, "success" );
  } catch ( e ) {
    // ( a map whose pieces you have already: said so, it's not a failure )
    if ( String( e ).includes( "already in your library" ) ) st.toast( `The pieces from “${mapName( path )}” are already in your library`, "info" );
    else st.toast( `Couldn't add it: ${e}`, "error" );
  }
}

/**
 * Files let go on the asset bar: into your library.
**/
async function toLibrary( paths: string[] ) {
  for ( const p of paths.filter( ( p ) => kindOf( p ) === "map" ) ) await addMapToLibrary( p );
  await importAssetFiles( paths.filter( ( p ) => kindOf( p ) === "model" ) );
  await importMaterialFiles( paths.filter( ( p ) => kindOf( p ) === "image" ) );
  await loadLibrary();
}

/**
 * Files let go on the view at ( x, y ).
**/
async function toView( paths: string[], x: number, y: number ) {
  if ( !viewPlaces() ) return toLibrary( paths );
  const st  = useEditor.getState();
  const map = paths.find( ( p ) => kindOf( p ) === "map" );
  if ( map ) {
    // opened in place of yours ( asked about yours first: kept, let go, or the drop called off ), then its pieces into
    // your library; anything else let go with it goes to the library
    const before = st.projectDir;
    await pickAndImportMap( map, mapName( map ) );
    if ( useEditor.getState().projectDir === before ) return;
    await addMapToLibrary( map );
    const rest = paths.filter( ( p ) => p !== map && kindOf( p ) !== "map" );
    if ( rest.length ) await toLibrary( rest );
    return;
  }
  const eng               = getEngine();
  // models: each kept in My imports and put down where they were let go, side by side
  const at                = eng?.placing.libraryPlacementAt( x, y ) ?? null;
  let edge: number | null = null;
  for ( const p of paths.filter( ( p ) => kindOf( p ) === "model" ) ) {
    const a = await importAssetFiles( [p] );
    if ( !a ) continue;
    await loadLibrary();
    const e = useEditor.getState().assetLibrary.find( ( e ) => e.id.startsWith( "user:" ) && same( userPath( e ), a.path ) );
    // ( the first where it was let go, each next a metre past the one before )
    const w = a.size[0], dx: number = edge === null ? 0 : edge + 1 + w / 2;
    edge    = dx + w / 2;
    if ( e && at ) await placeEntry( e.id, [at.pos[0] + dx, at.pos[1], at.pos[2]], at.rot );
  }
  // images: each a material in My materials; the first put on the piece it was let go on
  const images = paths.filter( ( p ) => kindOf( p ) === "image" );
  if ( images.length ) {
    const hit                  = eng?.surfaceAt( x, y ) ?? null;
    const made: UserMaterial[] = [];
    for ( const p of images ) {
      try {
        const m = await ipc.importMaterialImage( p );
        made.push( m );
        st.toast( `Added material “${m.name}”`, "success" );
      } catch ( e ) {
        st.toast( `Couldn't make a material from ${p.split( /[\\/]/ ).pop()}: ${e}`, "error" );
      }
    }
    await ( await import( "../pieces/userAssets" ) ).loadUserMaterials();
    await loadLibrary();
    const first = made[0] && useEditor.getState().assetLibrary.find( ( e ) => e.id.startsWith( "user:" ) && same( userPath( e ), made[0].path ) );
    if ( first && hit?.kind === "custom" ) await applyMaterial( { kind: "library", entryId: first.id }, hit, false );
  }
}

/**
 * Files let go at ( x, y ) on the window.
**/
export async function dropFiles( paths: string[], x: number, y: number ) {
  const known = paths.filter( ( p ) => kindOf( p ) );
  if ( known.length < paths.length )
    useEditor.getState().toast( `Skipped ${paths.length - known.length} file(s) the studio can't take (maps, .glb/.gltf/.obj models and .png/.jpg images)`, "error" );
  if ( !known.length ) return;
  const zone  = zoneAt( x, y );
  const image = known.find( ( p ) => kindOf( p ) === "image" );
  if ( zone === "view" && decalOut() && image ) await ( await import( "../texture/stencil" ) ).loadDecal( image );
  else if ( zone === "dock" ) await toLibrary( known );
  else if ( zone === "view" ) await toView( known, x, y );
}

/**
 * While files are held over the window: each place they can go outlined, with what letting them go there does ( the
 * one under the cursor lit ). And their drop, wherever they're let go.
**/
export function FileDropZones() {
  const [held, setHeld] = useState<{ kinds: Kind[]; x: number; y: number } | null>( null );
  useEffect( () => {
    // ( the window's positions are in its pixels: the page's are those over its scale )
    const at          = ( p: { x: number; y: number } ) => ( { x: p.x / devicePixelRatio, y: p.y / devicePixelRatio } );
    let kinds: Kind[] = [];
    const off         = getCurrentWebview().onDragDropEvent( ( e ) => {
      const d = e.payload;
      if ( d.type === "enter" ) {
        kinds = [...new Set( d.paths.map( kindOf ).filter( ( k ): k is Kind => !!k ) )];
        // ( the start window out of the way: it's over the view and the asset bar )
        if ( kinds.length ) useEditor.setState( { splash: false } );
        setHeld( { kinds, ...at( d.position ) } );
      } else if ( d.type === "over" ) setHeld( ( h ) => ( h ? { ...h, ...at( d.position ) } : { kinds, ...at( d.position ) } ) );
      else if ( d.type === "leave" ) setHeld( null );
      else if ( d.type === "drop" ) {
        setHeld( null );
        const p = at( d.position );
        if ( d.paths.length ) void dropFiles( d.paths, p.x, p.y );
      }
    } );
    return () => void off.then( ( f ) => f() );
  }, [] );
  if ( !held || !held.kinds.length ) return null;
  const under             = zoneAt( held.x, held.y );
  const zones: DropZone[] = [];
  const view              = document.querySelector<HTMLElement>( ".viewport" );
  const dock              = document.querySelector<HTMLElement>( ".area.assets" );
  if ( view && view.offsetWidth ) zones.push( { zone: "view", rect: view.getBoundingClientRect() } );
  if ( dock && dock.offsetWidth ) zones.push( { zone: "dock", rect: dock.getBoundingClientRect() } );
  return (
    <div className="drop-zones">
      { zones.map( ( { zone, rect } ) => (
        <div
          key={zone}
          className={`drop-zone ${zone} ${under === zone ? "on" : ""}`}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        >
          <div className="drop-what">
            { actions( zone, held.kinds ).map( ( a ) => (
              <span key={a.text}>
                <Icon name={a.icon as never} size={16} />
                {a.text}
              </span>
            ) ) }
          </div>
        </div>
      ) ) }
    </div>
  );
}
