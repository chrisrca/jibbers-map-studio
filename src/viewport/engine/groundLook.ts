// The ground's look: the game's snow and rock textures, the paint masks, and the terrain view's overlays.

import * as THREE from "three/webgpu";
import { ipc, joinPath } from "../../core/ipc";
import type { GameTerrain } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { snowLook } from "../render/terrainRenderer";
import { snowLighting } from "../render/terrainRenderer/snowLighting";
import type { Engine } from "./engine";

// The ground's textures and overlays.
export class GroundLook {
  constructor( private engine: Engine ) {}

  /**
   * The game's snow and rock textures on the ground ( its terrain material's colours and powder with them ).
  **/
  async useGameSnow( t: GameTerrain ) {
    const load = async ( file: string, colour = true ) => {
      const bmp       = await createImageBitmap( new Blob( [await ipc.readBinary( joinPath( t.dir, file ) )], { type: "image/png" } ), {
        premultiplyAlpha: "none", colorSpaceConversion: "none",
      } );
      const tex       = new THREE.Texture( bmp );
      tex.colorSpace  = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS       = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy  = 8;
      tex.needsUpdate = true;
      return tex;
    };
    if ( !t.textures.snow || !t.textures.rock ) return;
    const [snow, rock, bumps] = await Promise.all( [load( t.textures.snow ), load( t.textures.rock ), t.textures.snownormal ? load( t.textures.snownormal, false ) : null] );
    // ( Unity's colours are sRGB )
    const colour       = ( u: { value: THREE.Color }, c: [number, number, number] | null ) => c && u.value.setRGB( c[0], c[1], c[2], THREE.SRGBColorSpace );
    colour( snowLook.baseColor,  t.baseColor  );
    colour( snowLook.rockColor,  t.rockColor  );
    colour( snowLook.thirdColor, t.thirdColor );
    if ( t.thirdCoverageDepth != null ) snowLook.thirdDepth.value     = t.thirdCoverageDepth;
    if ( t.thirdEdgeSharpness != null ) snowLook.thirdSharpness.value = t.thirdEdgeSharpness;
    // how it's tiled: by world metres ( Custom/PisteSnow; the older shader's 30 and 150 times a 1 km chunk without )
    const scale                       = t.worldScale ?? 0.001;
    snowLook.snowScale.value          = scale * ( t.snowTexTiling ?? 30 );
    snowLook.rockScale.value          = scale * ( t.rockTexTiling ?? 150 );
    snowLook.snowBumps.value          = bumps ? t.snowNormalStrength ?? 1 : 0;
    if ( t.grooveStrength != null ) snowLook.grooveStrength.value = t.grooveStrength;
    if ( t.pisteTiling != null )    snowLook.pisteTiling.value    = t.pisteTiling;
    // and lit: its own way, unless it's set to PBR's
    const own                         = t.shader === "Custom/PisteSnow" && !t.usePbrLighting;
    snowLighting.on.value             = own ? 1 : 0;
    if ( t.snowWrap != null )      snowLighting.wrap.value      = t.snowWrap;
    if ( t.snowSpecular != null )  snowLighting.specular.value  = t.snowSpecular;
    if ( t.snowRoughness != null ) snowLighting.roughness.value = t.snowRoughness;
    if ( t.sheen != null )         snowLighting.sheen.value     = t.sheen;
    if ( t.snowScatter != null )   snowLighting.scatter.value   = t.snowScatter;
    this.engine.terrainR.useGameSnow( snow, rock, bumps );
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
    snowLook.relief.value         = v.relief;
  }
}
