// Names written with the game's rich text ( Unity's: "Joyosa Park <color=orange>Plus</color>" ), shown as the game
// shows them: colour, bold, italic, underline and strikethrough. Other tags are left out, words kept.

import type { CSSProperties, ReactNode } from "react";

/**
 * The words alone ( for window titles, prompts and other plain text ).
**/
export const plainText = ( s: string ) => s.replace( /<[^>]*>/g, "" ).trim();

const TAGS = /<(\/?)([a-z]+)(?:=("[^"]*"|[^>]*))?>/gi;

// A tag open while the words go on, and what it does to them.
type Open = { tag: string; style: CSSProperties };

/**
 * A colour as the game takes it ( #rgb, #rrggbb, #rrggbbaa or a name ), if it's one CSS knows too.
**/
function colour( v: string ): string | undefined {
  const c = v.replace( /^"|"$/g, "" ).trim();
  if ( typeof CSS !== "undefined" ) return CSS.supports( "color", c ) ? c : undefined;
  return /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test( c ) ? c : undefined;
}

/**
 * Rich text as styled spans.
**/
export function RichText( { text }: { text: string } ) {
  const out: ReactNode[] = [];
  // open tags, innermost last
  const stack: Open[]    = [];
  let at                 = 0;
  const words            = ( s: string ) => {
    if ( !s ) return;
    const style = Object.assign( {}, ...stack.map( ( t ) => t.style ) ) as CSSProperties;
    out.push( stack.length ? <span key={out.length} style={style}>{s}</span> : s );
  };
  for ( const m of text.matchAll( TAGS ) ) {
    words( text.slice( at, m.index ) );
    at                           = m.index! + m[0].length;
    const [, close, name, value] = m;
    const tag                    = name.toLowerCase();
    if ( close ) {
      const k = stack.map( ( t ) => t.tag ).lastIndexOf( tag );
      if ( k >= 0 ) stack.splice( k, 1 );
      continue;
    }
    const style: CSSProperties | null =
      tag === "color" ? ( value && colour( value ) ? { color: colour( value ) } : null )
      : tag === "b" ? { fontWeight:     700            }
      : tag === "i" ? { fontStyle:      "italic"       }
      : tag === "u" ? { textDecoration: "underline"    }
      : tag === "s" ? { textDecoration: "line-through" }
      : null;
    if ( style ) stack.push( { tag, style } );
  }
  words( text.slice( at ) );
  return <>{out}</>;
}
