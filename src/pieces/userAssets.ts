// The personal asset library ( src-tauri/src/library/userassets.rs ): importing models, placing them in a map, and saving
// a map's custom objects for reuse.

import { open } from "@tauri-apps/plugin-dialog";
import { materialOverlay } from "../core/overlay";
import { ipc, type UserAsset, type UserMaterial } from "../core/ipc";
import { deltaBetween, transformCustom } from "../core/transform";
import { arr3, customName, type CustomMaterial, type CustomObjectEntry } from "../core/types";
import { useEditor } from "../map/store";

export const MODEL_EXTENSIONS = ["glb", "gltf", "obj"];

export async function loadUserAssets() {
  try {
    useEditor.setState( { userAssets: await ipc.listUserAssets() } );
  } catch ( e ) {
    useEditor.getState().toast( `Couldn't read your asset library: ${e}`, "error" );
  }
}

export async function importAssetFiles( paths: string[] ) {
  const st      = useEditor.getState();
  const models  = paths.filter( ( p ) => MODEL_EXTENSIONS.includes( p.split( "." ).pop()?.toLowerCase() ?? "" ) );
  const skipped = paths.length - models.length;
  if ( skipped ) st.toast( `Skipped ${skipped} file${skipped > 1 ? "s" : ""} — import .glb, .gltf or .obj (export FBX from Blender as GLB)`, "error" );
  let last: UserAsset | null = null;
  for ( const p of models ) {
    st.setBusy( `Importing ${p.split( /[\\/]/ ).pop()}…` );
    try {
      last = await ipc.importUserAsset( p );
      st.toast( `Added “${last.name}” to My assets · ${last.size.map( ( v ) => v.toFixed( 2 ) ).join( " × " )} m`, "success" );
    } catch ( e ) {
      st.toast( `Import failed: ${e}`, "error" );
    } finally {
      st.setBusy( null );
    }
  }
  if ( models.length ) await loadUserAssets();
  return last;
}

/**
 * Saves a custom object from the open map ( e.g. one of Melon's pieces ) to My assets.
**/
export async function saveCustomToLibrary( o: CustomObjectEntry, name = customName( o ) ) {
  const st = useEditor.getState();
  if ( !st.projectDir || !st.library ) return;
  const cur                      = { pos: arr3( o.position ), rot: arr3( o.rotation ), scl: arr3( o.scale ) };
  // stored at the origin ( rotation and scale kept ), so it drops in place like any other asset
  const atOrigin                 = transformCustom( o, deltaBetween( cur, { ...cur, pos: [0, 0, 0] } ) );
  const { uid: _uid, ...object } = atOrigin;
  try {
    const info = await ipc.saveCustomAsAsset( st.projectDir, st.library, object, name );
    st.toast( `Saved “${info.name}” to My assets`, "success" );
    await loadUserAssets();
  } catch ( e ) {
    st.toast( `Couldn't save it: ${e}`, "error" );
  }
}

export async function deleteUserAsset( a: UserAsset ) {
  try {
    await ipc.deleteUserAsset( a.path );
    await loadUserAssets();
  } catch ( e ) {
    useEditor.getState().toast( `Couldn't delete ${a.name}: ${e}`, "error" );
  }
}

// ---------------------------------------------------------------- materials

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg"];

/**
 * Stable identity for a material's look ( what the viewport also caches materials by ).
**/
export const materialKey = ( m: CustomMaterial ) =>
  JSON.stringify( [m.base_tex, m.render_mode, m.alpha_cutoff, m.tiling, m.offset, m.cull_mode, m.base_color, m.emission_color, m.metallic, m.smoothness, materialOverlay( m )] );

/**
 * A readable name: the texture file's name, or the colour.
**/
export function materialName( m: CustomMaterial ) {
  const t = m.base_tex.split( "/" ).pop();
  if ( t ) return t.replace( /[_-]?(basecolor|base_color|albedo|diffuse|color)$/i, "" ).replace( /[_-]+/g, " " ) || t;
  const c = m.base_color;
  return `Colour #${[c.r, c.g, c.b].map( ( v ) => Math.round( Math.min( 1, Math.max( 0, v ) ) * 255 ).toString( 16 ).padStart( 2, "0" ) ).join( "" )}`;
}

/**
 * Every distinct material the open map's custom objects use, most used first.
**/
export function mapMaterials( objects: CustomObjectEntry[] ): { key: string; material: CustomMaterial; uses: number }[] {
  const found = new Map<string, { key: string; material: CustomMaterial; uses: number }>();
  for ( const o of objects )
    for ( const p of o.parts )
      for ( const m of p.materials ) {
        const key = materialKey( m );
        const e   = found.get( key );
        if ( e ) e.uses++;
        else found.set( key, { key, material: m, uses: 1 } );
      }
  return [...found.values()].sort( ( a, b ) => b.uses - a.uses );
}

export async function loadUserMaterials() {
  try {
    useEditor.setState( { userMaterials: await ipc.listUserMaterials() } );
  } catch ( e ) {
    useEditor.getState().toast( `Couldn't read your materials: ${e}`, "error" );
  }
}

export async function importMaterialFiles( paths: string[] ) {
  const st = useEditor.getState();
  for ( const p of paths ) {
    try {
      const m = await ipc.importMaterialImage( p );
      st.toast( `Added material “${m.name}”`, "success" );
    } catch ( e ) {
      st.toast( `Couldn't make a material from ${p.split( /[\\/]/ ).pop()}: ${e}`, "error" );
    }
  }
  if ( paths.length ) await loadUserMaterials();
}

export async function pickAndImportMaterials() {
  const picked = await open( { multiple: true, filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }] } );
  if ( picked ) await importMaterialFiles( Array.isArray( picked ) ? picked : [picked] );
}

/**
 * Files dropped onto the window: models become meshes, images become materials.
**/
export async function importDroppedFiles( paths: string[] ) {
  const ext    = ( p: string ) => p.split( "." ).pop()?.toLowerCase() ?? "";
  const images = paths.filter( ( p ) => IMAGE_EXTENSIONS.includes( ext( p ) ) );
  await importMaterialFiles( images );
  const rest = paths.filter( ( p ) => !IMAGE_EXTENSIONS.includes( ext( p ) ) );
  if ( rest.length ) await importAssetFiles( rest );
  ( await import( "./library" ) ).loadLibrary();
}

export async function saveMaterialToLibrary( m: CustomMaterial, name = materialName( m ) ) {
  const st = useEditor.getState();
  if ( !st.projectDir || !st.library ) return;
  try {
    await ipc.saveMaterialFromProject( st.projectDir, st.library, m, name );
    st.toast( `Saved “${name}” to My materials`, "success" );
    await loadUserMaterials();
  } catch ( e ) {
    st.toast( `Couldn't save the material: ${e}`, "error" );
  }
}

export async function deleteUserMaterial( m: UserMaterial ) {
  try {
    await ipc.deleteUserAsset( m.path );
    await loadUserMaterials();
  } catch ( e ) {
    useEditor.getState().toast( `Couldn't delete ${m.name}: ${e}`, "error" );
  }
}
