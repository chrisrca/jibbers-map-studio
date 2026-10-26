// Texture Paint's stencil ( Blender's stencil mapping ): an image laid over the 3D view that brushing paints through,
// or that's pressed onto the piece whole. And the Decal tool's image: stamped where the piece is clicked, its size in
// metres on the piece, facing the view.

import { create } from "zustand";
import { ipc } from "../core/ipc";

export interface StencilImage {
  w:    number;
  h:    number;
  // RGBA, sRGB
  data: Uint8Array;
  // for the overlay
  url:  string;
  name: string;
}

export interface StencilState {
  img:     StencilImage | null;
  // its centre on the 3D view ( pixels ), screen pixels per image pixel, turn ( radians )
  x:       number;
  y:       number;
  scale:   number;
  angle:   number;
  // how much of it shows over the view
  opacity: number;
  // moving it ( dragging moves, the corners scale, the knob turns ) rather than painting
  adjust:  boolean;
}

export const useStencil = create<StencilState>( () => ( {
  img:     null,
  x:       0,
  y:       0,
  scale:   1,
  angle:   0,
  opacity: 0.5,
  adjust:  false,
} ) );

/**
 * An image file read for the stencil or a decal.
**/
async function readImage( path: string ): Promise<StencilImage> {
  const im = await ipc.readImageRgba( path );
  const c  = document.createElement( "canvas" );
  c.width  = im.width;
  c.height = im.height;
  c.getContext( "2d" )!.putImageData( new ImageData( new Uint8ClampedArray( im.data ), im.width, im.height ), 0, 0 );
  const url = await new Promise<string>( ( res ) => c.toBlob( ( b ) => res( URL.createObjectURL( b! ) ), "image/png" ) );
  return { w: im.width, h: im.height, data: new Uint8Array( im.data ), url, name: path.split( /[\\/]/ ).pop() ?? path };
}

/**
 * Loads an image file as the stencil, centred on a view `w` × `h` and fitted to half of it.
**/
export async function loadStencil( path: string, w: number, h: number ) {
  const img = await readImage( path ), im = { width: img.w, height: img.h };
  const old = useStencil.getState().img;
  if ( old ) URL.revokeObjectURL( old.url );
  useStencil.setState( {
    img,
    x:     w / 2,
    y:     h / 2,
    scale: Math.min( ( w * 0.5 ) / im.width, ( h * 0.5 ) / im.height ),
    angle: 0,
  } );
}

export interface DecalState {
  img:   StencilImage | null;
  // across its longer side, on the piece ( m )
  size:  number;
  // its turn on the view ( radians )
  angle: number;
}

export const useDecal = create<DecalState>( () => ( {
  img:   null,
  size:  0.5,
  angle: 0,
} ) );

export async function loadDecal( path: string ) {
  const img = await readImage( path );
  const old = useDecal.getState().img;
  if ( old ) URL.revokeObjectURL( old.url );
  useDecal.setState( { img } );
}

export function clearStencil() {
  const old = useStencil.getState().img;
  if ( old ) URL.revokeObjectURL( old.url );
  useStencil.setState( { img: null, adjust: false } );
}

type RGBA = [number, number, number, number];

/**
 * The stencil's colour and cover ( 0..1, sRGB ) at a point of the 3D view, or null off it.
**/
export function stencilAt( s: StencilState, sx: number, sy: number ): RGBA | null {
  const im = s.img;
  if ( !im ) return null;
  const dx = sx - s.x, dy = sy - s.y, c = Math.cos( -s.angle ), n = Math.sin( -s.angle );
  const u  = ( dx * c - dy * n ) / s.scale + im.w / 2 - 0.5, v = ( dx * n + dy * c ) / s.scale + im.h / 2 - 0.5;
  if ( u < -0.5 || v < -0.5 || u > im.w - 0.5 || v > im.h - 0.5 ) return null;
  const x0        = Math.max( 0, Math.min( im.w - 1, Math.floor( u ) ) ), y0 = Math.max( 0, Math.min( im.h - 1, Math.floor( v ) ) );
  const x1        = Math.min( im.w - 1, x0 + 1 ), y1 = Math.min( im.h - 1, y0 + 1 );
  const tx        = Math.max( 0, Math.min( 1, u - x0 ) ), ty = Math.max( 0, Math.min( 1, v - y0 ) );
  const out: RGBA = [0, 0, 0, 0];
  const p         = ( x: number, y: number, i: number ) => im.data[( y * im.w + x ) * 4 + i];
  // premultiplied, so see-through pixels don't bleed their colour
  let a           = 0;
  for ( const [x, y, wt] of [[x0, y0, ( 1 - tx ) * ( 1 - ty )], [x1, y0, tx * ( 1 - ty )], [x0, y1, ( 1 - tx ) * ty], [x1, y1, tx * ty]] as const ) {
    const al = p( x, y, 3 ) / 255;
    a       += al * wt;
    for ( let i = 0; i < 3; i++ ) out[i] += ( p( x, y, i ) / 255 ) * al * wt;
  }
  if ( a <= 1e-4 ) return null;
  return [out[0] / a, out[1] / a, out[2] / a, a];
}
