import * as THREE from "three/webgpu";
import { toThree, type V3 } from "../../core/coords";
import { joinPath } from "../../core/ipc";
import { pieceMatrix, transformCustom, composeUnity } from "../../core/transform";
import { arr3, type CustomObjectEntry } from "../../core/types";
import { useEditor } from "../../map/store";
import type { Mesh } from "../../model/mesh";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/blenderobject ): Object Mode's operators as Blender has them: Ctrl+A ( Location,
 * Rotation, Scale, All Transforms: the piece looks the same, its transform put into its mesh ), Set Origin ( to its
 * geometry: the median, as Blender's; to the 3D cursor; geometry to origin ), Ctrl+J ( into the active one, a shared
 * material one slot, a mirrored piece not inside out ), P in Edit Mode ( Cube.001 ), Mirror, Shade Smooth / Flat, and
 * Ctrl - / + / * ( Bool Tool's difference, union, intersect: the volumes Blender's give ).
**/
export async function blenderObjectSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const P = await import( "../../map/project" );
    await P.newEmptyProject( joinPath( dir, `object-${Date.now()}.jbrproj` ), "Blender Object" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 1000 );
    const st = () => useEditor.getState();
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Assets" )?.click();
    await sleep( 1200 );
    const io    = realInput( eng, () => "object" );
    const frame = () => new Promise<void>( ( r ) => requestAnimationFrame( () => r() ) );
    const key   = async ( k: string, m: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {} ) => {
      const init = { key: k, code: k.length === 1 ? ( /[0-9]/.test( k ) ? `Digit${k}` : `Key${k.toUpperCase()}` ) : k, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, bubbles: true, cancelable: true };
      window.dispatchEvent( new KeyboardEvent( "keydown", init ) );
      window.dispatchEvent( new KeyboardEvent( "keyup", init ) );
      await frame();
      await sleep( 60 );
    };
    const type = async ( s: string ) => { for ( const ch of s ) await key( ch ); };
    const menu = async ( label: string ) => {
      await sleep( 200 );
      const it = [...document.querySelectorAll<HTMLElement>( ".bmenu .bmenu-item" )].find( ( x ) => x.textContent?.trim().startsWith( label ) );
      it?.click();
      await sleep( 300 );
      return !!it;
    };
    // ( one of the Object menu's, by its path: as clicked )
    const objectOp = async ( ...path: string[] ) => {
      let items = eng.menus.objectMenuItems();
      for ( const [i, label] of path.entries() ) {
        const it = items.find( ( x ) => x.label === label );
        if ( !it ) return false;
        if ( i === path.length - 1 ) it.run?.();
        else items = it.sub ?? [];
      }
      await sleep( 250 );
      return true;
    };
    await io.glide( io.rc.width / 2, io.rc.height / 2, 200 );
    const piece  = ( uid: string ) => st().customObjects.find( ( o ) => o.uid === uid )!;
    // ( its corners where they are in the world )
    const world  = ( o: CustomObjectEntry ) => o.model!.mesh.v.map( ( p ) => toThree( p ).applyMatrix4( pieceMatrix( o ) ) );
    const same   = ( a: THREE.Vector3[], b: THREE.Vector3[] ) => a.length === b.length && a.every( ( p, i ) => p.distanceTo( b[i] ) < 1e-4 );
    // ( a closed mesh's volume, signed: positive with its faces out, as a fresh cube's )
    const volume = ( g: Mesh ) => g.f.reduce( ( s, f ) => {
      let v = 0;
      for ( let i = 1; i + 1 < f.length; i++ ) {
        const a = g.v[f[0]], b = g.v[f[i]], c = g.v[f[i + 1]];
        v += ( a[0] * ( b[1] * c[2] - b[2] * c[1] ) - a[1] * ( b[0] * c[2] - b[2] * c[0] ) + a[2] * ( b[0] * c[1] - b[1] * c[0] ) ) / 6;
      }
      return s + v;
    }, 0 );
    const clear = async () => {
      if ( eng.editing ) await key( "Tab" );
      if ( st().customObjects.length ) {
        st().setSelection( st().customObjects.map( ( o ) => ( { kind: "custom" as const, uid: o.uid } ) ) );
        await key( "Delete" );
      }
      useEditor.setState( { cursor3d: [0, 0, 0] } );
    };
    const cube = async () => {
      await key( "A", { shift: true } );
      await menu( "Cube" );
      await sleep( 300 );
      return st().selection[0]!.uid;
    };

    // ---------------------------------------------------------------- Ctrl+A: the transform into the mesh
    for ( const [label, what] of [["Location", "position"], ["Rotation", "rotation"], ["Scale", "scale"], ["All Transforms", "all"]] as const ) {
      await clear();
      const uid = await cube();
      st().updateCustom( "Place", [uid], ( o ) => transformCustom( o, composeUnity( [1, 2, 3], [10, 30, 0], [2, 1, 1.5] ) ) );
      await sleep( 150 );
      const before = world( piece( uid ) );
      await key( "a", { ctrl: true } );
      await menu( label );
      const o     = piece( uid );
      const reset = what === "position" ? arr3( o.position ).every( ( x ) => Math.abs( x ) < 1e-6 ) : what === "rotation" ? arr3( o.rotation ).every( ( x ) => Math.abs( x ) < 1e-6 ) : what === "scale" ? arr3( o.scale ).every( ( x ) => Math.abs( x - 1 ) < 1e-6 ) : arr3( o.position ).every( ( x ) => Math.abs( x ) < 1e-6 ) && arr3( o.rotation ).every( ( x ) => Math.abs( x ) < 1e-6 ) && arr3( o.scale ).every( ( x ) => Math.abs( x - 1 ) < 1e-6 );
      check( reset && ( what === "rotation" || same( world( o ), before ) ), `Ctrl+A › ${label}: its ${what} put into the mesh ( ${reset} ), its corners where they were ( ${same( world( o ), before )} )` );
    }

    // ---------------------------------------------------------------- Set Origin
    await clear();
    let uid = await cube();
    await key( "Tab" ); await key( "3" ); await key( "a", { alt: true } );
    const ed = eng.modelEd;
    ed.sel   = ( await import( "../../model/ops" ) ).selFromFaces( piece( uid ).model!.mesh, piece( uid ).model!.mesh.f.flatMap( ( f, i ) => ( f.every( ( v ) => piece( uid ).model!.mesh.v[v][1] > 0.99 ) ? [i] : [] ) ) );
    ed.sync();
    await key( "e" ); await type( "1" ); await key( "Enter" );
    await key( "Tab" );
    let before = world( piece( uid ) );
    await objectOp( "Set Origin", "Origin to Geometry" );
    const oy = piece( uid ).position.y;
    check( Math.abs( oy - 8 / 12 ) < 1e-4 && same( world( piece( uid ) ), before ), `Origin to Geometry: the origin at the corners' median ( ${oy.toFixed( 4 )}; Blender ${( 8 / 12 ).toFixed( 4 )} ), the mesh where it was` );
    useEditor.setState( { cursor3d: [1, 0, 0] } );
    before = world( piece( uid ) );
    await objectOp( "Set Origin", "Origin to 3D Cursor" );
    check( Math.abs( piece( uid ).position.x - 1 ) < 1e-6 && same( world( piece( uid ) ), before ), "Origin to 3D Cursor: the origin there, the mesh where it was" );
    await objectOp( "Set Origin", "Geometry to Origin" );
    const m   = piece( uid ).model!.mesh;
    const med = m.v.reduce( ( a, p ) => [a[0] + p[0] / m.v.length, a[1] + p[1] / m.v.length, a[2] + p[2] / m.v.length] as V3, [0, 0, 0] as V3 );
    check( med.every( ( x ) => Math.abs( x ) < 1e-6 ), `Geometry to Origin: the mesh's median on its origin ( ${med.map( ( x ) => x.toFixed( 4 ) ).join( ", " )} )` );

    // ---------------------------------------------------------------- Mirror, Shade
    await clear();
    uid = await cube();
    st().updateCustom( "Dent", [uid], ( o ) => ( { ...o, model: { ...o.model!, mesh: { ...o.model!.mesh, v: o.model!.mesh.v.map( ( p ) => ( p[0] > 0.9 && p[1] > 0.9 && p[2] > 0.9 ? [1.5, 1, 1] as V3 : p ) ) } } } ) );
    await sleep( 150 );
    const v0 = volume( piece( uid ).model!.mesh );
    await objectOp( "Mirror", "X Local" );
    const mm = piece( uid ).model!.mesh;
    check( mm.v.some( ( p ) => Math.abs( p[0] + 1.5 ) < 1e-6 ) && Math.abs( volume( mm ) - v0 ) < 1e-6 && v0 > 0, `Mirror › X Local: the stretched corner to -X ( X from ${Math.min( ...mm.v.map( ( q ) => q[0] ) ).toFixed( 3 )} to ${Math.max( ...mm.v.map( ( q ) => q[0] ) ).toFixed( 3 )} ), its faces still out ( volume ${volume( mm ).toFixed( 3 )}, was ${v0.toFixed( 3 )} )` );
    await objectOp( "Shade Smooth" );
    const smooth = piece( uid ).model!.mesh.s.every( Boolean );
    await objectOp( "Shade Flat" );
    check( smooth && piece( uid ).model!.mesh.s.every( ( x ) => !x ), "Shade Smooth: every face smooth; Shade Flat: none" );

    // ---------------------------------------------------------------- Ctrl+J
    await clear();
    const a = await cube();
    const b = await cube();
    st().updateCustom( "Move", [b], ( o ) => transformCustom( o, composeUnity( [3, 0, 0], [0, 0, 0], [-1, 1, 1] ) ) );
    await sleep( 150 );
    st().setSelection( [{ kind: "custom", uid: b }, { kind: "custom", uid: a }] );
    await sleep( 150 );
    await key( "j", { ctrl: true } );
    await sleep( 200 );
    const j = st().customObjects;
    check( j.length === 1 && j[0].uid === a && j[0].model!.mesh.v.length === 16, `Ctrl+J: into the active one ( ${j.length} piece, ${j[0]?.model?.mesh.v.length} vertices )` );
    check( j[0]?.parts[0].materials.length === 1, `Ctrl+J: the same material one slot ( ${j[0]?.parts[0].materials.length} )` );
    check( Math.abs( volume( j[0].model!.mesh ) - 16 ) < 1e-6, `Ctrl+J with one mirrored: both faces out ( volume ${volume( j[0].model!.mesh ).toFixed( 3 )}, 16 )` );

    // ---------------------------------------------------------------- P: Selection, named as Blender's
    await clear();
    uid = await cube();
    const name = st().labels[uid];
    await key( "Tab" ); await key( "3" );
    ed.sel = ( await import( "../../model/ops" ) ).selFromFaces( piece( uid ).model!.mesh, piece( uid ).model!.mesh.f.flatMap( ( f, i ) => ( f.every( ( v ) => piece( uid ).model!.mesh.v[v][1] > 0.99 ) ? [i] : [] ) ) );
    ed.sync();
    await key( "p" );
    await menu( "Selection" );
    const sep  = st().customObjects.filter( ( o ) => o.uid !== uid );
    const cut  = piece( uid ).model!.mesh;
    check( sep.length === 1 && sep[0].model!.mesh.v.length === 4 && cut.f.length === 5 && st().labels[sep[0].uid] === `${name}.001`, `P › Selection: a piece of its own ( ${sep[0]?.model?.mesh.v.length} vertices, "${st().labels[sep[0]?.uid]}" ), the rest ${cut.f.length} faces ( Blender: 4, "${name}.001", 5 )` );
    await key( "Tab" );

    // ---------------------------------------------------------------- Ctrl - / + / *: the volumes Blender's give
    for ( const [k, label, want] of [["-", "difference", 4], ["+", "union", 12], ["*", "intersect", 4]] as const ) {
      await clear();
      const keep = await cube();
      const tool = await cube();
      st().updateCustom( "Move", [tool], ( o ) => transformCustom( o, composeUnity( [1, 0, 0], [0, 0, 0], [1, 1, 1] ) ) );
      await sleep( 150 );
      st().setSelection( [{ kind: "custom", uid: tool }, { kind: "custom", uid: keep }] );
      await sleep( 150 );
      await key( k, { ctrl: true } );
      await waitFor( () => ( piece( keep ) && piece( keep ).model!.mesh.v.length !== 8 ? true : null ), "the boolean", 20000 ).catch( () => null );
      await sleep( 300 );
      const got = piece( keep ) ? volume( piece( keep ).model!.mesh ) : NaN;
      check( Math.abs( got - want ) < 1e-3, `Ctrl ${k}: ${label}, volume ${got.toFixed( 3 )} ( Blender ${want} )` );
    }
    io.stop();
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
