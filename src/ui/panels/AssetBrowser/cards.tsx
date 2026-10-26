// The asset browser's cards: a piece, a lift, a material, a material used in the map; their previews and marks.

import { useEffect, useState } from "react";
import { type LibraryEntry, ipc } from "../../../core/ipc";
import type { CustomMaterial } from "../../../core/types";
import { useEditor } from "../../../map/store";
import { openAsset } from "../../../pieces/assetFiles";
import { isUserEntry, loadLibrary, placeEntry, userPath } from "../../../pieces/library";
import { deleteUserAsset, deleteUserMaterial, materialName, saveMaterialToLibrary } from "../../../pieces/userAssets";
import { BlIcon } from "../../blender/BlIcon";
import { dropPreview, entryObject, entryPreview, liftPreview, mapMaterialPreview, usePreview, usePreviewsPending } from "../../previews";
import { getEngine } from "../../Viewport";
import { Icon } from "../../widgets/icons";
import { dropMaterial, startDrag } from "./drag";

/**
 * A card's picture, with a spinner while it's being drawn; the game's mark in its corner on an official feature.
**/
function Thumb( { url, official }: { url: string | null | undefined; official?: boolean } ) {
  return (
    <div className="thumb">
      {url ? <img src={url} alt="" draggable={false} /> : url === undefined ? <span className="spinner-inline" /> : null}
      {official && <OfficialMark />}
    </div>
  );
}

// The game's mark, from the player's own copy of the game ( none without it ): read once.
let markUrl: Promise<string | null> | null = null;

function useGameMark() {
  markUrl ??= ipc
    .gameMark()
    .then( ( b ) => ( b.byteLength ? URL.createObjectURL( new Blob( [b], { type: "image/png" } ) ) : null ) )
    .catch( () => null );
  const [url, setUrl] = useState<string | null>( null );
  useEffect( () => {
    let live = true;
    markUrl!.then( ( u ) => live && setUrl( u ) );
    return () => {
      live = false;
    };
  }, [] );
  return url;
}

function OfficialMark() {
  const url = useGameMark();
  return url ? <img className="official" src={url} alt="" draggable={false} /> : null;
}

/**
 * One of the game's own features ( with the game's look, or the placeholder's where the game isn't installed ).
**/
const isOfficial = ( e: LibraryEntry ) => e.id.startsWith( "game:" ) || ( e.id.startsWith( "app:" ) && e.folder.startsWith( "Features" ) );

/**
 * Previews still being drawn, beside the search.
**/
export function PreviewsPending() {
  const n = usePreviewsPending();
  return n > 0 ? (
    <span className="previews-pending" title="Drawing previews">
      <span className="spinner-inline" /> {n}
    </span>
  ) : null;
}

/**
 * Ctrl+click ( or any click with Scatter out ): a piece for the object brush to drop, or not any more.
**/
function togglePick( id: string ) {
  const sc    = useEditor.getState().scatter;
  const picks = sc.picks.includes( id ) ? sc.picks.filter( ( x ) => x !== id ) : [...sc.picks, id];
  useEditor.setState( { scatter: { ...sc, picks }, tool: "scatter", placeEntry: null } );
}

export function MeshCard( { e, on }: { e: LibraryEntry; on: boolean } ) {
  const picked = useEditor( ( s ) => s.scatter.picks.includes( e.id ) );
  const url    = usePreview( () => entryPreview( e ), [e.id] );
  const size   = e.size ? `${e.size.map( ( v ) => v.toFixed( 1 ) ).join( " × " )} m` : "";
  return (
    <div
      className={`card ${on ? "on" : ""} ${picked ? "picked" : ""}`}
      title={`${e.name}${size ? ` · ${size}` : ""}`}
      onPointerDown={( ev ) =>
        startDrag( ev, {
          ghost:   () => entryObject( e ),
          onDrop:  ( x, y ) => {
            const pl = getEngine()?.placing.libraryPlacementAt( x, y );
            if ( pl ) placeEntry( e.id, pl.pos, pl.rot );
          },
          onClick: ( ctrl ) => ( ctrl || useEditor.getState().tool === "scatter" ? togglePick( e.id ) : useEditor.setState( { placeEntry: e.id, placeId: null, tool: "place" } ) ),
        } )
      }
    >
      <Thumb url={url} official={isOfficial( e )} />
      <div className="name">{e.name}</div>
      <button className="edit" title="Edit in Assets" onPointerDown={( ev ) => ev.stopPropagation()} onClick={() => void openAsset( e.id, e.name )}>
        <BlIcon name="editmode_hlt" size={14} />
      </button>
      {isUserEntry( e ) && <DeleteButton e={e} />}
    </div>
  );
}

