// Where a map saved as goes: a .jbrproj folder, never inside another one.

/**
 * `picked` ( from the save dialog ) as a .jbrproj folder beside any project it was picked inside of.
**/
export function projectPath( picked: string ): string {
  const to     = /\.jbrproj$/i.test( picked ) ? picked : `${picked}.jbrproj`;
  const parts  = to.split( /[\\/]/ );
  const inside = parts.slice( 0, -1 ).findIndex( ( p ) => /\.jbrproj$/i.test( p ) );
  return inside >= 0 ? [...parts.slice( 0, inside ), parts[parts.length - 1]].join( "\\" ) : to;
}
