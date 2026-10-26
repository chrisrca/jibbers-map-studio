import type { V3 } from "../../core/coords";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/assetgrid ): the Assets floor looked at low and close ( as the camera ends up after
 * zooming in ), and from further off: its axes straight through the origin. Views left in the folder.
**/
export async function assetGridSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Assets" )?.click();
    await sleep( 1200 );
    const views: [string, V3, V3][] = [
      ["low",   [3,   1.2, -4  ], [0,   0, 0  ]],
      ["close", [0.8, 0.5, -1.2], [0,   0, 0  ]],
      ["far",   [40,  18,  -60 ], [0,   0, 0  ]],
      ["away",  [150, 6,   120 ], [140, 0, 140]],
    ];
    for ( const [name, eye, at] of views ) {
      eng.nav.lookAtUnity( eye, at );
      await sleep( 700 );
      await ipc.writeBinary( joinPath( dir, `grid-${name}.png` ), await eng.pictures.capture() );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
