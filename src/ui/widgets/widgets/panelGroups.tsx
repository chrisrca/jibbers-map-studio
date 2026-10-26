// A panel's sections folded or open, kept as they were left.

import { Children, Fragment, type ReactElement, type ReactNode, cloneElement, isValidElement, useState } from "react";
import { Icon } from "../icons";

// Panels folded away, by editor + panel title; kept while the app runs.
const folded = new Set<string>();

/**
 * Children as a flat list ( fragments opened up ), each with a key unique across the list.
**/
function flatten( children: ReactNode, prefix = "" ): ReactNode[] {
  const out: ReactNode[] = [];
  for ( const c of Children.toArray( children ) ) {
    if ( isValidElement( c ) && c.type === Fragment ) {
      out.push( ...flatten( ( c.props as { children?: ReactNode } ).children, `${prefix}${c.key}/` ) );
    } else if ( isValidElement( c ) ) out.push( cloneElement( c, { key: `${prefix}${c.key}` } ) );
    else if ( typeof c === "string" || typeof c === "number" ) out.push( <span key={`${prefix}t${out.length}`}>{c}</span> );
  }
  return out;
}

const isSection = ( c: ReactNode ): c is ReactElement<{ className?: string; children?: ReactNode }> =>
  isValidElement( c ) && c.type === "div" && /\bsection\b/.test( ( c.props as { className?: string } ).className ?? "" );

/**
 * Turns a `.props` grid with `.section` headings into Blender panels: each heading becomes a rounded panel with a
 * folding header, holding the rows under it ( up to the next heading ).
**/
export function PanelGroups( { kind, children }: { kind: string; children: ReactNode } ) {
  const [, bump]         = useState( 0 );
  const out: ReactNode[] = [];
  for ( const top of flatten( children ) ) {
    const props = isValidElement( top ) && top.type === "div" && /\bprops\b/.test( ( top.props as { className?: string } ).className ?? "" );
    if ( !props ) {
      out.push( top );
      continue;
    }
    const p                 = top.props as { className: string; style?: React.CSSProperties; children?: ReactNode };
    let rows: ReactNode[]   = [];
    let head: string | null = null;
    let n                   = 0;
    const flush             = () => {
      if ( head === null ) {
        if ( rows.length ) out.push( <div key={`${top.key}:pre`} className={p.className} style={p.style}>{rows}</div> );
      } else {
        const key      = `${kind}/${head}`;
        const isFolded = folded.has( key );
        out.push(
          <section key={`${top.key}:${n++}:${head}`} className={`bpanel ${isFolded ? "folded" : ""}`}>
            <header
              onClick={() => {
                if ( folded.has( key ) ) folded.delete( key );
                else folded.add( key );
                bump( ( x ) => x + 1 );
              }}
            >
              <Icon name={isFolded ? "chevronRight" : "chevronDown"} size={12} />
              <span className="ttl">{head}</span>
              <Icon name="grip" size={12} className="grip" />
            </header>
            {!isFolded && rows.length > 0 && <div className={p.className} style={p.style}>{rows}</div>}
          </section>,
        );
      }
      rows = [];
    };
    for ( const c of flatten( p.children ) ) {
      if ( isSection( c ) ) {
        flush();
        head = String( Children.toArray( c.props.children ).join( "" ) );
      } else rows.push( c );
    }
    flush();
  }
  return <>{out}</>;
}
