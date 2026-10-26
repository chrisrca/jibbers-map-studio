import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";
import type { CustomObjectEntry } from "../../core/types";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/mappieces, the map to import named in the folder's map.txt, and the pieces to
 * look at in pieces.txt: one line each, part of a mesh's name ): each piece picked by clicking it all along ( every
 * miss told by why: nothing hit, the ground first, another piece first ), and a shot of it from close.
**/
export async function mapPiecesSelftest( dir: string ) {
  try {
    const { importMap } = await import( "../../map/project" );
    const mapPath       = ( await ipc.readText( joinPath( dir, "map.txt"    ) ) ).trim();
    const names         = ( await ipc.readText( joinPath( dir, "pieces.txt" ) ) ).split( /\r?\n/ ).map( ( l ) => l.trim() ).filter( Boolean );
    await importMap( mapPath, joinPath( dir, `pieces-${Date.now()}.jbrproj` ) );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st = () => useEditor.getState();
    for ( const name of names ) {
      const o = st().customObjects.find( ( x ) => x.parts.some( ( p ) => p.mesh.includes( name ) ) );
      if ( !o ) {
        log( `${name}: no such piece` );
        continue;
      }
      await lookAt( o );
      const g = eng.customR.objectGroup( o.uid )!;
      g.updateMatrixWorld( true );
      // its corners on the screen, a few hundred of them, clicked where they show ( nudged a pixel into the piece )
      const r                    = eng.host.getBoundingClientRect();
      const pts: THREE.Vector3[] = [];
      g.traverse( ( m ) => {
        const pos = ( m as THREE.Mesh ).isMesh ? ( m as THREE.Mesh ).geometry.getAttribute( "position" ) : null;
        if ( pos ) for ( let i = 0; i < pos.count; i += Math.max( 1, Math.floor( pos.count / 300 ) ) ) pts.push( new THREE.Vector3().fromBufferAttribute( pos, i ).applyMatrix4( m.matrixWorld ) );
      } );
      const why:    Record<string, number> = {};
      const others: Record<string, number> = {};
      for ( const p of pts ) {
        const [x, y, front] = eng.screenOf( p );
        if ( !front || x < 0 || y < 0 || x > r.width || y > r.height ) continue;
        const got = eng.pickObject( x, y );
        if ( got?.uid === o.uid ) { why.picked = ( why.picked ?? 0 ) + 1; continue; }
        const rc     = eng.ray( x, y );
        const own    = rc.intersectObjects( g.children, true )[0];
        const ground = eng.pickTerrain( x, y );
        const gd     = ground ? ground.distanceTo( eng.camera.position ) : Infinity;
        const k      = !own   ? "its mesh not hit" : gd < own.distance ? "the ground first" : got ? "another piece first" : "hit but not picked";
        why[k]       = ( why[k] ?? 0 ) + 1;
        if ( got ) others[got.uid] = ( others[got.uid] ?? 0 ) + 1;
        if ( k === "the ground first" && ( why.groundLogged ?? 0 ) < 3 ) {
          why.groundLogged = ( why.groundLogged ?? 0 ) + 1;
          log( `  ground first: piece at ${own!.distance.toFixed( 2 )} m, ground at ${gd.toFixed( 2 )} m (${ground!.toArray().map( ( v ) => v.toFixed( 2 ) ).join( ", " )})` );
        }
      }
      delete why.groundLogged;
      const otherNames = Object.entries( others ).map( ( [u, n] ) => `${st().customObjects.find( ( x ) => x.uid === u )?.parts[0]?.mesh.split( "/" ).pop() ?? u} ×${n}` );
      log( `${name}: ${JSON.stringify( why )}${otherNames.length ? `; others: ${otherNames.join( ", " )}` : ""}` );
      await ipc.writeBinary( joinPath( dir, `${name.replace( /[^\w-]+/g, "_" )}.png` ), await eng.pictures.capture() );
      await allRound( o, name );
    }

    /**
     * Looked at from all round ( 8 ways, low and high ), its length cut in 10: where a click on it, seen, misses it.
    **/
    async function allRound( o: CustomObjectEntry, name: string ) {
      const g    = eng!.customR.objectGroup( o.uid )!;
      const box  = new THREE.Box3().setFromObject( g );
      const c    = box.getCenter( new THREE.Vector3() ), s = box.getSize( new THREE.Vector3() );
      const long = s.x > s.z ? 0 : 2, len = Math.max( s.x, s.z );
      const bins = Array.from( { length: 10 }, () => ( { seen: 0, missed: 0, why: {} as Record<string, number> } ) );
      // clicks a few pixels off it, where nothing at all is under the mouse: picked as Blender picks, or not
      const near = { tried: 0, picked: 0 };
      const r    = eng!.host.getBoundingClientRect();
      for ( let a = 0; a < 8; a++ )
        for ( const up of [0.15, 0.6] ) {
          const d   = len * 0.8 + 3, ang = ( a / 8 ) * Math.PI * 2;
          const eye = c.clone().add( new THREE.Vector3( Math.cos( ang ) * d, d * up, Math.sin( ang ) * d ) );
          eng!.nav.lookAtUnity( [eye.x, eye.y, -eye.z], [c.x, c.y, -c.z] );
          await sleep( 300 );
          g.updateMatrixWorld( true );
          g.traverse( ( m ) => {
            const pos = ( m as THREE.Mesh ).isMesh ? ( m as THREE.Mesh ).geometry.getAttribute( "position" ) : null;
            if ( !pos ) return;
            for ( let i = 0; i < pos.count; i += Math.max( 1, Math.floor( pos.count / 150 ) ) ) {
              const p             = new THREE.Vector3().fromBufferAttribute( pos, i ).applyMatrix4( m.matrixWorld );
              const [x, y, front] = eng!.screenOf( p );
              if ( !front || x < 0 || y < 0 || x > r.width || y > r.height ) continue;
              const own    = eng!.ray( x, y ).intersectObjects( g.children, true )[0];
              const ground = eng!.pickTerrain( x, y );
              // ( seen: the ray meets it before the ground )
              if ( !own || ( ground && ground.distanceTo( eng!.camera.position ) < own.distance ) ) continue;
              const k = Math.min( 9, Math.max( 0, Math.floor( ( ( p.getComponent( long ) - box.min.getComponent( long ) ) / ( len || 1 ) ) * 10 ) ) );
              bins[k].seen++;
              const nx = x + 4, nr = eng!.ray( nx, y );
              if ( !nr.intersectObjects( g.children, true ).length && !nr.intersectObjects( eng!.customR.pickables(), false ).length ) {
                near.tried++;
                if ( eng!.pickObject( nx, y )?.uid === o.uid ) near.picked++;
              }
              const got = eng!.pickObject( x, y );
              if ( got?.uid === o.uid ) continue;
              bins[k].missed++;
              const why = got ? `another piece (${st().customObjects.find( ( q ) => q.uid === got.uid )?.parts[0]?.mesh.split( "/" ).pop() ?? got.kind})` : "nothing";
              bins[k].why[why] = ( bins[k].why[why] ?? 0 ) + 1;
            }
          } );
        }
      log( `${name} all round, along its length: ${bins.map( ( b ) => `${b.missed}/${b.seen}` ).join( "  " )}; 4 px off it: ${near.picked} of ${near.tried} picked` );
      for ( const [k, b] of bins.entries() ) if ( b.missed ) log( `  section ${k}: ${JSON.stringify( b.why )}` );
    }

    async function lookAt( o: CustomObjectEntry ) {
      const g = eng!.customR.objectGroup( o.uid );
      if ( !g ) return;
      const box   = new THREE.Box3().setFromObject( g );
      const c     = box.getCenter( new THREE.Vector3() ), s = box.getSize( new THREE.Vector3() );
      // from the side of its longest way, a little above
      const along = s.x > s.z ? new THREE.Vector3( 0, 0, 1 ) : new THREE.Vector3( 1, 0, 0 );
      const d     = Math.max( s.x, s.y, s.z ) * 0.9 + 2;
      const eye   = c.clone().addScaledVector( along, d ).add( new THREE.Vector3( 0, d * 0.35, 0 ) );
      eng!.nav.lookAtUnity( [eye.x, eye.y, -eye.z], [c.x, c.y, -c.z] );
      await sleep( 2500 );
    }
    log( "SELFTEST OK" );
  } catch ( e ) {
    log( `SELFTEST FAILED: ${e instanceof Error ? e.stack ?? e.message : e}` );
  }
}
