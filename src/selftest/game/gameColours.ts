import { ipc, joinPath } from "../../core/ipc";
import type { ObjectEntry } from "../../core/types";
import { newEmptyProject } from "../../map/project/sessions";
import { newUid, useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, sleep, waitFor } from "../harness";
import { inMap, pad } from "./inGame";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/gamecolours ): how the game colours its own pieces. A new map with each of its
 * coloured pieces in every colour, played; the link writes how the game draws each ( studio-renderers.json: its
 * material, and the values that colour it ), kept in the folder.
**/
export async function gameColoursSelftest( dir: string ) {
  const { playInGame } = await import( "../../map/project" );
  try {
    await newEmptyProject( joinPath( dir, `colours-${Date.now()}.jbrproj` ), "Studio test colours" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    const st = () => useEditor.getState();
    st().setMap( "Test id", { id: "studio-test-colours", name: "Studio test colours" } );
    // every coloured piece of the game's in every colour it has, a row each ( its other settings as they come ); where
    // each stands kept, to tell them apart in what the link writes
    const info = JSON.parse( await ipc.readText( joinPath( ( await ipc.appInfo() ).libraryDir, "placeholders", "placeholders.json" ) ) ) as { id: string; parameters?: { name: string; type: string; default: unknown; options?: string[] }[] }[];
    const objects: ObjectEntry[] = [], where: { id: string; colour: string; at: [number, number] }[] = [];
    info.filter( ( f ) => f.parameters?.some( ( p ) => p.name === "color" ) ).forEach( ( f, row ) => {
      const colour = f.parameters!.find( ( p ) => p.name === "color" )!;
      colour.options!.forEach( ( c, k ) => {
        const x = -400 + k * 40, z = -400 + row * 11;
        const params: ObjectEntry["params"] = {};
        for ( const p of f.parameters! ) if ( p.name !== "color" && p.type === "selection" ) params[p.name] = { type: "String", value: String( p.default ) };
        params.color = { type: "String", value: c };
        objects.push( { uid: newUid(), id: f.id, position: [x, terrain.heightAt( x, z ), z], rotation: [0, 0, 0], scale: [1, 1, 1], params } );
        where.push( { id: f.id, colour: c, at: [x, z] } );
      } );
    } );
    await ipc.writeText( joinPath( dir, "placed.json" ), JSON.stringify( where ) );
    log( `${objects.length} pieces placed, ${new Set( where.map( ( w ) => w.id ) ).size} kinds` );
    useEditor.setState( { objects, gamePoppedOut: false } );
    // a piece of the studio's own with the game's hue shift in its material: whether the game's shader for those has it
    const { newModelObject } = await import( "../../model/objects" );
    const { primitive }      = await import( "../../model/mesh" );
    const box = newModelObject( newUid(), primitive( "cube", { size: 2 } ), [0, terrain.heightAt( 0, 40 ) + 1, 40] );
    const hued = { ...box, parts: box.parts.map( ( p ) => ( { ...p, materials: p.materials.map( ( m ) => ( { ...m, base_color: { r: 0.2, g: 0.4, b: 1, a: 1 }, extra_props: { ...( m.extra_props as Record<string, unknown> | undefined ), _HueShift: { Float: 0.4 } } } ) ) } ) ) };
    st().addCustom( hued, "Hued box" );
    await sleep( 1000 );
    const out = joinPath( ( await ipc.appInfo() ).mapsDir, "..", "studio-renderers.json" );
    await ipc.recycle( out ).catch( () => {} );
    await pad();
    await playInGame();
    await inMap( "the colours map" );
    // ( written by the link once the map's in )
    let text = "";
    for ( let k = 0; k < 120 && !text; k++ ) {
      await sleep( 500 );
      text = await ipc.readText( out ).catch( () => "" );
    }
    if ( !text ) throw new Error( "the link wrote nothing of the pieces' materials" );
    await ipc.writeText( joinPath( dir, "renderers.json" ), text );
    log( `pieces' materials: ${( JSON.parse( text ) as unknown[] ).length} renderers, kept in renderers.json` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  } finally {
    await ipc.gamePad( null ).catch( () => {} );
    await ipc.gameClose().catch( () => {} );
    // ( the game lets go of the map a while after it's closed )
    const map = joinPath( ( await ipc.appInfo() ).mapsDir, "studio-test-colours.jbrmap" );
    for ( let k = 0; k < 20; k++ ) {
      await sleep( 1000 );
      if ( await ipc.recycle( map ).then( () => true, () => false ) ) break;
    }
  }
}
