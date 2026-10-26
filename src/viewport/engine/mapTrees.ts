// The trees that came with the map ( kept with its chunks ): the game's own, and ones built from the map's meshes.

import * as THREE from "three/webgpu";
import { toThree, unityEulerToQuat, type V3 } from "../../core/coords";
import { type CustomObjectEntry } from "../../core/types";
import { useEditor } from "../../map/store";
import { newModelObject } from "../../model/objects";
import { terrain } from "../../terrain/terrain";
import { type TreeGroup } from "../render/objectsRenderer";
import type { Engine } from "./engine";

// A chunk's trees of one kind built from the map's own meshes: the prototype's parts, and where each one stands.
type BuiltTrees = { position: V3; size: V3; parts: CustomObjectEntry["parts"]; instances: number[] };

// The map's trees.
export class MapTrees {
  constructor( private engine: Engine ) {}

  // The map's own-mesh trees: each prototype's look built once ( as a piece at the origin ), every part drawn at
  // every tree ( its place in the chunk, turn about up, width and height ).
  builtTrees = new THREE.Group();
  private builtTreesKey = "";
  // what went wrong building a prototype's look, if anything did ( for the self-tests )
  treeError = "";

  /**
   * The trees that came with the map ( kept with its chunks ): the game's own ( by their placeholder ) and trees a
   * map built from its own meshes ( any map's: a prototype's parts ), each kind drawn instanced.
  **/
  sync() {
    const extras              = useEditor.getState().chunkExtras;
    const groups: TreeGroup[] = [];
    const built: BuiltTrees[] = [];
    for ( const c of terrain.chunks ) {
      const protos = ( extras[c.key]?.treePrototypes ?? [] ) as { object_id?: string; parts?: CustomObjectEntry["parts"]; instances?: number[] | null }[];
      for ( const t of protos ) {
        if ( !t.instances?.length ) continue;
        if ( t.object_id ) groups.push( { position: c.position, size: c.size, id: t.object_id, instances: t.instances } );
        else if ( t.parts?.length ) built.push( { position: c.position, size: c.size, parts: t.parts, instances: t.instances } );
      }
    }
    this.engine.objectsR?.trees.sync( groups );
    void this.syncBuiltTrees( built );
  }

  private async syncBuiltTrees( protos: BuiltTrees[] ) {
    // ( their meshes are the open map's: the renderer on it first, which the pieces' sync may not have done yet )
    const dir = useEditor.getState().projectDir;
    this.engine.customR.setProject( dir );
    const key = `${dir}|` + protos.map( ( p ) => `${p.position}:${p.parts.map( ( x ) => x.mesh ).join( "," )}:${p.instances.length}` ).join( "|" );
    if ( key === this.builtTreesKey ) return;
    this.builtTreesKey = key;
    this.builtTrees.clear();
    if ( !this.builtTrees.parent ) this.engine.scene.add( this.builtTrees );
    // ( each prototype's look built side by side, drawn when it's ready )
    await Promise.all( protos.map( async ( t, k ) => {
      try {
        const piece = { ...newModelObject( `tree-${k}`, { v: [], f: [], m: [], s: [], w: [] }, [0, 0, 0] ), model: undefined, parts: t.parts, colliders: [], lod_groups: [] } as CustomObjectEntry;
        const look  = await this.engine.customR.buildGroup( piece );
        if ( this.builtTreesKey !== key ) return;
        look.updateMatrixWorld( true );
        const b                   = Uint8Array.from( t.instances as ArrayLike<number> );
        const n                   = Math.floor( b.length / 28 );
        const dv                  = new DataView( b.buffer );
        const at: THREE.Matrix4[] = [];
        for ( let i = 0; i < n; i++ ) {
          const f   = ( j: number ) => dv.getFloat32( i * 28 + j * 4, true );
          const pos = toThree( [t.position[0] + f( 0 ) * t.size[0], t.position[1] + f( 1 ) * t.size[1], t.position[2] + f( 2 ) * t.size[2]] );
          at.push( new THREE.Matrix4().compose( pos, unityEulerToQuat( [0, ( f( 5 ) * 180 ) / Math.PI, 0] ), new THREE.Vector3( f( 3 ), f( 4 ), f( 3 ) ) ) );
        }
        look.traverse( ( m ) => {
          const mesh = m as THREE.Mesh;
          if ( !mesh.isMesh ) return;
          const inst = new THREE.InstancedMesh( mesh.geometry, mesh.material, n );
          at.forEach( ( a, i ) => inst.setMatrixAt( i, a.clone().multiply( mesh.matrixWorld ) ) );
          inst.instanceMatrix.needsUpdate = true;
          inst.computeBoundingSphere();
          inst.castShadow = true;
          this.builtTrees.add( inst );
        } );
      } catch ( e ) {
        this.treeError = `${e}`;
        console.error( "map tree", e );
      }
    } ) );
  }
}
