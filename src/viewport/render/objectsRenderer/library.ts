// The placeholders' models ( Map-Tools' glTFs, by feature id ), loaded once each.

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as THREE from "three/webgpu";
import { ipc, joinPath } from "../../../core/ipc";
import type { PlaceholderInfo } from "../../../core/types";

export class PlaceholderLibrary {
  private cache  = new Map<string, Promise<THREE.BufferGeometry | null>>();
  // the models loaded already ( taken straight away: no cube standing in for a moment )
  private loaded = new Map<string, THREE.BufferGeometry | null>();
  private loader = new GLTFLoader();
  constructor( public dir: string, public infos: PlaceholderInfo[] ) {}

  info( id: string ) {
    return this.infos.find( ( p ) => p.id === id );
  }

  geometry( id: string ): Promise<THREE.BufferGeometry | null> {
    const info = this.info( id );
    return info ? this.file( info.file ) : Promise.resolve( null );
  }

  /**
   * A model of the library's by its file, if it's loaded already.
  **/
  loadedFile( file: string ) {
    return this.loaded.get( file ) ?? null;
  }

  /**
   * A model of the library's by its file ( a lift's stations and mast have one each ).
  **/
  file( file: string ): Promise<THREE.BufferGeometry | null> {
    const id = file;
    let p    = this.cache.get( id );
    if ( !p ) {
      p = file
        ? ipc
            .readBinary( joinPath( this.dir, "placeholders", file ) )
            .then( ( buf ) => this.loader.parseAsync( buf, "" ) )
            .then( ( gltf ) => {
              let geo: THREE.BufferGeometry | null = null;
              gltf.scene.traverse( ( o ) => {
                if ( ( o as THREE.Mesh ).isMesh && !geo ) geo = ( o as THREE.Mesh ).geometry as THREE.BufferGeometry;
              } );
              ( geo as THREE.BufferGeometry | null )?.computeBoundingBox();
              this.loaded.set( file, geo );
              return geo;
            } )
            .catch( ( e ) => {
              console.error( "placeholder load failed", id, e );
              return null;
            } )
        : Promise.resolve( null );
      this.cache.set( id, p );
    }
    return p;
  }
}
