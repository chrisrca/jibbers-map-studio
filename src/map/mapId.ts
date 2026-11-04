// Map ids as the game takes them ( MapData.IsValidId, src-tauri jbrmap/model.rs ): letters, digits, '-' and '_', at
// most 36. The id is the map's file name in the game's Maps folder ( "ruka-park.jbrmap" ).

export const MAP_ID_MAX = 36;

export const isValidMapId = ( id: string ) => id.length > 0 && id.length <= MAP_ID_MAX && /^[A-Za-z0-9_-]+$/.test( id );

/**
 * An id from what was typed ( or the map's name ), as Map-Tools makes one: "Ruka Park" → "ruka-park"; "" when nothing
 * of it can be kept.
**/
export function mapIdFrom( text: string ): string {
  let id = "";
  for ( const c of text.replace( /<[^>]*>/g, "" ).toLowerCase() ) {
    if ( /[a-z0-9_]/.test( c ) ) id += c;
    else if ( id && !id.endsWith( "-" ) ) id += "-";
  }
  return id.slice( 0, MAP_ID_MAX ).replace( /-+$/, "" );
}
