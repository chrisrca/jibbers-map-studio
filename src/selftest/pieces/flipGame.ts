import * as THREE from "three/webgpu";
import { arr3 } from "../../core/types";
import { deltaBetween, transformCustom } from "../../core/transform";
import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { invoke } from "@tauri-apps/api/core";
import { ipc, joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { openProject, saveProject } from "../../map/project";
import { railShellsUp } from "./railShells";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/flipgame ): a map ( map.jbrproj in the folder, its first spawn on a slope ) with four
 * tube_long rails side by side ahead of the spawn, left to right: upright; upside down with its rail's arrow turned
 * back up; upside down as it is; upside down with the arrow up ( its own rotation then written upright into the
 * exported map, by hand ). Exported for riding: which ones grab you.
**/
export async function flipGameSelftest( dir: string ) {
  try {
    const { withRail, autoRail, toView } = await import( "../../pieces/rail" );
    await openProject( joinPath( dir, "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await loadLibrary();
    const st    = useEditor.getState;
    const sp    = st().spawns[0];
    const g     = ( x: number, z: number ) => terrain.heightAt( x, z );
    const h     = Math.hypot( sp.velocity[0], sp.velocity[2] ) || 1;
    const d     = [sp.velocity[0] / h, sp.velocity[2] / h];
    const right = [d[1], -d[0]];
    const variants: [string, number, [number, number, number] | null][] = [
      ["A upright",                             0,   null],
      ["B upside down, arrow up",               180, [0, -1, 0]],
      ["C upside down, arrow down",             180, null],
      ["D upside down, arrow up, upright root", 180, [0, -1, 0]],
    ];
    const out: unknown[] = [];
    for ( const [i, [label, roll, up]] of variants.entries() ) {
      const x = sp.position[0] + d[0] * 25 + right[0] * ( i - 1.5 ) * 4, z = sp.position[2] + d[1] * 25 + right[1] * ( i - 1.5 ) * 4;
      await placeEntry( feature( "tube_long" ), [x, g( x, z ), z] );
      let o = st().customObjects[st().customObjects.length - 1];
      // its rail ( made on placing, once its mesh has loaded )
      if ( !o.rail?.points.length ) {
        let pts: Float32Array | null | undefined = null;
        for ( let k = 0; k < 100 && !pts; k++ ) {
          pts = await eng.customR.localVertices( o );
          if ( !pts ) await sleep( 200 );
        }
        const made = pts ? autoRail( pts ) : null;
        if ( !made?.rail ) throw new Error( `no rail on ${label}` );
        o = withRail( o, made.rail );
      }
      // turned to run down the slope ( three's coordinates: Unity's z flipped ), then rolled about its rail
      const ends   = () => [toView( o, o.rail!.points[0] ), toView( o, o.rail!.points[o.rail!.points.length - 1] )];
      let [a, b]   = ends();
      const flat   = ( v: THREE.Vector3 ) => new THREE.Vector3( v.x, 0, v.z ).normalize();
      const centre = a.clone().add( b ).multiplyScalar( 0.5 );
      const about  = ( q: THREE.Quaternion, c: THREE.Vector3 ) => new THREE.Matrix4().makeTranslation( c.x, c.y, c.z ).multiply( new THREE.Matrix4().makeRotationFromQuaternion( q ) ).multiply( new THREE.Matrix4().makeTranslation( -c.x, -c.y, -c.z ) );
      o            = transformCustom( o, about( new THREE.Quaternion().setFromUnitVectors( flat( b.clone().sub( a ) ), new THREE.Vector3( d[0], 0, -d[1] ) ), centre ) );
      [a, b]       = ends();
      if ( roll ) o = transformCustom( o, about( new THREE.Quaternion().setFromAxisAngle( b.clone().sub( a ).normalize(), Math.PI ), a.clone().add( b ).multiplyScalar( 0.5 ) ) );
      o           = withRail( o, { ...o.rail!, ...( up ? { up } : {} ) } );
      // all four the same height: the rail's underside 0.3 m over the snow
      const caps  = o.colliders.filter( ( c ) => c.mesh_ref === "studio-rail" );
      const low   = Math.min( ...caps.map( ( c ) => c.local_position.y - c.radius * Math.abs( c.local_scale.y ) ) );
      const cur   = { pos: arr3( o.position ), rot: arr3( o.rotation ), scl: arr3( o.scale ) };
      o           = transformCustom( o, deltaBetween( cur, { ...cur, pos: [cur.pos[0], cur.pos[1] + g( x, z ) + 0.3 - low, cur.pos[2]] } ) );
      const fixed = o;
      useEditor.setState( ( s ) => ( { customObjects: s.customObjects.map( ( c ) => ( c.uid === fixed.uid ? fixed : c ) ) } ) );
      log( `${label}: at ${arr3( o.position ).map( ( v ) => v.toFixed( 2 ) )}, rotation ${arr3( o.rotation ).map( ( v ) => v.toFixed( 1 ) )}, rail up ${JSON.stringify( o.rail?.up ?? null )}, ${caps.length} capsules, top of the rail ${railShellsUp( o ).toFixed( 0 )}° from straight up at most` );
      out.push( { label, position: o.position, rotation: o.rotation, uprightRoot: i === 3 } );
    }
    await saveProject();
    const r = await invoke<{ fixedColliders: number; objects: number }>( "export_project", { projectDir: st().projectDir, outPath: null } );
    log( `exported "${st().map?.name}" (${st().map?.id}): ${r.objects} objects, ${r.fixedColliders} colliders fixed` );
    await ipc.writeText( joinPath( dir, "flip.json" ), JSON.stringify( { id: st().map?.id, rails: out } ) );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
