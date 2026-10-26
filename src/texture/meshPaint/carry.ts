// A piece's paint made ready, and carried across when its shape or texture size changes ( each texel to the nearest
// facing the same way ).

import type { CustomObjectEntry } from "../../core/types";
import { history } from "../../map/history";
import { useEditor } from "../../map/store";
import { type ModelData, evaluate } from "../../model/build";
import type { Mesh } from "../../model/mesh";
import type { Atlas } from "../../model/uv";
import { type TexelMap, lastMaps, paintAtlas, texelMap, topoSig } from "./atlas";
import { PAINT_SIZE, paintKey } from "./index";
import { type Channel, type PieceTexture, changed, materialFor, textures, updateNormal } from "./textures";

/**
 * The colour a fresh texture starts as: the piece's own ( white then goes into the material, Blender's way ).
**/
const startColour = ( o: CustomObjectEntry ) => {
  const c = o.parts[0]?.materials[0]?.base_color ?? { r: 0.8, g: 0.8, b: 0.8, a: 1 };
  return [c.r, c.g, c.b].map( ( x ) => Math.round( Math.min( 1, Math.max( 0, x ) ) * 255 ) );
};

/**
 * The model's paint keeping `atlas` as its layout ( and its size ).
**/
function keepLayout( uid: string, atlas: Atlas, g: Mesh, n: number ) {
  const paint = { size: n, sig: atlas.sig, topo: topoSig( g ), uv: Array.from( atlas.uv, ( x ) => Math.round( x * 1e6 ) / 1e6 ) };
  const st    = useEditor.getState();
  useEditor.setState( { customObjects: st.customObjects.map( ( x ) => ( x.uid === uid && x.model ? { ...x, model: { ...x.model, paint } } : x ) ) } );
}

/**
 * The piece's texture, ready to paint on its shape as it is now: made ( in the piece's colour ) the first time, and
 * carried across when its faces change. Returns it, its layout, and ( worked out when asked for ) its texel map.
**/
export function prepare( o: CustomObjectEntry & { model: ModelData } ) {
  const g                   = evaluate( o.model );
  const atlas               = paintAtlas( o.model, g ), sig = atlas.sig;
  const n                   = o.model.paint?.size ?? PAINT_SIZE;
  let made: TexelMap | null = null;
  const mapNow              = () => ( made ??= texelMap( g, atlas, n ) );
  let T                     = textures.get( o.uid );
  if ( !T ) {
    const rgba = new Uint8Array( n * n * 4 ), c = startColour( o );
    for ( let k = 0; k < n * n; k++ ) rgba.set( [c[0], c[1], c[2], 255], k * 4 );
    textures.set( o.uid, ( T = { uid: o.uid, n, rgba, ch: {}, normal: null, sig, dirty: true, version: 0, pending: "all" } ) );
    // the material's colour goes into the texture: white from here ( the slots keep their own tints )
    const st = useEditor.getState();
    useEditor.setState( {
      customObjects: st.customObjects.map( ( x ) =>
        x.uid === o.uid && x.model
          ? {
              ...x,
              model: { ...x.model, paint: { size: n, sig, topo: topoSig( g ), uv: Array.from( atlas.uv, ( u ) => Math.round( u * 1e6 ) / 1e6 ) } },
              // every slot takes the paint as its texture ( in the game too: written at export as paintKey )
              parts: x.parts.map( ( p, i ) => ( i === 0 ? { ...p, materials: p.materials.map( ( m, s ) => ( { ...m, base_tex: paintKey( o.uid ), ...( s === 0 ? { base_color: { r: 1, g: 1, b: 1, a: m.base_color.a } } : {} ) } ) ) } : p ) ),
            }
          : x,
      ),
    } );
    changed( T );
  } else if ( T.sig !== sig ) {
    // its faces changed: the paint carried across by position from its old layout ( if this session still has it )
    const old = lastMaps.get( `${T.sig}@${T.n}` );
    if ( old ) {
      const match = matchTexels( old, mapNow() );
      T.rgba      = carry( match, T.rgba );
      for ( const k of Object.keys( T.ch ) as Exclude<Channel, "colour">[] ) T.ch[k] = carry( match, T.ch[k]! );
      updateNormal( T );
    }
    T.sig = sig;
    keepLayout( o.uid, atlas, g, n );
    changed( T );
  } else if ( !o.model.paint?.uv || o.model.paint.topo !== topoSig( g ) ) keepLayout( o.uid, atlas, g, n );
  // ( the layout the old one is carried from next time )
  if ( !lastMaps.has( `${sig}@${n}` ) ) mapNow();
  return {
    T, g, atlas,
    get map() {
      return mapNow();
    },
  };
}

