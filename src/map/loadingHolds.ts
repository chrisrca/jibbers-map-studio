// Work the loading veil over the 3D view waits for besides the pieces themselves ( see Engine.loading ): e.g. a map's
// pieces from an older build of the game's look being brought up to date when it opens.

const holds = new Set<Promise<unknown>>();

/**
 * The veil stays up until `p` settles.
**/
export function holdLoading<T>( p: Promise<T> ): Promise<T> {
  holds.add( p );
  p.finally( () => holds.delete( p ) ).catch( () => {} );
  return p;
}

export const loadingHeld = () => holds.size > 0;
