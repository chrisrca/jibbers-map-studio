// Writing part of a texture straight to the GPU ( a stroke's rectangle, not the whole texture again ).

import * as THREE from "three/webgpu";

// What the terrain renderer needs of the WebGPU backend to write part of a texture.
export interface GpuAccess {
  device: { queue: { writeTexture( dst: { texture: unknown; origin: { x: number; y: number } }, data: Uint8Array, layout: { offset: number; bytesPerRow: number }, size: { width: number; height: number } ): void } };
  textureOf( t: THREE.Texture ): unknown;
}

/**
 * Writes rows y0..y1, columns x0..x1 of `data` ( `m` pixels a row, `bpp` bytes a pixel ) into the texture's copy on
 * the graphics card ( its top level ); false when it has none yet ( it's uploaded whole instead ).
**/
export function writeTextureRegion( gpu: GpuAccess | null, tex: THREE.Texture, data: Uint8Array, m: number, bpp: number, [x0, y0, x1, y1]: [number, number, number, number] ) {
  const gpuTex = gpu?.textureOf( tex );
  if ( !gpuTex || tex.version === 0 ) return false;
  gpu!.device.queue.writeTexture(
    { texture: gpuTex, origin: { x: x0, y: y0 } },
    data,
    { offset: ( y0 * m + x0 ) * bpp, bytesPerRow: m * bpp },
    { width:  x1 - x0 + 1, height: y1 - y0 + 1 },
  );
  return true;
}