/**
 * Which way each used texel faces ( its strongest axis and sign: 0..5 ), and its place across that way ( two
 * coordinates ) and along it.
**/
function facings( m: TexelMap ) {
  const N = m.n * m.n, side = new Int8Array( N ).fill( -1 ), U = new Float32Array( N ), V = new Float32Array( N ), D = new Float32Array( N );
  for ( let k = 0; k < N; k++ ) {
    if ( !m.used[k] ) continue;
    const x  = Math.abs( m.nrm[k * 3] ), y = Math.abs( m.nrm[k * 3 + 1] ), z = Math.abs( m.nrm[k * 3 + 2] );
    const ax = x >= y && x >= z ? 0 : y >= z ? 1 : 2;
    side[k]  = ax * 2 + ( m.nrm[k * 3 + ax] >= 0 ? 0 : 1 );
    const a  = ax === 0 ? 1 : 0, b = ax === 2 ? 1 : 2;
    U[k]     = m.pos[k * 3 + a ];
    V[k]     = m.pos[k * 3 + b ];
    D[k]     = m.pos[k * 3 + ax];
  }
  return { side, U, V, D };
}

/**
 * For a texture laid out on one shape, made for another: each texel of the new layout's old one, the one that faces
 * the same way and lies nearest across its face ( depth counts for little: a face pulled out keeps its paint, a new
 * side carries on the side's ); -1 for none near, -2 for an unused texel. `carry` takes the colours across.
**/
export function matchTexels( from: TexelMap, to: TexelMap ): Int32Array {
  const A  = facings( from ), B = facings( to );
  // how far apart the old texels are: cells two of them across, and coarse ones for what's far from any
  let used = 0;
  for ( let k = 0; k < from.n * from.n; k++ ) if ( A.side[k] >= 0 ) used++;
  const span     = Math.max( 1e-3, from.cell * 50                                         );
  const ts       = Math.max( 1e-4, Math.sqrt( ( span * span * 6 ) / Math.max( 1, used ) ) );
  const fine     = ts * 2, coarse = ts * 16;
  const key      = ( i: number, j: number, side: number ) => ( ( i + 1048576 ) * 2097152 + ( j + 1048576 ) ) * 8 + side;
  const fineGrid = new Map<number, number[]>(), coarseGrid = new Map<number, number>();
  for ( let k = 0; k < from.n * from.n; k++ ) {
    const sd = A.side[k];
    if ( sd < 0 ) continue;
    const fk = key( Math.floor( A.U[k] / fine ), Math.floor( A.V[k] / fine ), sd );
    const l  = fineGrid.get( fk );
    if ( l ) l.push( k );
    else fineGrid.set( fk, [k] );
    const ck = key( Math.floor( A.U[k] / coarse ), Math.floor( A.V[k] / coarse ), sd );
    if ( !coarseGrid.has( ck ) ) coarseGrid.set( ck, k );
  }
  const out = new Int32Array( to.n * to.n ).fill( -2 );
  for ( let k = 0; k < to.n * to.n; k++ ) {
    const sd = B.side[k];
    if ( sd < 0 ) continue;
    const u        = B.U[k], v = B.V[k], d = B.D[k];
    let best       = -1, bd = Infinity;
    const consider = ( o: number ) => {
      const dist = ( A.U[o] - u ) ** 2 + ( A.V[o] - v ) ** 2 + 0.05 * ( A.D[o] - d ) ** 2;
      if ( dist < bd ) { bd = dist; best = o; }
    };
    const fu = Math.floor( u / fine ), fv = Math.floor( v / fine );
    for ( let i = -1; i <= 1; i++ ) for ( let j = -1; j <= 1; j++ ) for ( const o of fineGrid.get( key( fu + i, fv + j, sd ) ) ?? [] ) consider( o );
    if ( best < 0 ) {
      // far from any: the nearest of the coarse cells' texels, rings outwards ( and one more once found )
      const cu = Math.floor( u / coarse ), cv = Math.floor( v / coarse );
      for ( let ring = 0, extra = -1; ring <= 64 && extra !== 0; ring++ ) {
        if ( best >= 0 ) extra = extra < 0 ? 1 : extra - 1;
        for ( let i = -ring; i <= ring; i++ )
          for ( let j = -ring; j <= ring; j++ ) {
            if ( Math.max( Math.abs( i ), Math.abs( j ) ) !== ring ) continue;
            const o = coarseGrid.get( key( cu + i, cv + j, sd ) );
            if ( o !== undefined ) consider( o );
          }
      }
    }
    out[k] = best;
  }
  return out;
}

/**
 * Pixels carried to a new layout by `matchTexels`' match ( white where nothing matched ).
**/
export function carry( match: Int32Array, px: Uint8Array ): Uint8Array {
  const out = new Uint8Array( match.length * 4 );
  for ( let k = 0; k < match.length; k++ ) {
    const o = match[k];
    if ( o >= 0 ) out.set( px.subarray( o * 4, o * 4 + 4 ), k * 4 );
    else if ( o === -1 ) out.set( [255, 255, 255, 255], k * 4 );
  }
  return out;
}

