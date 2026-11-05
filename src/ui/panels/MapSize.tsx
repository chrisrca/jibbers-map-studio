// Map size editor: the map's ground seen from above, the squares round it greyed out over the land there ( geo/land.ts:
// the real land, or one made up to match ). Hovered, a square shows + ( an empty one ) or − ( a chunk ). An empty one
// clicked is previewed in the view ( the surroundings faint meanwhile ), its settings below, then added; a chunk
// clicked is taken away, once asked. Either way the surroundings are built again to fit. Right-clicked, a chunk is
// picked: its repeats ( terrain/repeats.ts ) set below, and the seam where its copies meet fixed.

import { useEffect, useMemo, useRef, useState } from "react";
import { ask } from "../../app/ask";
import { isScenery } from "../../core/types";
import { landOf, type Land, type MapBox } from "../../geo/land";
import { addLandChunk, chunkDefaults, previewLandChunk, refitSurroundings, removeChunk, ringCells, type ChunkSettings } from "../../geo/landGround";
import { useEditor } from "../../map/store";
import { mapSize, showGroundPreview } from "../../terrain/mapSize";
import { fixSeam, repeatOf, seamAxis, seamGap, setRepeat, useRepeatPreview, type Repeat } from "../../terrain/repeats";
import { smoothSeam } from "../../terrain/seams";
import { terrain, type TerrainChunk } from "../../terrain/terrain";
import { getEngine } from "../Viewport";
import { NumberField, Slider, Vec3Field } from "../widgets/controls";

// Pixels a side of the little map, and of the pictures drawn into it.
const W = 220, PX = 220;