// The game's lifts ( chairlift, T-bar, rope tow ): placed as its own objects, their line set up in the view.
export const LIFT_NAMES: Record<string, string> = { chairlift: "Chairlift", tbar: "T-Bar", ropetow: "Rope Tow" };

export function LiftCard( { id, on }: { id: string; on: boolean } ) {
  // ( its base station, as the game draws it; the line's icon where the game isn't installed )
  const url = usePreview( () => liftPreview( id ), [id] );
  return (
    <div
      className={`card ${on ? "on" : ""}`}
      title={LIFT_NAMES[id] ?? id}
      // ( dragged into the view: put down where it's let go; clicked: the Place tool, as the other cards )
      onPointerDown={( ev ) =>
        startDrag( ev, {
          ghost:   () => getEngine()!.placing.liftGhost( id ),
          onDrop:  ( x, y ) => void getEngine()?.placing.dropObject( id, x, y ),
          onClick: () => useEditor.setState( { placeId: id, placeEntry: null, tool: "place" } ),
        } )
      }
    >
      <div className="thumb">
        {url ? <img src={url} alt="" draggable={false} /> : url === undefined ? <span className="spinner-inline" /> : <BlIcon name="curve_path" size={32} />}
        <OfficialMark />
      </div>
      <div className="name">{LIFT_NAMES[id] ?? id}</div>
    </div>
  );
}

export function MaterialCard( { e }: { e: LibraryEntry } ) {
  const url = usePreview( () => entryPreview( e ), [e.id] );
  return (
    <div
      className="card material"
      title={e.name}
      onPointerDown={( ev ) => startDrag( ev, { picture: url, onDrop: dropMaterial( { kind: "library", entryId: e.id } ), onClick: () => {} } )}
    >
      <Thumb url={url} />
      <div className="name">{e.name}</div>
      {isUserEntry( e ) && <DeleteButton e={e} />}
    </div>
  );
}

export function MapMaterialCard( { m }: { m: { key: string; material: CustomMaterial; uses: number } } ) {
  const url  = usePreview( () => mapMaterialPreview( m.material ), [m.key] );
  const name = materialName( m.material );
  return (
    <div
      className="card material"
      title={`${name} · used ${m.uses}× in this map · drag onto a surface (hold Shift for the whole object)`}
      onPointerDown={( ev ) => startDrag( ev, { picture: url, onDrop: dropMaterial( { kind: "map", material: m.material } ), onClick: () => {} } )}
    >
      <Thumb url={url} />
      <div className="name">{name}</div>
      <button
        className="del"
        title="Keep a copy in My imports for other maps"
        onPointerDown={( ev ) => ev.stopPropagation()}
        onClick={() => saveMaterialToLibrary( m.material ).then( loadLibrary )}
      >
        <Icon name="libraryAdd" size={14} />
      </button>
    </div>
  );
}

function DeleteButton( { e }: { e: LibraryEntry } ) {
  return (
    <button
      className="del"
      title="Delete"
      onPointerDown={( ev ) => ev.stopPropagation()}
      onClick={async () => {
        if ( !confirm( `Delete “${e.name}” from your library?` ) ) return;
        dropPreview( e.id );
        const path = userPath( e );
        if ( e.kind === "mesh" ) await deleteUserAsset( { path, name: e.name, parts: 0, textures: 0, size: [0, 0, 0], surfaceType: "Generic" } );
        else await deleteUserMaterial( { path, name: e.name, material: e.material! } );
        loadLibrary();
      }}
    >
      <Icon name="close" size={12} />
    </button>
  );
}
