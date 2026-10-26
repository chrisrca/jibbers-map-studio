// The map's own lights in the view ( its floodlights, snow cannons, pieces' lights ), on once it's dark.

import * as THREE from "three/webgpu";
import { toThree, unityEulerToQuat } from "../../core/coords";
import { ipc, type GameLight } from "../../core/ipc";
import { composeUnity } from "../../core/transform";
import { useEditor } from "../../map/store";
import { redraw } from "../redraw";
import { type LightSource } from "../render/sceneLights";
import type { Engine } from "./engine";

// The map's lights, from its features and pieces.
export class MapLights {
  constructor( private engine: Engine ) {}

  // the game's features' lights, by feature ( read from the player's copy of the game )
  private gameLights: Record<string, GameLight[]> = {};

  /**
   * The game's features' lights read again ( with the game's look ), and the map's shown by them.
  **/
  reload() {
    void ipc.gameLights().then( ( l ) => {
      this.gameLights = l ?? {};
      this.sync();
    } ).catch( () => {} );
  }

  /**
   * The map's lights for the view: the game's features' ( by their settings: direction, Light Color and Intensity )
   * and the custom pieces' own.
  **/
  sync() {
    const st    = useEditor.getState(), out: LightSource[] = [];
    const S     = new THREE.Matrix4().makeScale( 1, 1, -1 );
    const param = ( o: ( typeof st.objects )[number], name: string ) => o.params?.[name]?.value;
    for ( const o of st.objects ) {
      const ls = this.gameLights[o.id];
      if ( !ls?.length ) continue;
      const info = this.engine.lib.info( o.id );
      const O    = composeUnity( o.position, o.rotation, o.scale );
      const tint = String( param( o, "light-color" ) ?? "#ffffff" );
      const k    = Number( param( o, "light-intensity" ) ?? 1 );
      for ( const l of ls ) {
        if ( l.type === 1 ) continue;
        if ( l.variant ) {
          const chosen = param( o, l.variant.param ) ?? info?.parameters.find( ( p ) => p.name === l.variant!.param )?.default;
          if ( String( chosen ) !== l.variant.option ) continue;
        }
        const W     = O.clone().multiply( S.clone().multiply( new THREE.Matrix4().fromArray( l.matrix ) ).multiply( S ) );
        const pos   = new THREE.Vector3().setFromMatrixPosition( W );
        const dir   = new THREE.Vector3( 0, 0, -1 ).transformDirection( W );
        const color = new THREE.Color( l.color[0], l.color[1], l.color[2] ).multiply( new THREE.Color( /^#[0-9a-f]{6}$/i.test( tint ) ? tint : "#ffffff" ) );
        out.push( { kind: l.type === 0 ? "spot" : "point", pos, dir, color, intensity: l.intensity * ( Number.isFinite( k ) ? k : 1 ), range: l.range, angle: l.spotAngle, inner: l.innerSpotAngle } );
      }
    }
    for ( const o of st.customObjects ) {
      for ( const l of ( o.lights ?? [] ) as { light_type: number; local_position: { x: number; y: number; z: number }; local_rotation: { x: number; y: number; z: number }; color: { r: number; g: number; b: number }; intensity: number; range: number; spot_angle: number; inner_spot_angle: number }[] ) {
        if ( l.light_type === 1 ) continue;
        const pos = toThree( [l.local_position.x, l.local_position.y, l.local_position.z] );
        const dir = new THREE.Vector3( 0, 0, -1 ).applyQuaternion( unityEulerToQuat( [l.local_rotation.x, l.local_rotation.y, l.local_rotation.z] ) );
        out.push( { kind: l.light_type === 0 ? "spot" : "point", pos, dir, color: new THREE.Color( l.color.r, l.color.g, l.color.b ), intensity: l.intensity, range: l.range, angle: l.spot_angle, inner: l.inner_spot_angle, owner: o.uid } );
      }
    }
    this.engine.sceneLights.setSources( out );
    redraw();
  }
}
