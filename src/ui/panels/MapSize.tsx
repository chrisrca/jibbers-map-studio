// Map size editor: a little map of the chunks with buttons to add or remove a strip of ground on each side. A chunk
// clicked on it is picked: its repeats ( terrain/repeats.ts ) set below, and the seam where its copies meet fixed.

import { Icon } from "../widgets/icons";
import { useEffect, useRef, useState } from "react";
import { fixSeam, repeatOf, seamAxis, seamGap, setRepeat, useRepeatPreview, type Repeat } from "../../terrain/repeats";
import { NumberField, Vec3Field } from "../widgets/controls";
import type { TerrainChunk } from "../../terrain/terrain";
import { applyGrow, cancelGrow, DEFAULT_GROW, mapSize, previewGrow, shrinkMap, type GrowParams, type Side } from "../../terrain/mapSize";
import { groundRes } from "../../terrain/generate";
import { Slider } from "../widgets/controls";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";

const SIDES: { side: Side; label: string; area: string }[] = [
  { side: "north", label: "Far side (+Z)",  area: "n" },
  { side: "south", label: "Near side (−Z)", area: "s" },
  { side: "west",  label: "Left (−X)",      area: "w" },
  { side: "east",  label: "Right (+X)",     area: "e" },
];

export function MapSizeEditor() {
  const [, bump]            = useState( 0 );
  const [adding, setAdding] = useState<Side | null>( null );
  const [params, setParams] = useState<GrowParams>( DEFAULT_GROW );
  const [busy, setBusy]     = useState( false );
  const [picked, setPicked] = useState<string | null>( null );
  useEffect( () => {
    const off = terrain.onLayout( () => bump( ( n ) => n + 1 ) );
    return () => {
      off();
      cancelGrow();
    };
  }, [] );
  // refresh the preview when the side or a setting changes ( at most once a frame; the first look at an edge takes a moment )
  const frame = useRef( 0 );
  useEffect( () => {
    if ( !adding ) return;
    cancelAnimationFrame( frame.current );
    frame.current = requestAnimationFrame( () => {
      setBusy( true );
      setTimeout( () => {
        previewGrow( adding, params );
        setBusy( false );
      }, 0 );
    } );
  }, [adding, params] );
  const set  = ( k: keyof GrowParams ) => ( v: number ) => setParams( ( p ) => ( { ...p, [k]: v } ) );
  const stop = () => {
    cancelGrow();
    setAdding( null );
  };

  const chunks = terrain.chunks;
  if ( !chunks.length ) return null;
  let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
  for ( const c of chunks ) {
    minx = Math.min( minx, c.position[0] );
    minz = Math.min( minz, c.position[2] );
    maxx = Math.max( maxx, c.position[0] + c.size[0] );
    maxz = Math.max( maxz, c.position[2] + c.size[2] );
  }
  const W                = 150, scale = W / Math.max( maxx - minx, maxz - minz );
  const finest           = Math.min( ...chunks.map( ( c ) => c.spacing ) );
  const { width, depth } = mapSize();
  const res              = groundRes( Math.max( ...chunks.map( ( c ) => c.size[0] ) ) );

  return (
    <div className="mapsize">
      <div className="mapsize-grid">
        { SIDES.map( ( { side, label, area } ) => (
          <div key={side} className={`mapsize-side ${area}`}>
            <button
              title={`Add ground: ${label} (shows a preview to adjust first)`}
              className={adding === side ? "on" : ""}
              onClick={() => ( adding === side ? stop() : setAdding( side ) )}
            ><Icon name="plus" size={12} /></button>
            <button
              title={`Remove the edge strip: ${label}`}
              onClick={() => {
                if ( !confirm( `Remove the strip of ground along the ${label.toLowerCase()}? (Undo brings it back.)` ) ) return;
                if ( !shrinkMap( side ) ) useEditor.getState().toast( "That's the only strip of ground left", "error" );
              }}
            ><Icon name="minus" size={12} /></button>
          </div>
        ) ) }
        <svg className="mapsize-map" width={W} height={W} viewBox={`0 0 ${W} ${W}`}>
          { chunks.map( ( c ) => {
            // fine chunks bright, coarse ones dim
            const shade = Math.max( 0.25, Math.min( 1, finest / c.spacing ) );
            return (
              <rect
                key={c.key}
                className={`chunk${picked === c.key ? " picked" : ""}${repeatOf( c.key ).repeats > 1 ? " repeats" : ""}`}
                x={( c.position[0] - minx ) * scale + 1}
                y={( maxz - c.position[2] - c.size[2] ) * scale + 1}
                width={c.size[0] * scale - 2}
                height={c.size[2] * scale - 2}
                fill={`rgba(71, 114, 179, ${shade})`}
                onClick={() => setPicked( picked === c.key ? null : c.key )}
              >
                <title>{`${c.key} · ${c.spacing.toFixed( 2 )} m between samples`}</title>
              </rect>
            );
          } ) }
        </svg>
      </div>
      <div className="note">
        {( width / 1000 ).toFixed( 2 )} × {( depth / 1000 ).toFixed( 2 )} km · {chunks.length} chunk{chunks.length > 1 ? "s" : ""}
      </div>
      {picked && chunks.find( ( c ) => c.key === picked ) && <ChunkRepeat key={picked} c={chunks.find( ( c ) => c.key === picked )!} />}
      { adding && (
        <div className="grow-preview">
          <div className="note">
            Previewing new ground: {SIDES.find( ( x ) => x.side === adding )!.label.toLowerCase()}
            {busy ? " · working…" : ""}. It's made from the ground along that edge; adjust, then Add.
          </div>
          <Slider label="Small bumps" value={params.roughness} min={0} max={3} step={0.05} onChange={set( "roughness" )} fmt={( v ) => `${v.toFixed( 2 )}×`} />
          <Slider label="Ridges and lumps" value={params.hills} min={0} max={3} step={0.05} onChange={set( "hills" )} fmt={( v ) => `${v.toFixed( 2 )}×`} />
          <Slider label="Keep the slope going" value={params.carry} min={0} max={3} step={0.05} onChange={set( "carry" )} fmt={( v ) => `${v.toFixed( 2 )}×`} />
          <Slider label="Copy from within" value={params.reach} min={20} max={1000} step={10} onChange={set( "reach" )} fmt={( v ) => `${v.toFixed( 0 )} m of edge`} log />
          <Slider label="Raise far side" value={params.raise} min={-300} max={300} step={1} onChange={set( "raise" )} fmt={( v ) => `${v.toFixed( 0 )} m`} />
          <Slider label="Blend from edge" value={params.join} min={5} max={300} step={1} onChange={set( "join" )} fmt={( v ) => `${v.toFixed( 0 )} m`} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn" title="A different random layout with the same character" onClick={() => setParams( ( p ) => ( { ...p, seed: p.seed + 1 } ) )}>
              New variation
            </button>
            <button className="btn" onClick={() => setParams( DEFAULT_GROW )}>Reset</button>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={stop}>Cancel</button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => {
                const side = adding;
                setAdding( null );
                // grey the app out with a spinner first ( two frames so it is on screen before the work blocks )
                const st = useEditor.getState();
                st.setBusy( "Adding ground…" );
                requestAnimationFrame( () =>
                  requestAnimationFrame( () => {
                    try {
                      applyGrow( side, res, params );
                    } finally {
                      // the terrain view rebuilds right after; keep the overlay up through that
                      setTimeout( () => requestAnimationFrame( () => st.setBusy( null ) ), 50 );
                    }
                  } ),
                );
              }}
            >
              Add
            </button>
          </div>
        </div>
      ) }
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
    </div>
  );
}
