// How a dab's colour goes onto what's there: the blend modes ( Blender's and Photoshop's ), and colour helpers.

export type BlendMode =
  | "mix" | "multiply"   | "screen" | "overlay" | "lighten" | "darken" | "add" | "subtract" | "difference"
  | "hue" | "saturation" | "color"  | "value"   | "erase";

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: "mix",        label: "Mix"        },
  { value: "darken",     label: "Darken"     },
  { value: "multiply",   label: "Multiply"   },
  { value: "lighten",    label: "Lighten"    },
  { value: "screen",     label: "Screen"     },
  { value: "add",        label: "Add"        },
  { value: "overlay",    label: "Overlay"    },
  { value: "difference", label: "Difference" },
  { value: "subtract",   label: "Subtract"   },
  { value: "hue",        label: "Hue"        },
  { value: "saturation", label: "Saturation" },
  { value: "color",      label: "Color"      },
  { value: "value",      label: "Value"      },
  { value: "erase",      label: "Erase"      },
];

export type RGB = [number, number, number];

export function hsvOf( r: number, g: number, b: number ): RGB {
  const max = Math.max( r, g, b ), min = Math.min( r, g, b ), d = max - min;
  let h     = 0;
  if ( d > 0 ) h = max === r ? ( ( g - b ) / d + 6 ) % 6 : max === g ? ( b - r ) / d + 2 : ( r - g ) / d + 4;
  return [h / 6, max > 0 ? d / max : 0, max];
}

export function rgbOfHsv( h: number, s: number, v: number ): RGB {
  const f = ( n: number ) => {
    const k = ( n + ( ( ( h % 1 ) + 1 ) % 1 ) * 6 ) % 6;
    return v - v * s * Math.max( 0, Math.min( k, 4 - k, 1 ) );
  };
  return [f( 5 ), f( 3 ), f( 1 )];
}

/**
 * Blender's blend modes: the colour `s` laid on `b` ( straight, 0..1 ).
**/
export function blendColour( mode: BlendMode, b: RGB, s: RGB ): RGB {
  switch ( mode ) {
    case "multiply":   return [b[0] * s[0], b[1] * s[1], b[2] * s[2]];
    case "screen":     return b.map( ( v, k ) => 1 - ( 1 - v ) * ( 1 - s[k] ) ) as RGB;
    case "overlay":    return b.map( ( v, k ) => ( v < 0.5 ? 2 * v * s[k] : 1 - 2 * ( 1 - v ) * ( 1 - s[k] ) ) ) as RGB;
    case "lighten":    return b.map( ( v, k ) => Math.max( v, s[k] ) ) as RGB;
    case "darken":     return b.map( ( v, k ) => Math.min( v, s[k] ) ) as RGB;
    case "add":        return b.map( ( v, k ) => Math.min( 1, v + s[k] ) ) as RGB;
    case "subtract":   return b.map( ( v, k ) => Math.max( 0, v - s[k] ) ) as RGB;
    case "difference": return b.map( ( v, k ) => Math.abs( v - s[k] ) ) as RGB;
    case "hue": case "saturation": case "color": case "value": {
      const hb = hsvOf( ...b ), hs = hsvOf( ...s );
      if ( mode === "hue"        ) return rgbOfHsv( hs[0], hb[1], hb[2] );
      if ( mode === "saturation" ) return rgbOfHsv( hb[0], hs[1], hb[2] );
      if ( mode === "color"      ) return rgbOfHsv( hs[0], hs[1], hb[2] );
      return rgbOfHsv( hb[0], hb[1], hs[2] );
    }
    default:           return s;
  }
}
