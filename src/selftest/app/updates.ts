import { log } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/updates ): the updater asked for a new version ( its config, key and permissions
 * in order ): what it says.
**/
export async function updatesSelftest() {
  try {
    const { check      } = await import( "@tauri-apps/plugin-updater" );
    const { getVersion } = await import( "@tauri-apps/api/app"        );
    log( `this version ${await getVersion()}` );
    try {
      const u = await check();
      log( u ? `a new version: ${u.version} (from ${u.currentVersion})` : "no new version" );
    } catch ( e ) {
      log( `the updater says: ${e}` );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
