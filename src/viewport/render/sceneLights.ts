// The map's lights in the view: the game's own for its features ( a floodlight's two lamps, a snow cannon's, read from
// its prefab: gamelook/mod.rs ) with each one's Light Color and Intensity settings ( Map-Tools 0.5 ), and the lights
// custom pieces carry. The nearest the camera lit ( as lamps: viewport/render/lamps.ts ), once it's getting dark.

import * as THREE from "three/webgpu";
import { LAMPS, setLamps, type Lamp } from "./lamps";

export type LightSource = Lamp;

export class SceneLights {
  private sources: LightSource[] = [];
  // what was lit last ( nothing to draw again while it's the same )
  private last = "";

  setSources( list: LightSource[] ) {
    this.sources = list;
    this.last    = "";
  }

  get count() {
    return this.sources.length;
  }

  /**
   * The nearest lights to the camera lit, as dark as it is ( `night` 0..1 ). Whether anything changed to draw.
  **/
  update( camera: THREE.Camera, night: number ): boolean {
    const k    = night > 0.02 ? night : 0;
    const cam  = camera.position;
    const near = k > 0 ? this.sources.map( ( s, i ) => ( { i, d: s.pos.distanceToSquared( cam ) } ) ).sort( ( a, b ) => a.d - b.d ).slice( 0, LAMPS ) : [];
    const sig  = `${k.toFixed( 3 )}|${near.map( ( x ) => x.i ).join( "," )}`;
    if ( sig === this.last ) return false;
    this.last = sig;
    setLamps( near.map( ( x ) => this.sources[x.i] ), k );
    return true;
  }
}
