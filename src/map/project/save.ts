// Saving the open project ( the chunks that changed, the editor's state, the trails, the paint ).

import { ipc, joinPath } from "../../core/ipc";
import type { Project } from "../../core/types";
import { savePaint } from "../../paint/ground";
import { mapState } from "../../pieces/assetScene";
import { terrain } from "../../terrain/terrain";
import { savePieceTextures } from "../../texture/meshPaint";
import { saveTrailFiles, trailEditorData } from "../../trails/edits";
import { flushTrails } from "../../trails/ground";
import { useEditor } from "../store";
import { chunkVersion, meta, savedArray, savedVersion } from "./state";

export function currentProject(): Project | null {
  // ( the map's, also while the Assets workspace shows its own scene )
  const s = mapState();
  if ( !s.map ) return null;
  const alive = new Set( [...s.objects, ...s.spawns, ...s.customObjects, ...s.shapes].map( ( o ) => o.uid ) );
  return {
    format:  "jibbers-studio-project",
    version: 1,
    map:     s.map,
    chunks: terrain.chunks.map( ( c ) => ( {
      ...s.chunkExtras[c.key],
      key:        c.key,
      position:   c.position,
      size:       c.size,
      resolution: c.res,
      heights:    `heights/${c.key}.f32`,
      snowMask:   c.snowMask,
    } ) ),
    objects:       s.objects,
    spawns:        s.spawns,
    customObjects: s.customObjects,
    library:       s.library,
    editor: {
      jibFix:      2,
      shapes:      s.shapes,
      trails:      trailEditorData(),
      // the Outliner's collections and names; pieces get their uids back from customUids ( same order )
      collections: s.collections,
      membership:  Object.fromEntries( Object.entries( s.membership ).filter( ( [uid] ) => alive.has( uid ) ) ),
      labels:      Object.fromEntries( Object.entries( s.labels ).filter( ( [uid] ) => alive.has( uid ) ) ),
      locked:      Object.keys( s.locked ).filter( ( uid ) => alive.has( uid ) ),
      hidden:      Object.keys( s.hiddenInView ).filter( ( uid ) => alive.has( uid ) ),
      customUids:  s.customObjects.map( ( o ) => o.uid ),
      exported:    meta.exported,
      sourceMapId: meta.sourceMapId,
      realTerrain: meta.realTerrain,
    },
  };
}

let saving: Promise<void> | null = null;

/**
 * Saves the project ( only the chunks that changed since the last save, plus project.json ). Saves never overlap: a
 * save asked for while one is running waits for it and then saves whatever changed meanwhile.
**/
export async function saveProject(): Promise<void> {
  while ( saving ) await saving;
  saving = ( async () => {
    const s   = useEditor.getState();
    const dir = s.projectDir;
    if ( !dir || !currentProject() ) return;
    useEditor.setState( { saveState: "saving" } );
    try {
      // the trails' ground finished ( the far part of the last change may still be under way )
      flushTrails();
      // painted snow masks first: saving them points the chunks at their files
      await savePaint( dir );
      await savePieceTextures( dir, new Set( mapState().customObjects.map( ( o ) => o.uid ) ) );
      for ( const c of terrain.chunks ) {
        const v = chunkVersion.get( c.key ) ?? 1;
        if ( savedVersion.get( c.key ) === v && savedArray.get( c.key ) === c.heights ) continue;
        await ipc.writeBinary( joinPath( dir, "heights", `${c.key}.f32` ), new Uint8Array( c.heights.buffer, c.heights.byteOffset, c.heights.byteLength ) );
        savedVersion.set( c.key, v );
        savedArray.set( c.key, c.heights );
      }
      await saveTrailFiles( dir );
      await ipc.saveProject( dir, currentProject()! );
      useEditor.setState( { dirty: false, lastSavedAt: Date.now() } );
    } finally {
      useEditor.setState( { saveState: "idle" } );
    }
  } )();
  try {
    await saving;
  } finally {
    saving = null;
  }
}
