// Map size editor: the map's ground seen from above, the squares round it greyed out over the land there ( geo/land.ts:
// the real land, or one made up to match ), and the surroundings round that, their rings outlined. Dragged, it moves;
// the wheel zooms it; a double-click brings the map back to the middle. Hovered, a square shows + ( an empty one ) or −
// ( a chunk ). An empty one clicked is previewed in the view ( the surroundings faint meanwhile ), its settings below,
// then added; a chunk clicked is taken away, once asked. Either way the surroundings are built again to fit.

import { useEffect, useMemo, useRef, useState } from "react";
import { ask } from "../../app/ask";
import { isScenery } from "../../core/types";
import { landOf, type Land, type MapBox } from "../../geo/land";
import { addLandChunk, chunkCells, chunkDefaults, previewLandChunk, refitSurroundings, removeChunk, ringCells, surroundingsLook, type ChunkSettings } from "../../geo/landGround";
import { surroundingsPlan } from "../../geo/scenery/scenery";
import { useEditor } from "../../map/store";
import { mapSize, showGroundPreview } from "../../terrain/mapSize";
import { terrain, type TerrainChunk } from "../../terrain/terrain";
import { getEngine } from "../Viewport";
import { Slider } from "../widgets/controls";

// Pixels a side of the little map, and of the pictures drawn into it.
const W = 220, PX = 220;

/**
 * Heights over `box` as a picture from above ( lit from the north-west ): `tone` the colours from shadow to light,
 * transparent where there are none; PX pixels a side.
**/
function shaded( box: MapBox, at: ( x: number, z: number ) => number, tone: [number, number] ) {
  const c   = document.createElement( "canvas" );
  c.width   = c.height = PX;
  const g   = c.getContext( "2d" )!, img = g.createImageData( PX, PX );
  const sx  = ( box[2] - box[0] ) / PX, sz = ( box[3] - box[1] ) / PX;
  const h   = ( i: number, j: number ) => at( box[0] + ( i + 0.5 ) * sx, box[3] - ( j + 0.5 ) * sz );
  for ( let j = 0; j < PX; j++ )
    for ( let i = 0; i < PX; i++ ) {
      const v = h( i, j );
      if ( Number.isNaN( v ) ) continue;
      const l0 = h( Math.max( 0, i - 1 ), j ), r0 = h( Math.min( PX - 1, i + 1 ), j ), u0 = h( i, Math.max( 0, j - 1 ) ), d0 = h( i, Math.min( PX - 1, j + 1 ) );
      const gx = ( ( Number.isNaN( r0 ) ? v : r0 ) - ( Number.isNaN( l0 ) ? v : l0 ) ) / ( 2 * sx );
      const gz = ( ( Number.isNaN( u0 ) ? v : u0 ) - ( Number.isNaN( d0 ) ? v : d0 ) ) / ( 2 * sz );
      const l  = Math.max( 0, Math.min( 1, 0.62 - ( gx - gz ) * 0.9 ) ), t = tone[0] + ( tone[1] - tone[0] ) * l;
      img.data.set( [t, t + 2, t + 6, 255], ( j * PX + i ) * 4 );
    }
  g.putImageData( img, 0, 0 );
  return c.toDataURL();
}

/**
 * The land over `box` as a greyed picture from above; null till it's in, or without one.
**/
function useLandPicture( land: Land | null, box: MapBox ): { url: string; box: MapBox } | null {
  const [pic, setPic] = useState<{ url: string; box: MapBox } | null>( null );
  const key           = land ? `${land.kind}:${box.map( ( v ) => Math.round( v ) ).join( "," )}` : "";
  useEffect( () => {
    if ( !land ) return setPic( null );
    let dead  = false;
    const ctl = new AbortController();
    land.coarse( box, ( box[2] - box[0] ) / PX, ctl.signal ).then( ( h ) => !dead && setPic( { url: shaded( box, h, [46, 112] ), box } ) ).catch( () => {} );
    return () => {
      dead = true;
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key] );
  return pic;
}

/**
 * The map's ground over `box` as a picture from above ( the ground as it is when the layout last changed ).
**/
function useGroundPicture( box: MapBox, layout: number ) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo( () => ( terrain.chunks.length ? shaded( box, ( x, z ) => terrain.heightAt( x, z ), [150, 250] ) : null ), [layout, ...box] );
}

