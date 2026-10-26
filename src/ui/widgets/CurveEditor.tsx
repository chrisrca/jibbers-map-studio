// A small profile-curve editor: drag points, double-click to add one, right-click to remove it. The first and last
// points stay at the ends ( t = 0 and 1 ); only their values move.

import { useRef } from "react";
import { evalCurve, type Curve } from "../../core/curve";

const W = 240, H = 96, PAD = 8;

export function CurveEditor( { value, onChange, onCommit, min = 0, max = 1, label }: {
  value:    Curve;
  onChange: ( c: Curve ) => void;
  onCommit: () => void;
  min?:     number;
  max?:     number;
  // captions for the left/right ends, e.g. ["start", "end"]
  label?:   [string, string];
} ) {
  const svg       = useRef<SVGSVGElement>( null );
  const x         = ( t: number ) => PAD + t * ( W - 2 * PAD );
  const y         = ( v: number ) => PAD + ( 1 - ( v - min ) / ( max - min ) ) * ( H - 2 * PAD );
  const fromEvent = ( e: { clientX: number; clientY: number } ) => {
    const r = svg.current!.getBoundingClientRect();
    const t = Math.min( 1, Math.max( 0, ( ( e.clientX - r.left ) * ( W / r.width ) - PAD ) / ( W - 2 * PAD ) ) );
    const v = min + ( 1 - ( ( e.clientY - r.top ) * ( H / r.height ) - PAD ) / ( H - 2 * PAD ) ) * ( max - min );
    return { t, v: Math.min( max, Math.max( min, v ) ) };
  };
  const path = Array.from( { length: 81 }, ( _, i ) => {
    const t = i / 80;
    return `${i ? "L" : "M"}${x( t ).toFixed( 1 )},${y( evalCurve( value, t ) ).toFixed( 1 )}`;
  } ).join( " " );

  const dragKey = ( index: number ) => ( e: React.PointerEvent ) => {
    if ( e.button !== 0 ) return;
    e.preventDefault();
    e.stopPropagation();
    const move = ( m: PointerEvent ) => {
      const p     = fromEvent( m );
      const keys  = value.map( ( k ) => ( { ...k } ) );
      const last  = keys.length - 1;
      // ends stay at the ends; inner points stay between their neighbours
      const lo    = index === 0 ? 0 : keys[index - 1].t + 0.01;
      const hi    = index === last ? 1 : keys[index + 1].t - 0.01;
      keys[index] = { t: index === 0 ? 0 : index === last ? 1 : Math.min( hi, Math.max( lo, p.t ) ), v: p.v };
      value       = keys;
      onChange( keys );
    };
    const up = () => {
      window.removeEventListener( "pointermove", move );
      window.removeEventListener( "pointerup",   up   );
      onCommit();
    };
    window.addEventListener( "pointermove", move );
    window.addEventListener( "pointerup",   up   );
  };

  return (
    <div className="curve-editor">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        onDoubleClick={( e ) => {
          const p    = fromEvent( e );
          const keys = [...value, p].sort( ( a, b ) => a.t - b.t );
          onChange( keys );
          onCommit();
        }}
      >
        <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} className="frame" />
        {min < 0 && max > 0 && <line x1={PAD} x2={W - PAD} y1={y( 0 )} y2={y( 0 )} className="zero" />}
        <path d={path} className="curve" />
        { value.map( ( k, i ) => (
          <circle
            key={i}
            cx={x( k.t )}
            cy={y( k.v )}
            r={4.5}
            className="key"
            onPointerDown={dragKey( i )}
            onContextMenu={( e ) => {
              e.preventDefault();
              if ( i === 0 || i === value.length - 1 || value.length <= 2 ) return;
              onChange( value.filter( ( _, j ) => j !== i ) );
              onCommit();
            }}
          >
            <title>{`${k.t.toFixed( 2 )} → ${k.v.toFixed( 2 )} · drag · right-click to remove`}</title>
          </circle>
        ) ) }
      </svg>
      { label && (
        <div className="curve-caption">
          <span>{label[0]}</span>
          <span>{label[1]}</span>
        </div>
      ) }
    </div>
  );
}