/**
 * Heights over `box` as a picture from above ( lit from the north-west ): `tone` the colours from shadow to light,
 * transparent where there are none.
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
function useLandPicture( land: Land | null, box: MapBox ): string | null {
  const [url, setUrl] = useState<string | null>( null );
  const key           = land ? `${land.kind}:${box.map( ( v ) => Math.round( v ) ).join( "," )}` : "";
  useEffect( () => {
    if ( !land ) return setUrl( null );
    let dead  = false;
    const ctl = new AbortController();
    land.coarse( box, ( box[2] - box[0] ) / PX, ctl.signal ).then( ( h ) => !dead && setUrl( shaded( box, h, [46, 112] ) ) ).catch( () => !dead && setUrl( null ) );
    return () => {
      dead = true;
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key] );
  return url;
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
  const [picked, setPicked] = useState<string | null>( null );
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
  // ( square, the map in its middle: the pictures are square too )
  const side = Math.max( maxx - minx, maxz - minz ), cx = ( minx + maxx ) / 2, cz = ( minz + maxz ) / 2;
  const box: MapBox = [cx - side / 2, cz - side / 2, cx + side / 2, cz + side / 2];
  const around      = useLandPicture( land, box );
  const ground      = useGroundPicture( box, layout );

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
    if ( sc ) getEngine()?.customR.setFaint( sc.uid, true );
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

  if ( !chunks.length ) return null;
  const scale = W / side;
  const rect  = ( b: MapBox ) => ( { x: ( b[0] - box[0] ) * scale, y: ( box[3] - b[3] ) * scale, w: ( b[2] - b[0] ) * scale, h: ( b[3] - b[1] ) * scale } );
  const { width, depth } = mapSize();

  const pick = ( b: MapBox ) => {
    setPicked( null );
    setOpts( chunkDefaults( kind ) );
    setAdding( b );
  };
  const add = async () => {
    const st = useEditor.getState(), b = adding!;
    setAdding( null );
    try {
      st.setBusy( "Adding ground…" );
      const source = await addLandChunk( b[0], b[1], opts, ( f ) => st.setBusy( `Adding ground… ${Math.round( f * 100 )}%` ) );
      await refit();
      st.toast( `Added ground from ${source}`, "success" );
    } catch ( e ) {
      st.toast( `Couldn't add the ground: ${e instanceof Error ? e.message : e}`, "error" );
    } finally {
      st.setBusy( null );
    }
  };
  const remove = async ( c: TerrainChunk ) => {
    const st = useEditor.getState();
    if ( chunks.length < 2 ) return st.toast( "That's the only ground the map has", "info" );
    const a = await ask( { title: "Remove this chunk?", answers: [{ id: "remove", label: "Remove", primary: true }] } );
    if ( a?.id !== "remove" ) return;
    setPicked( null );
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
      <svg className="mapsize-map" width={W} height={W} viewBox={`0 0 ${W} ${W}`}>
        { around && <image href={around} x={0} y={0} width={W} height={W} preserveAspectRatio="none" /> }
        { ground && <image href={ground} x={0} y={0} width={W} height={W} preserveAspectRatio="none" /> }
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
              className={`cell chunk${picked === c.key ? " picked" : ""}${repeatOf( c.key ).repeats > 1 ? " repeats" : ""}`}
              onClick={() => void remove( c )}
              onContextMenu={( e ) => {
                e.preventDefault();
                setAdding( null );
                setPicked( picked === c.key ? null : c.key );
              }}
            >
              <rect x={r.x + 0.5} y={r.y + 0.5} width={r.w - 1} height={r.h - 1} />
              <text x={r.x + r.w / 2} y={r.y + r.h / 2}>−</text>
              <title>{`Remove this chunk (right-click: its repeats and seams) · ${c.spacing.toFixed( 2 )} m between samples`}</title>
            </g>
          );
        } ) }
      </svg>
      <div className="note">
        {( width / 1000 ).toFixed( 2 )} × {( depth / 1000 ).toFixed( 2 )} km · {chunks.length} chunk{chunks.length > 1 ? "s" : ""}
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
      {picked && chunks.find( ( c ) => c.key === picked ) && <ChunkRepeat key={picked} c={chunks.find( ( c ) => c.key === picked )!} />}
    </div>
  );
}

/**
 * The picked chunk's repeats: how many copies, how far on each one is ( quick ones: straight on from an edge ), the
 * copies shown in the view or not, and the seam where they meet fixed.
**/
function ChunkRepeat( { c }: { c: TerrainChunk } ) {
  useEditor( ( s ) => s.chunkExtras );
  const preview             = useRepeatPreview( ( s ) => s.on );
  const [blend,  setBlend ] = useState( Math.min( 40, c.size[0] / 4 ) );
  const [fixing, setFixing] = useState( false );
  const r                   = repeatOf( c.key );
  // ( a drag changes it as it goes; letting go is one undo step )
  const start               = useRef<Repeat | null>( null );
  const live                = ( p: Partial<Repeat> ) => {
    start.current ??= repeatOf( c.key );
    const st = useEditor.getState();
    useEditor.setState( { chunkExtras: { ...st.chunkExtras, [c.key]: { ...st.chunkExtras[c.key], repeats: Math.max( 1, Math.round( p.repeats ?? r.repeats ) ), repeatOffset: p.offset ?? r.offset } } } );
  };
  const commit = () => {
    const was     = start.current;
    start.current = null;
    if ( !was ) return;
    const now = repeatOf( c.key );
    const st  = useEditor.getState();
    // ( put back as it was, then set as one step )
    useEditor.setState( { chunkExtras: { ...st.chunkExtras, [c.key]: { ...st.chunkExtras[c.key], repeats: was.repeats, repeatOffset: was.offset } } } );
    setRepeat( c.key, now );
  };
  const along = ( axis: 0 | 2, sign: 1 | -1 ) => setRepeat( c.key, { repeats: Math.max( 2, r.repeats ), offset: axis === 0 ? [sign * c.size[0], r.offset[1], 0] : [0, r.offset[1], sign * c.size[2]] } );
  const s     = seamAxis( c, r.offset ), gap = seamGap( c.key );
  const on    = ( axis: 0 | 2, sign: 1 | -1 ) => s?.axis === axis && s.dir === sign;
  return (
    <div className="props chunk-repeat">
      <div className="section">Chunk</div>
      <label>Chunk</label>
      <span className="muted">{c.key}</span>
      <label>Repeats</label>
      <NumberField value={r.repeats} step={1} min={1} max={100} digits={0} onChange={( repeats ) => live( { repeats } )} onCommit={commit} />
      <label>Along</label>
      <div className="seg">
        <button className={on( 0, 1 ) ? "on" : ""} onClick={() => along( 0, 1 )}>+X</button>
        <button className={on( 0, -1 ) ? "on" : ""} onClick={() => along( 0, -1 )}>−X</button>
        <button className={on( 2, 1 ) ? "on" : ""} onClick={() => along( 2, 1 )}>+Z</button>
        <button className={on( 2, -1 ) ? "on" : ""} onClick={() => along( 2, -1 )}>−Z</button>
      </div>
      <Vec3Field label="Offset" value={r.offset} digits={2} trim unit="m" onChange={( offset ) => live( { offset } )} onCommit={commit} />
      <label />
      <label className="check">
        <input type="checkbox" checked={preview} onChange={( e ) => useRepeatPreview.setState( { on: e.target.checked } )} /> Preview Repeats
      </label>
      { r.repeats > 1 && s && (
        <>
          <label>Seam</label>
          <span className="muted">{gap !== null ? `${gap.toFixed( 2 )} m step` : ""}</span>
          <label>Blend</label>
          <NumberField value={blend} step={1} min={1} max={Math.round( c.size[0] / 2 )} digits={0} unit="m" onChange={setBlend} />
          <label />
          <button
            className="btn"
            disabled={fixing}
            onClick={async () => {
              setFixing( true );
              try {
                await fixSeam( c.key, blend );
              } finally {
                setFixing( false );
              }
            }}
          >
            Fix Seam
          </button>
        </>
      ) }
      { c.adjacent.length > 0 && (
        <>
          <div className="section">Seams</div>
          <label>Blend</label>
          <NumberField value={blend} step={1} min={1} max={Math.round( c.size[0] / 2 )} digits={0} unit="m" onChange={setBlend} />
          <label>Smooth</label>
          <div className="seg">
            { ( [[0, "−X"], [1, "+X"], [2, "−Z"], [3, "+Z"]] as const ).filter( ( [side] ) => c.adjacent.some( ( n ) => n.side === side ) ).map( ( [side, label] ) => (
              <button key={side} onClick={() => { if ( !smoothSeam( c.key, side, blend ) ) useEditor.getState().toast( "That chunk's samples don't line up with this one's", "info" ); }}>{label}</button>
            ) ) }
          </div>
        </>
      ) }
    </div>
  );
}
