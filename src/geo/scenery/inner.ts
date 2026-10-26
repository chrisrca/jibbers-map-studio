// The play area's own terrain, edits and all, as one more coarse part of a real-world map's scenery: the game hides
// terrain chunks far from the rider, and the scenery ( never hidden ) then shows this in their place — an LOD for free.
// Rebuilt at export when the terrain has changed.
//
// It must never show through the real terrain: a coarse mesh drawn straight between its points rides above the
// ground in every hollow. So it starts on the ground, and each triangle's corners are lowered by the most it rides
// above the ground anywhere inside it ( looked at every quarter step ): hollows sink as far as they need, ridges and
// even slopes stay where they are.

import { ipc, joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { packMesh } from "./scenery";
import { sceneryPrefix, type RGBA } from "../../core/types";

// Metres further down. The game simplifies distant terrain ( Unity's terrain LOD: about 6-7 m of give at 1 km with its
// usual settings, more further off ), which sags its ridges below their real height: a stand-in only just under the
// real ground showed through it ( seen in game, looking down from above ). From anywhere it shows instead of the
// terrain, 10 m is well under a degree.
const UNDER = 10;

// The scenery's snow, as the game's terrain snow comes out in the same light: texture x tint, in linear light. Grey, not
// coloured: the two shaders agree on brightness but not on how the sky tints them, so fitting each colour to one
// moment's light ( as this first did ) bakes that sky into the snow. Measured in game on 2026-10-14 — Mont Tremblant
// ( untinted 250 white: 192,187,182 against the terrain's 175,166,163 ) and Crotched ( tinted: 177,164,161 against
// 170,162,161 ) — the two agree on 0.758 on average, within ~4 levels of the terrain in both.
const SNOW_TARGET = [0.758, 0.758, 0.758];
const toLinear    = ( c: number ) => ( c <= 0.04045 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4 );
const toSrgb      = ( c: number ) => ( c <= 0.0031308 ? c * 12.92 : 1.055 * c ** ( 1 / 2.4 ) - 0.055 );

/**
 * The scenery material's colour ( multiplies its texture ) that takes its texture's snow to the terrain's.
**/
function tintFor( snow: [number, number, number] ): RGBA {
  const [r, g, b] = snow.map( ( c, k ) => toSrgb( Math.min( 1, SNOW_TARGET[k] / Math.max( 0.05, toLinear( c / 255 ) ) ) ) );
  return { r, g, b, a: 1 };
}

// What was last written, per map ( a hash of the heights ): unchanged terrain isn't written again.
const written = new Map<string, number>();

// The last grid built ( for the self-test: is it under the terrain everywhere? ).
export let lastInner: { x0: number; z0: number; sx: number; sz: number; vw: number; vh: number; H: Float32Array; skirt?: number[] } | null = null;

/**
 * Builds ( or rebuilds ) the inner part when the map has scenery; whether anything changed.
**/
export async function updateSceneryInner(): Promise<boolean> {
  const st  = useEditor.getState();
  const dir = st.projectDir;
  const sc  = st.customObjects.find( ( o ) => o.parts.some( ( p ) => /^Scenery\/[^/]+\/strip-/.test( p.mesh ) ) );
  if ( !dir || !sc || !terrain.chunks.length ) return false;
  const prefix = sceneryPrefix( sc );
  const key    = `${prefix}/inner`;

  const { x0, z0, x1, z1 } = terrain.bounds();
  // ~500 cells a side at most ( a 20 km map: a point every 40 m ), 25 m at the finest; a whole number of cells each way,
  // so the mesh reaches every edge of the play area exactly
  const want               = Math.max( 25, Math.ceil( Math.max( x1 - x0, z1 - z0 ) / 500 ) );
  const vw                 = Math.ceil( ( x1 - x0 ) / want ) + 1, vh = Math.ceil( ( z1 - z0 ) / want ) + 1;
  const sx                 = ( x1 - x0 ) / ( vw - 1 ), sz = ( z1 - z0 ) / ( vh - 1 );
  // the ground every quarter step, from each chunk's own heights
  const q                  = 4;
  const fw                 = ( vw - 1 ) * q + 1, fh = ( vh - 1 ) * q + 1, fx = sx / q, fz = sz / q;
  const fine               = new Float32Array( fw * fh ).fill( NaN );
  for ( const c of terrain.chunks ) {
    const i0 = Math.max( 0, Math.ceil( ( c.position[0] - x0 ) / fx - 1e-6 ) ), i1 = Math.min( fw - 1, Math.floor( ( c.position[0] + c.size[0] - x0 ) / fx + 1e-6 ) );
    const j0 = Math.max( 0, Math.ceil( ( c.position[2] - z0 ) / fz - 1e-6 ) ), j1 = Math.min( fh - 1, Math.floor( ( c.position[2] + c.size[2] - z0 ) / fz + 1e-6 ) );
    for ( let j = j0; j <= j1; j++ )
      for ( let i = i0; i <= i1; i++ ) {
        const [sxi, szj] = c.toSample( Math.min( x0 + i * fx, c.position[0] + c.size[0] ), Math.min( z0 + j * fz, c.position[2] + c.size[2] ) );
        fine[j * fw + i] = c.position[1] + c.sampleBilinear( sxi, szj );
      }
    await new Promise( ( r ) => setTimeout( r, 0 ) );
  }
  // the mesh: a point every step, where the play area is, starting on the ground
  const H = new Float32Array( vw * vh );
  for ( let j = 0; j < vh; j++ ) for ( let i = 0; i < vw; i++ ) H[j * vw + i] = fine[j * q * fw + i * q];
  // each triangle: how far it rides above the ground anywhere inside it; its corners lowered by that much ( only
  // ever lowered, so no triangle is pushed back up by a neighbour's fix )
  const drop = new Float32Array( vw * vh );
  for ( let j = 0; j + 1 < vh; j++ )
    for ( let i = 0; i + 1 < vw; i++ ) {
      const A = H[j * vw + i], B = H[( j + 1 ) * vw + i], C = H[( j + 1 ) * vw + i + 1], D = H[j * vw + i + 1];
      if ( Number.isNaN( A + B + C + D ) ) continue;
      // ( a, b, c ) where v >= u, ( a, c, d ) below it: a = ( i, j ), b = ( i, j + 1 ), c = ( i + 1, j + 1 ), d = ( i + 1, j )
      let up1 = 0, up2 = 0;
      for ( let jj = 0; jj <= q; jj++ )
        for ( let ii = 0; ii <= q; ii++ ) {
          const g = fine[( j * q + jj ) * fw + i * q + ii];
          if ( Number.isNaN( g ) ) continue;
          const u = ii / q, v = jj / q;
          if ( v >= u ) up1 = Math.max( up1, A + ( C - B ) * u + ( B - A ) * v - g );
          if ( v <= u ) up2 = Math.max( up2, A + ( D - A ) * u + ( C - D ) * v - g );
        }
      for ( const [k, up] of [[j * vw + i, Math.max( up1, up2 )], [( j + 1 ) * vw + i, up1], [( j + 1 ) * vw + i + 1, Math.max( up1, up2 )], [j * vw + i + 1, up2]] as const )
        if ( up > drop[k] ) drop[k] = up;
    }
  for ( let k = 0; k < H.length; k++ ) H[k] -= drop[k] + UNDER;
  lastInner = { x0, z0, sx, sz, vw, vh, H };
  let hash  = 2166136261;
  for ( const v of new Uint32Array( H.buffer ) ) hash = Math.imul( hash ^ v, 16777619 );
  const hasPart = sc.parts.some( ( p ) => p.mesh === key );
  if ( written.get( dir ) === hash && hasPart ) return false;

  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], idx: number[] = [];
  const index         = new Int32Array( vw * vh ).fill( -1 );
  const at            = ( i: number, j: number ) => H[Math.min( vh - 1, Math.max( 0, j ) ) * vw + Math.min( vw - 1, Math.max( 0, i ) )];
  for ( let j = 0; j < vh; j++ )
    for ( let i = 0; i < vw; i++ ) {
      const h = H[j * vw + i];
      if ( Number.isNaN( h ) ) continue;
      index[j * vw + i] = pos.length / 3;
      pos.push( x0 + i * sx, h, z0 + j * sz );
      let gx = ( at( i + 1, j ) - at( i - 1, j ) ) / ( 2 * sx ), gz = ( at( i, j + 1 ) - at( i, j - 1 ) ) / ( 2 * sz );
      if ( !Number.isFinite( gx ) ) gx = 0;
      if ( !Number.isFinite( gz ) ) gz = 0;
      const l = Math.hypot( gx, 1, gz );
      nrm.push( -gx / l, 1 / l, -gz / l );
      uvs.push( 0, 0 ); // ( set to the strips' texture by the studio: scenery::set_inner )
    }
  for ( let j = 0; j + 1 < vh; j++ )
    for ( let i = 0; i + 1 < vw; i++ ) {
      const a = index[j * vw + i], b = index[( j + 1 ) * vw + i], c = index[( j + 1 ) * vw + i + 1], d = index[j * vw + i + 1];
      // wound as the scenery's strips are, so the ground faces up
      if ( a >= 0 && b >= 0 && c >= 0 ) idx.push( a, b, c );
      if ( a >= 0 && c >= 0 && d >= 0 ) idx.push( a, c, d );
    }

  // the skirt: all round the play area's edge, a wall from just under the terrain's edge ( a little above the
  // scenery's own inner edge, so the two overlap without a crack ) down to this mesh's edge, so nothing opens up
  // between them when the game hides the terrain there. Seen from either side; lit like the ground.
  const SKIRT_TOP = 0.2, SKIRT_STEP = 2;
  const edgeH     = ( i: number, j: number ) => H[j * vw + i];
  const skirt     = [0, 0, 0, 0];
  for ( const side of [0, 1, 2, 3] ) {
    // along x ( south, north ) or z ( west, east ); the row or column of the mesh on that edge
    const alongX                      = side < 2, len = alongX ? x1 - x0 : z1 - z0, n = Math.max( 1, Math.round( len / SKIRT_STEP ) );
    let prev: [number, number] | null = null;
    for ( let k = 0; k <= n; k++ ) {
      const t                = k / n, along = t * ( alongX ? vw - 1 : vh - 1 );
      const a                = Math.min( Math.floor( along ), ( alongX ? vw : vh ) - 2 ), u = along - a;
      const [ia, ja, ib, jb] = alongX ? [a, side === 0 ? 0 : vh - 1, a + 1, side === 0 ? 0 : vh - 1] : [side === 2 ? 0 : vw - 1, a, side === 2 ? 0 : vw - 1, a + 1];
      const bottom           = edgeH( ia, ja ) * ( 1 - u ) + edgeH( ib, jb ) * u;
      const x                = alongX ? x0 + t * ( x1 - x0 ) : side === 2 ? x0 : x1, z = alongX ? ( side === 0 ? z0 : z1 ) : z0 + t * ( z1 - z0 );
      // the terrain's own edge there ( a hair inside, so a chunk is found )
      const g                = terrain.heightAt( Math.min( x1 - 0.01, Math.max( x0 + 0.01, x ) ), Math.min( z1 - 0.01, Math.max( z0 + 0.01, z ) ) );
      if ( Number.isNaN( bottom ) || Number.isNaN( g ) ) {
        prev = null;
        continue;
      }
      const top = pos.length / 3;
      pos.push( x, g - SKIRT_TOP, z, x, bottom, z );
      nrm.push( 0, 1, 0, 0, 1, 0 );
      uvs.push( 0, 0, 0, 0 );
      if ( prev ) {
        const [pt, pb] = prev;
        idx.push( pt, pb, top + 1, pt, top + 1, top ); // one way round...
        idx.push( pt, top + 1, pb, pt, top, top + 1 ); // ...and the other
      }
      prev = [top, top + 1];
      skirt[side]++;
    }
  }
  if ( lastInner ) lastInner.skirt = skirt;
  if ( !idx.length ) return false;
  const rel      = "scenery/inner.bin";
  await ipc.writeBinary( joinPath( dir, rel ), packMesh( pos, uvs, idx, nrm ) );
  const [, snow] = await ipc.setSceneryInner( dir, prefix, rel );
  written.set( dir, hash );
  // every scenery part ( the inner one too ) tinted to the game's terrain snow
  const tint = tintFor( snow );
  const like = sc.parts.find( ( p ) => p.mesh.startsWith( `${prefix}/strip-` ) )!;
  useEditor.setState( ( s ) => ( {
    customObjects: s.customObjects.map( ( o ) => {
      if ( o.uid !== sc.uid ) return o;
      const parts = hasPart ? o.parts : [...o.parts, { ...like, mesh: key }];
      return { ...o, parts: parts.map( ( p ) => ( p.mesh.startsWith( `${prefix}/` ) ? { ...p, materials: p.materials.map( ( m ) => ( { ...m, base_color: tint } ) ) } : p ) ) };
    } ),
    dirty: true,
  } ) );
  return true;
}

/**
 * The surroundings painted again with rock from `angle` degrees of slope up, as one undoable step: the play area's
 * stand-in is brought up to date first, so its slopes are painted too.
**/
export async function repaintScenery( uid: string, angle: number ) {
  const st = useEditor.getState();
  const sc = st.customObjects.find( ( o ) => o.uid === uid );
  if ( !st.projectDir || !sc ) return;
  const prefix = sceneryPrefix( sc );
  await updateSceneryInner();
  const key = await ipc.repaintScenery( st.projectDir, prefix, angle );
  st.updateCustom( `Rocks from ${angle}°`, [uid], ( o ) => ( {
    ...o,
    scenery: { rockAngle: angle },
    parts:   o.parts.map( ( p ) => ( p.mesh.startsWith( `${prefix}/` ) ? { ...p, materials: p.materials.map( ( m ) => ( { ...m, base_tex: key } ) ) } : p ) ),
  } ) );
}
