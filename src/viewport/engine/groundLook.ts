// The ground's look: the game's snow and rock textures, the paint masks, and the terrain view's overlays.

import * as THREE from "three/webgpu";
import { ipc, joinPath } from "../../core/ipc";
import type { GameTerrain } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { snowLook } from "../render/terrainRenderer";
import type { Engine } from "./engine";

// The ground's textures and overlays.
export class GroundLook {
  constructor( private engine: Engine ) {}

  /**
   * The game's snow and rock textures on the ground ( its terrain material's colours and powder with them ).
  **/
  async useGameSnow( t: GameTerrain ) {
    const load = async ( file: string ) => {
      const bmp       = await createImageBitmap( new Blob( [await ipc.readBinary( joinPath( t.dir, file ) )], { type: "image/png" } ) );
      const tex       = new THREE.Texture( bmp );
      tex.colorSpace  = THREE.SRGBColorSpace;
      tex.wrapS       = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy  = 8;
      tex.needsUpdate = true;
      return tex;
    };
    if ( !t.textures.snow || !t.textures.rock ) return;
    const [snow, rock] = await Promise.all( [load( t.textures.snow ), load( t.textures.rock )] );
    // ( Unity's colours are sRGB )
    const colour       = ( u: { value: THREE.Color }, c: [number, number, number] | null ) => c && u.value.setRGB( c[0], c[1], c[2], THREE.SRGBColorSpace );
    colour( snowLook.baseColor,  t.baseColor  );
    colour( snowLook.rockColor,  t.rockColor  );
    colour( snowLook.thirdColor, t.thirdColor );
    if ( t.thirdCoverageDepth != null ) snowLook.thirdDepth.value     = t.thirdCoverageDepth;
    if ( t.thirdEdgeSharpness != null ) snowLook.thirdSharpness.value = t.thirdEdgeSharpness;
    this.engine.terrainR.useGameSnow( snow, rock );
  }

  async loadMask( rel: string ): Promise<THREE.Texture | null> {
    const dir = useEditor.getState().projectDir;
    if ( !dir ) return null;
    try {
      const buf = await ipc.readBinary( joinPath( dir, rel ) );
      const bmp = await createImageBitmap( new Blob( [buf], { type: "image/png" } ), {
        imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none",
      } );
      const tex       = new THREE.Texture( bmp );
      tex.flipY       = false; // PNG top row = Unity z = 0 ( see make_snow_mask.py notes )
      tex.colorSpace  = THREE.NoColorSpace;
      tex.needsUpdate = true;
      return tex;
    } catch ( e ) {
      console.warn( "mask load failed", rel, e );
      return null;
    }
  }

  /**
   * The terrain view's settings ( store.terrainView ) into the ground's shader.
  **/
  applyTerrainView() {
    const v                       = useEditor.getState().terrainView, rad = Math.PI / 180;
    snowLook.showSlope.value      = v.slope ? 1 : 0;
    snowLook.slopeMin.value       = v.slopeMin;
    snowLook.slopeMax.value       = Math.max( v.slopeMin + 1, v.slopeMax );
    snowLook.slopeStep.value      = v.slopeStep;
    snowLook.slopeOpacity.value   = v.slopeOpacity;
    snowLook.hillshade.value      = v.hillshade;
    snowLook.exaggeration.value   = v.exaggeration;
    snowLook.sunDir.value         = v.sunDir * rad;
    snowLook.sunHeight.value      = v.sunHeight * rad;
    snowLook.contours.value       = v.contours;
    snowLook.contourOpacity.value = v.contourOpacity;
  }
}