/**
 * The map's ground changed: its surroundings built again to fit, the app busy meanwhile.
**/
async function refit() {
  const st = useEditor.getState();
  try {
    await refitSurroundings();
  } catch ( e ) {
    st.toast( `Couldn't rebuild the surroundings: ${e instanceof Error ? e.message : e}`, "error" );
  }
}

export function MapSizeEditor() {
  const [layout, setLayout] = useState( terrain.layoutVersion );
  // the empty square being previewed, its settings, and the best data there is for it
  const [adding, setAdding] = useState<MapBox | null>( null );
  const [opts,   setOpts  ] = useState<ChunkSettings>( chunkDefaults( "made" ) );
  const [best,   setBest  ] = useState<string | null>( null );
  useEffect( () => {
    const off = terrain.onLayout( () => setLayout( terrain.layoutVersion ) );
    return () => void off();
  }, [] );

  const chunks = terrain.chunks;
  // ( the land round the map, and the empty squares next to it where more can go )
  const land   = chunks.length ? landOf() : null;
  const ring   = land ? ringCells() : [];
  let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
  for ( const b of [...chunks.map( ( c ): MapBox => [c.position[0], c.position[2], c.position[0] + c.size[0], c.position[2] + c.size[2]] ), ...ring] ) {
    minx = Math.min( minx, b[0] );
    minz = Math.min( minz, b[1] );
    maxx = Math.max( maxx, b[2] );
    maxz = Math.max( maxz, b[3] );
  }
  // ( the map and the squares round it, square, in the middle: as it's shown till it's moved or zoomed )
  const fitSide = Math.max( maxx - minx, maxz - minz ), fitX = ( minx + maxx ) / 2, fitZ = ( minz + maxz ) / 2;
  const fit: MapBox = [fitX - fitSide / 2, fitZ - fitSide / 2, fitX + fitSide / 2, fitZ + fitSide / 2];
  // the surroundings: how far out, and their rings ( as they'd be built )
  const sc       = useEditor( ( st ) => st.customObjects.find( isScenery ) );
  const look     = surroundingsLook();
  const reach    = sc ? look.radius : 0;
  const rings    = sc && chunks.length ? surroundingsPlan( chunkCells(), look.radius, look.detail ).rings : [];
  const all: MapBox = [fit[0] - reach, fit[1] - reach, fit[2] + reach, fit[3] + reach];
  // what's shown: moved and zoomed, else the map's fit ( its middle and how much a side ), kept on what's loaded ( the
  // surroundings' outer edge, the map and the squares round it inside it; without, the map and its squares ), no wider
  const outer: MapBox    = rings.length ? rings[rings.length - 1].outer : fit;
  const loaded: MapBox   = [Math.min( outer[0], minx ), Math.min( outer[1], minz ), Math.max( outer[2], maxx ), Math.max( outer[3], maxz )];
  const [view, setRawView] = useState<{ x: number; z: number; side: number } | null>( null );
  const keep    = ( v: { x: number; z: number; side: number } ) => {
    const side = Math.min( v.side, loaded[2] - loaded[0], loaded[3] - loaded[1] ), half = side / 2;
    const on   = ( c: number, lo: number, hi: number ) => ( lo + half > hi - half ? ( lo + hi ) / 2 : Math.min( hi - half, Math.max( lo + half, c ) ) );
    return { x: on( v.x, loaded[0], loaded[2] ), z: on( v.z, loaded[1], loaded[3] ), side };
  };
  const setView = ( v: { x: number; z: number; side: number } | null ) => setRawView( v && keep( v ) );
  const side            = view?.side ?? fitSide, cx = view?.x ?? fitX, cz = view?.z ?? fitZ;
  const box: MapBox     = [cx - side / 2, cz - side / 2, cx + side / 2, cz + side / 2];
  // the land: all of it ( the surroundings and all ) once, and, once it's been still a moment, sharper where it's looked at
  const [still, setStill] = useState<MapBox>( box );
  useEffect( () => {
    const t = setTimeout( () => setStill( box ), 300 );
    return () => clearTimeout( t );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.join( "," )] );
  const wide        = useLandPicture( land, all );
  const close       = useLandPicture( land, still );
  const ground      = useGroundPicture( fit, layout );

  // the square being added previewed in the view as its settings change ( the surroundings faint meanwhile )
  const kind = land?.kind ?? "made";
  useEffect( () => {
    if ( !adding ) return;
    const ctl = new AbortController();
    const t   = setTimeout( () => {
      previewLandChunk( adding[0], adding[1], opts, ctl.signal ).then( ( c ) => !ctl.signal.aborted && showGroundPreview( [c] ) ).catch( () => {} );
    }, 120 );
    return () => {
      clearTimeout( t );
      ctl.abort();
    };
  }, [adding, opts] );
  useEffect( () => {
    if ( !adding ) return;
    const sc = useEditor.getState().customObjects.find( isScenery );
    if ( sc ) getEngine()?.customR.setFaint( sc.uid, true, adding );
    setBest( null );
    const ctl = new AbortController();
    land?.best( adding, ctl.signal ).then( ( b ) => !ctl.signal.aborted && setBest( b ) ).catch( () => {} );
    return () => {
      ctl.abort();
      showGroundPreview( null );
      const s2 = useEditor.getState().customObjects.find( isScenery );
      if ( s2 ) getEngine()?.customR.setFaint( s2.uid, false );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding] );
  // ( let go: no preview left behind )
  useEffect( () => () => showGroundPreview( null ), [] );

  // ( dragged: moved, the click a drag ends with not a square's; the wheel: zoomed about the pointer )
  const svg   = useRef<SVGSVGElement>( null );
  const moved = useRef( false );
  // ( what's shown now, for the wheel: notches come faster than it's drawn )
  const shown = useRef( { x: cx, z: cz, side } );
  shown.current = { x: cx, z: cz, side };
  const onDown = ( e: React.PointerEvent ) => {
    if ( e.button !== 0 ) return;
    const x0 = e.clientX, y0 = e.clientY, from = { x: cx, z: cz };
    moved.current = false;
    const move = ( m: PointerEvent ) => {
      const dx = m.clientX - x0, dy = m.clientY - y0;
      if ( !moved.current && Math.hypot( dx, dy ) < 3 ) return;
      moved.current = true;
      const k       = side / ( svg.current?.clientWidth || W );
      setView( { x: from.x - dx * k, z: from.z + dy * k, side } );
    };
    const up = () => {
      window.removeEventListener( "pointermove", move );
      window.removeEventListener( "pointerup",   up   );
    };
    window.addEventListener( "pointermove", move );
    window.addEventListener( "pointerup",   up   );
  };
  const onWheel = ( e: React.WheelEvent ) => {
    const r    = svg.current!.getBoundingClientRect();
    const fx   = ( e.clientX - r.left ) / r.width, fz = ( e.clientY - r.top ) / r.height;
    const was  = shown.current;
    const next = Math.min( loaded[2] - loaded[0], loaded[3] - loaded[1], Math.max( 500, was.side * ( e.deltaY > 0 ? 1.2 : 1 / 1.2 ) ) );
    // ( the point under the pointer stays under it, as far as the land lets it )
    const px   = was.x - was.side / 2 + fx * was.side, pz = was.z + was.side / 2 - fz * was.side;
    shown.current = keep( { x: px + ( 0.5 - fx ) * next, z: pz - ( 0.5 - fz ) * next, side: next } );
    setView( shown.current );
  };

  if ( !chunks.length ) return null;
  const scale = W / side;
  const rect  = ( b: MapBox ) => ( { x: ( b[0] - box[0] ) * scale, y: ( box[3] - b[3] ) * scale, w: ( b[2] - b[0] ) * scale, h: ( b[3] - b[1] ) * scale } );
  const image = ( pic: { url: string; box: MapBox } | null ) => {
    if ( !pic ) return null;
    const r = rect( pic.box );
    return <image href={pic.url} x={r.x} y={r.y} width={r.w} height={r.h} preserveAspectRatio="none" />;
  };
  const { width, depth } = mapSize();

  const pick = ( b: MapBox ) => {
    if ( moved.current ) return;
    setOpts( chunkDefaults( kind ) );
    setAdding( b );
  };
  const add = async () => {
    const st = useEditor.getState(), b = adding!;
    setAdding( null );
    try {
      st.setBusy( "Adding ground…" );
      const source = await addLandChunk( b[0], b[1], opts, ( f ) => st.setBusy( "Adding ground…", f ) );
      await refit();
      st.toast( `Added ground from ${source}`, "success" );
    } catch ( e ) {
      st.toast( `Couldn't add the ground: ${e instanceof Error ? e.message : e}`, "error" );
    } finally {
      st.setBusy( null );
    }
  };
  const remove = async ( c: TerrainChunk ) => {
    if ( moved.current ) return;
    const st = useEditor.getState();
    if ( chunks.length < 2 ) return st.toast( "That's the only ground the map has", "info" );
    const a = await ask( { title: "Remove this chunk?", answers: [{ id: "remove", label: "Remove", primary: true }] } );
    if ( a?.id !== "remove" ) return;
    removeChunk( c.key );
    try {
      st.setBusy( "Rebuilding the surroundings…" );
      await refit();
    } finally {
      st.setBusy( null );
    }
  };

  return (
    <div className="mapsize">
      <svg
        ref={svg}
        className="mapsize-map"
        width={W}
        height={W}
        viewBox={`0 0 ${W} ${W}`}
        onPointerDown={onDown}
        onWheel={onWheel}
        onDoubleClick={() => setView( null )}
      >
        {image( wide )}
        {/* ( the sharp picture where it was made, kept while the view moves on: the next one replaces it once it's in ) */}
        {image( close )}
        { ground && image( { url: ground, box: fit } ) }
        { rings.map( ( r, k ) => {
          const q = rect( r.outer );
          return (
            <rect key={`s${k}`} className={`surround${k === rings.length - 1 ? " last" : ""}`} x={q.x} y={q.y} width={q.w} height={q.h}>
              <title>{`Surroundings${rings.length > 1 ? ` ring ${k + 1}` : ""}: ${r.step} m between vertices`}</title>
            </rect>
          );
        } ) }
        { ring.map( ( b ) => {
          const r = rect( b ), on = adding && adding[0] === b[0] && adding[1] === b[1];
          return (
            <g key={`r${b[0]},${b[1]}`} className={`cell add${on ? " on" : ""}`} onClick={() => pick( b )}>
              <rect x={r.x + 0.5} y={r.y + 0.5} width={r.w - 1} height={r.h - 1} />
              <text x={r.x + r.w / 2} y={r.y + r.h / 2}>+</text>
              <title>Add this chunk</title>
            </g>
          );
        } ) }
        { chunks.map( ( c ) => {
          const r = rect( [c.position[0], c.position[2], c.position[0] + c.size[0], c.position[2] + c.size[2]] );
          return (
            <g
              key={c.key}
              className="cell chunk"
              onClick={() => void remove( c )}
            >
              <rect x={r.x + 0.5} y={r.y + 0.5} width={r.w - 1} height={r.h - 1} />
              <text x={r.x + r.w / 2} y={r.y + r.h / 2}>−</text>
              <title>{`Remove this chunk · ${c.spacing.toFixed( 2 )} m between samples`}</title>
            </g>
          );
        } ) }
      </svg>
      <div className="note">
        {( width / 1000 ).toFixed( 2 )} × {( depth / 1000 ).toFixed( 2 )} km · {chunks.length} chunk{chunks.length > 1 ? "s" : ""}
        {reach ? ` · surroundings ${( reach / 1000 ).toFixed( 0 )} km round` : ""}
      </div>
      { adding && (
        <div className="props chunk-add">
          <div className="section">New chunk</div>
          { kind === "real"
            ? (
              <>
                <label>Data</label>
                <span className="muted">{best ?? "…"}</span>
              </>
            )
            : (
              <>
                <label />
                <Slider label="Hills" value={opts.hills} min={0} max={2} step={0.05} onChange={( hills ) => setOpts( ( o ) => ( { ...o, hills } ) )} fmt={( v ) => `${v.toFixed( 2 )}×`} />
                <label />
                <Slider label="Bumps" value={opts.bumps} min={0} max={3} step={0.05} onChange={( bumps ) => setOpts( ( o ) => ( { ...o, bumps } ) )} fmt={( v ) => `${v.toFixed( 2 )}×`} />
                <label />
                <button className="btn small" onClick={() => setOpts( ( o ) => ( { ...o, variation: o.variation + 1 } ) )}>New variation</button>
              </>
            ) }
          <label />
          <Slider label="Blend" value={opts.blend} min={10} max={400} step={5} onChange={( blend ) => setOpts( ( o ) => ( { ...o, blend } ) )} fmt={( v ) => `${v.toFixed( 0 )} m`} />
          <label />
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn" onClick={() => setAdding( null )}>Cancel</button>
            <button className="btn primary" onClick={() => void add()}>Add</button>
          </div>
        </div>
      ) }
    </div>
  );
}
