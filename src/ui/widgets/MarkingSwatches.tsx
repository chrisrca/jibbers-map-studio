// The markings brush's colours: the game's own marking hues ( the shader snaps hue to twentieths ), one swatch each.

import { MARKING_COLOURS } from "../../paint/settings";
import { useEditor } from "../../map/store";

/**
 * A hue as a swatch colour.
**/
export const hueCss = ( h: number ) => `hsl(${Math.round( h * 360 )}, 85%, 52%)`;

export function MarkingSwatches( { small }: { small?: boolean } ) {
  const colour = useEditor( ( s ) => s.paint.colour );
  return (
    <div className={`swatches${small ? " small" : ""}`}>
      { MARKING_COLOURS.map( ( c, i ) => (
        <button
          key={c.name}
          className={colour === i ? "on" : ""}
          title={c.name}
          style={{ background: hueCss( c.hue ) }}
          onClick={() => useEditor.getState().setPaint( { colour: i } )}
        />
      ) ) }
    </div>
  );
}
