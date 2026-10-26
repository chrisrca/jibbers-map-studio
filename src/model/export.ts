// Modelled pieces into the map's library at export ( src-tauri project/models.rs ): each one's mesh, a submesh per material
// slot, and its convex colliders' meshes.

import { ipc, joinPath } from "../core/ipc";
import type { CustomObjectEntry } from "../core/types";
import { encodePng } from "../core/png";
import { paintAtlas, channelKey, paintKey, pieceTexture, textureForGame, type Channel } from "../texture/meshPaint";
import { mapState } from "../pieces/assetScene";
import { useEditor } from "../map/store";
import { buildMesh, modelColliders, type Built } from "./build";
import { colliderKey, isModel, levelMesh, lodMeshKey, meshKey } from "./objects";

/**
 * u32 vertex count, u32 index count, positions, normals, UVs, indices.
**/
function pack( b: Built ): Uint8Array {
  const n   = b.pos.length / 3;
  const buf = new ArrayBuffer( 8 + n * 32 + b.idx.length * 4 );
  new Uint32Array( buf, 0, 2 ).set( [n, b.idx.length] );
  new Float32Array( buf, 8,          n * 3 ).set( b.pos );
  new Float32Array( buf, 8 + n * 12, n * 3 ).set( b.nrm );
  new Float32Array( buf, 8 + n * 24, n * 2 ).set( b.uv  );
  new Uint32Array( buf, 8 + n * 32, b.idx.length ).set( b.idx );
  return new Uint8Array( buf );
}

/**
 * A convex collider's triangles as a mesh ( its own corners; the game shrink-wraps it ).
**/
function hull( tris: Float32Array ): Built {
  const n = tris.length / 3;
  return { pos: tris, nrm: new Float32Array( n * 3 ), uv: new Float32Array( n * 2 ), idx: Uint32Array.from( { length: n }, ( _, i ) => i ), submeshes: [n] };
}

/**
 * Writes every modelled piece's meshes into the library ( the last export's go ).
**/
export async function updateModelMeshes( extra: CustomObjectEntry[] = [] ) {
  const st  = mapState();
  const dir = st.projectDir;
  if ( !dir ) return;
  // ( the map's, and any others asked for: an asset being saved )
  const pieces = [...st.customObjects, ...extra.filter( ( o ) => !st.customObjects.some( ( x ) => x.uid === o.uid ) )].filter( isModel );
  const files: { key: string; file: string; submeshes: number[] }[] = [];
  for ( const o of pieces ) {
    const b    = buildMesh( o.model, o.model.paint ? ( g ) => paintAtlas( o.model, g ) : undefined );
    const file = `models/${o.uid}.bin`;
    await ipc.writeBinary( joinPath( dir, file ), pack( b ) );
    files.push( { key: meshKey( o.uid ), file, submeshes: b.submeshes } );
    for ( let level = 1; level <= ( o.model.lods?.levels ?? 0 ); level++ ) {
      const l = levelMesh( o.model, level ), f = `models/${o.uid}-lod${level}.bin`;
      await ipc.writeBinary( joinPath( dir, f ), pack( l ) );
      files.push( { key: lodMeshKey( o.uid, level ), file: f, submeshes: l.submeshes } );
    }
    let k = 0;
    for ( const c of modelColliders( o.model ) ) {
      if ( c.kind !== "convex" ) continue;
      const h = hull( c.tris ), f = `models/${o.uid}-c${k}.bin`;
      await ipc.writeBinary( joinPath( dir, f ), pack( h ) );
      files.push( { key: colliderKey( o.uid, k++ ), file: f, submeshes: h.submeshes } );
    }
  }
  // painted pieces' textures ( rows as the game reads a picture )
  const textures: { key: string; file: string; linear?: boolean }[] = [];
  for ( const o of pieces ) {
    const T = pieceTexture( o.uid );
    if ( !o.model.paint || !T ) continue;
    const file = `models/${o.uid}-paint.png`;
    await ipc.writeBinary( joinPath( dir, file ), await encodePng( T.n, T.n, textureForGame( T ) ) );
    textures.push( { key: paintKey( o.uid ), file } );
    // the grey channels and the normal map, read as values ( not colour )
    const maps: [Exclude<Channel, "colour">, Uint8Array | null | undefined][] = [["metallic", T.ch.metallic], ["roughness", T.ch.roughness], ["height", T.normal]];
    for ( const [ch, px] of maps ) {
      if ( !px ) continue;
      const f = `models/${o.uid}-${ch}.png`;
      await ipc.writeBinary( joinPath( dir, f ), await encodePng( T.n, T.n, textureForGame( T, px ) ) );
      textures.push( { key: channelKey( o.uid, ch ), file: f, linear: true } );
    }
  }
  if ( !files.length && !textures.length && !st.library ) return;
  await ipc.setModelMeshes( dir, files, textures );
  if ( !st.library ) useEditor.setState( { library: "assets/library.jbrmap" } );
}
