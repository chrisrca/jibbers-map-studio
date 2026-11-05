// Saving the open project ( the chunks that changed, the editor's state, the trails, the paint ).

import { ipc, joinPath } from "../../core/ipc";
import type { Project } from "../../core/types";
import { savePaint } from "../../paint/ground";
import { mapState } from "../../pieces/assetScene";
import { packShape, shapeChanges, whenShapesSettled } from "../../terrain/shapes/shapes";
import { terrain } from "../../terrain/terrain";
import { packTrees } from "../trees";
import { savePieceTextures } from "../../texture/meshPaint";
import { saveTrailFiles, trailEditorData } from "../../trails/edits";
import { flushTrails } from "../../trails/ground";
import { history } from "../history";
import { useEditor } from "../store";
import { chunkVersion, meta, savedArray, savedVersion } from "./state";

export function currentProject(): Project | null {
  // ( the map's, also while the Assets workspace shows its own scene )
  const s = mapState();
  if ( !s.map ) return null;
  const alive = new Set( [...s.objects, ...s.spawns, ...s.customObjects, ...s.shapes].map( ( o ) => o.uid ) );
  // ( the features and pieces that are trees saved as the terrain's trees )
  const trees = packTrees( terrain.chunks, s.objects, s.customObjects );
  return {
    format:  "jibbers-studio-project",
    version: 1,
    map:     s.map,
    chunks: terrain.chunks.map( ( c ) => ( {
      ...s.chunkExtras[c.key],
      ...( trees.protos[c.key] ? { treePrototypes: trees.protos[c.key] } : {} ),
      key:        c.key,
      position:   c.position,
      size:       c.size,
      resolution: c.res,
      heights:    `heights/${c.key}.f32`,
      snowMask:   c.snowMask,
    } ) ),
    objects:       trees.objects,
    spawns:        s.spawns,
    customObjects: trees.pieces,
    library:       s.library,
    editor: {
      jibFix:      2,
      shapes:      s.shapes,
      // the shapes whose change in the ground is kept in shapes/<uid>.bin
      shapePatches: shapeChanges().map( ( [uid] ) => uid ),
      trails:      trailEditorData(),
      // the Outliner's collections and names; pieces get their uids back from customUids ( same order )
      collections: s.collections,
      membership:  Object.fromEntries( Object.entries( s.membership ).filter( ( [uid] ) => alive.has( uid ) ) ),
      labels:      Object.fromEntries( Object.entries( s.labels ).filter( ( [uid] ) => alive.has( uid ) ) ),
      locked:      Object.keys( s.locked ).filter( ( uid ) => alive.has( uid ) ),
      hidden:      Object.keys( s.hiddenInView ).filter( ( uid ) => alive.has( uid ) ),
      customUids:  trees.pieces.map( ( o ) => o.uid ),
      treeUids:    trees.uids,
      exported:    meta.exported,
      sourceMapId: meta.sourceMapId,
      realTerrain: meta.realTerrain,
      madeLand:    meta.madeLand,
    },
  };
}

let saving: Promise<void> | null = null;

// ( the change count each shape's file was last written at, by project folder and uid )
const savedShapes = new Map<string, number>();

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
      // the trails' ground finished ( the far part of the last change may still be under way ), and the sculpt strokes
      // still being laid down
      flushTrails();
      // ( formations still on the graphics card waited for )
      await new Promise<void>( ( r ) => whenShapesSettled( r ) );
      history.settle();
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
      // each shape's change in the ground ( an edit after it's opened again takes it out first ), those changed since
      for ( const [uid, n] of shapeChanges() ) {
        const key = `${dir}|${uid}`;
        if ( savedShapes.get( key ) === n ) continue;
        const bytes = packShape( uid );
        if ( bytes ) await ipc.writeBinary( joinPath( dir, "shapes", `${uid}.bin` ), bytes );
        savedShapes.set( key, n );
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
