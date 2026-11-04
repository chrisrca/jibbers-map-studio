// Work spread over frames: a long job ( a big brush's dab ) checks in as it goes and, once this frame's share is spent,
// waits for the next one, so the 3D view keeps drawing every frame ( at 240 Hz a frame is 4.2 ms, drawing it about 1 ).

// how long work may run each frame, in ms ( from the frame's start )
export const FRAME_BUDGET = 2.5;

let frameStart = 0;
// ( no frames where there's no page: the tests run straight through )
const paged    = typeof requestAnimationFrame === "function";
if ( paged ) {
  const tick = ( t: number ) => {
    frameStart = t;
    requestAnimationFrame( tick );
  };
  requestAnimationFrame( tick );
}

/**
 * Whether this frame's share of work is spent.
**/
export const overBudget = () => paged && performance.now() - frameStart > FRAME_BUDGET;

/**
 * The next frame ( once it has started ).
**/
export const nextFrame = () => new Promise<void>( ( r ) => requestAnimationFrame( () => r() ) );

/**
 * Waits for the next frame if this one's share is spent.
**/
export async function yieldIfOver() {
  if ( overBudget() ) await nextFrame();
}