/**
 * The piece's look ( texture/bake.ts bakeLook, laid out on its texture ) as its paint: every slot then reads the paint
 * as it is ( white, no tiling, no normal map of its own ), its metallic and roughness maps too when baked.
**/
export function setBakedLook( o: CustomObjectEntry & { model: ModelData }, baked: { rgba: Uint8Array; metallic: Uint8Array | null; roughness: Uint8Array | null } ) {
  const { T } = prepare( o );
  if ( baked.rgba.length !== T.rgba.length ) return;
  T.rgba   = baked.rgba;
  const st = useEditor.getState();
  useEditor.setState( {
    customObjects: st.customObjects.map( ( x ) =>
      x.uid === o.uid
        ? {
            ...x,
            parts: x.parts.map( ( p, i ) => ( i === 0 ? { ...p, materials: p.materials.map( ( m ) => ( { ...m, base_tex: paintKey( o.uid ), base_color: { r: 1, g: 1, b: 1, a: m.base_color.a }, tiling: { x: 1, y: 1 }, offset: { x: 0, y: 0 }, normal_tex: "" } ) ) } : p ) ),
          }
        : x,
    ),
  } );
  const now = useEditor.getState().customObjects.find( ( x ) => x.uid === o.uid )!;
  for ( const ch of ["metallic", "roughness"] as const ) {
    const px = baked[ch];
    if ( !px || px.length !== T.rgba.length ) continue;
    T.ch[ch] = px;
    materialFor( now, ch );
    changed( T, undefined, ch );
  }
  T.dirty = true;
  changed( T );
}

/**
 * An image's pixels at another size ( bilinear: the layout is the same, only finer or coarser ).
**/
export function resample( px: Uint8Array, n: number, m: number ): Uint8Array {
  const out = new Uint8Array( m * m * 4 ), s = n / m;
  for ( let y = 0; y < m; y++ ) {
    const fy = Math.min( n - 1, Math.max( 0, ( y + 0.5 ) * s - 0.5 ) ), y0 = Math.floor( fy ), y1 = Math.min( n - 1, y0 + 1 ), ty = fy - y0;
    for ( let x = 0; x < m; x++ ) {
      const fx = Math.min( n - 1, Math.max( 0, ( x + 0.5 ) * s - 0.5 ) ), x0 = Math.floor( fx ), x1 = Math.min( n - 1, x0 + 1 ), tx = fx - x0;
      const a  = ( y0 * n + x0 ) * 4, b = ( y0 * n + x1 ) * 4, c = ( y1 * n + x0 ) * 4, d = ( y1 * n + x1 ) * 4;
      for ( let i = 0; i < 4; i++ ) {
        const top                  = px[a + i] + ( px[b + i] - px[a + i] ) * tx, bot = px[c + i] + ( px[d + i] - px[c + i] ) * tx;
        out[( y * m + x ) * 4 + i] = Math.round( top + ( bot - top ) * ty );
      }
    }
  }
  return out;
}

/**
 * The piece's texture made `size` across ( every map with it ), one undo step.
**/
export function resizeTexture( o: CustomObjectEntry & { model: ModelData }, size: number ) {
  const T = textures.get( o.uid ) ?? prepare( o ).T;
  if ( T.n === size ) return;
  type Snap    = { n: number; rgba: Uint8Array; ch: PieceTexture["ch"] };
  const snap   = ( t: PieceTexture ): Snap => ( { n: t.n, rgba: t.rgba, ch: { ...t.ch } } );
  const before = snap( T );
  const put    = ( s: Snap ) => {
    const t = textures.get( o.uid );
    if ( !t ) return;
    t.n      = s.n;
    t.rgba   = s.rgba;
    t.ch     = { ...s.ch };
    t.normal = null;
    updateNormal( t );
    t.pending = "all";
    t.dirty   = true;
    const st  = useEditor.getState();
    useEditor.setState( {
      customObjects: st.customObjects.map( ( x ) => ( x.uid === o.uid && x.model?.paint ? { ...x, model: { ...x.model, paint: { ...x.model.paint, size: s.n } } } : x ) ),
    } );
    changed( t );
    for ( const ch of Object.keys( t.ch ) as Exclude<Channel, "colour">[] ) changed( t, undefined, ch );
  };
  const after: Snap = { n: size, rgba: resample( T.rgba, T.n, size ), ch: {} };
  for ( const ch of Object.keys( T.ch ) as Exclude<Channel, "colour">[] ) after.ch[ch] = resample( T.ch[ch]!, T.n, size );
  put( after );
  history.push( { label: `Texture ${size} px`, undo: () => put( before ), redo: () => put( after ), bytes: ( before.rgba.byteLength + after.rgba.byteLength ) * ( 1 + Object.keys( T.ch ).length ) } );
}
