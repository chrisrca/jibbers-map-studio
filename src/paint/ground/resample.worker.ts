// A mask read or resampled off the page's thread ( a 4096² one held the page up a second and a half on entering
// Paint Mode ).

import { resample, type ResampleJob } from "./resample";

self.addEventListener( "message", async ( e: MessageEvent<ResampleJob> ) => {
  const out  = await resample( e.data );
  const bufs = out instanceof Uint8Array ? [out.buffer] : out ? [out.data.buffer] : [];
  ( self as unknown as { postMessage( m: unknown, t: Transferable[] ): void } ).postMessage( out, bufs as Transferable[] );
} );
