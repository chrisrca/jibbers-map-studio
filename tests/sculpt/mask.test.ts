import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { Terrain } from "../../src/terrain/terrain";
import { defaultSculpt } from "../../src/sculpt/brushes";
import { BrushStroke } from "../../src/sculpt/stroke/stroke";
import { Tile } from "../../src/viewport/render/terrainRenderer/tile";

// one 100 m chunk, 1 m apart, a tile of it drawn
function scene() {
  const t = new Terrain(), res = 101;
  t.setChunks( [{ key: "a", position: [0, 0, 0], size: [100, 200, 100], res, heights: new Float32Array( res * res ).fill( 20 ) }] );
  const tile  = new Tile( t.chunks[0], 0, 0, 0, new THREE.DataTexture( new Uint8Array( 4 ), 1, 1 ), false );
  // ( what the tile shows: the most masked of its mask texture, after it's drawn again )
  const shown = () => {
    tile.upload( t );
    return Math.max( ...( tile as unknown as { sculptMaskTex: { image: { data: Uint8Array } } } ).sculptMaskTex.image.data );
  };
  const stroke = ( invert = false, dabs = 1 ) => {
    const s = new BrushStroke( t, { ...defaultSculpt(), brush: "mask", radius: 8 }, [10, 10], { invert } );
    s.move( { x: 10, z: 10 } );
    for ( let k = 0; k < dabs; k++ ) s.dab( 10, 10 );
    s.end();
  };
  return { t, shown, stroke };
}

describe( "the sculpt mask", () => {
  it( "erasing ( Ctrl, or Erase ) takes it all away, its soft edge too, and the view shows it gone", () => {
    const { t, shown, stroke } = scene();
    stroke();
    expect( shown() ).toBe( 255 );
    stroke( true, 3 );
    expect( Math.max( ...t.chunks[0].mask! ) ).toBe( 0 );
    expect( shown() ).toBe( 0 );
  } );

  it( "cleared, the view shows none ( it kept showing the old one )", () => {
    const { t, shown, stroke } = scene();
    stroke();
    expect( shown() ).toBe( 255 );
    t.chunks[0].mask = null;
    expect( shown() ).toBe( 0 );
    stroke();
    expect( shown() ).toBe( 255 );
  } );
} );
