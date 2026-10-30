// The self-tests, run when the app starts with STUDIO_SELFTEST=<dir>: the folder's name picks which one ( none of
// these: the default end-to-end run ). Each test is in its own file, by area; the shared helpers are in harness.ts.

import { allFeaturesSelftest } from "./look/allFeatures";
import { assetCopySelftest } from "./assets/assetCopy";
import { assetGridSelftest } from "./assets/assetGrid";
import { assetNavSelftest } from "./assets/assetNav";
import { assetsFullSelftest } from "./assets/assetsFull";
import { assetsSelftest } from "./assets/assets";
import { bigMapSelftest } from "./realmap/bigMap";
import { blLookSelftest } from "./assets/blLook";
import { brushDragSelftest } from "./terrain/brushDrag";
import { brushSelftest } from "./terrain/brush";
import { brushStressSelftest } from "./terrain/brushStress";
import { convertSelftest } from "./model/convert";
import { curveSelftest } from "./model/curve";
import { demsSelftest } from "./realmap/dems";
import { designToolsSelftest } from "./app/designTools";
import { designLookSelftest } from "./look/designLook";
import { dragAimSelftest } from "./assets/dragAim";
import { droneLookSelftest, droneRawSelftest } from "./game/droneLook";
import { dragCardsSelftest } from "./assets/dragCards";
import { editViewSelftest } from "./model/editView";
import { exportInnerSelftest } from "./realmap/exportInner";
import { fileDropSelftest } from "./assets/fileDrop";
import { flipGameSelftest } from "./pieces/flipGame";
import { freshLiftSelftest } from "./pieces/freshLift";
import { freshSelftest } from "./app/fresh";
import { gameChatSelftest } from "./game/chat";
import { gameLagSelftest } from "./game/gameLag";
import { gameLookSelftest } from "./look/gameLook";
import { gameRefSelftest } from "./look/gameRef";
import { gradientSelftest } from "./texture/gradient";
import { grindSelftest } from "./pieces/grind";
import { gripSelftest } from "./paint/grip";
import { hiddenFpsSelftest } from "./game/hiddenFps";
import { iconSheet } from "./app/icons";
import { idleFpsSelftest } from "./perf/idleFps";
import { innerSelftest } from "./realmap/inner";
import { inputLagSelftest } from "./game/inputLag";
import { invoke } from "@tauri-apps/api/core";
import { librarySelftest } from "./assets/library";
import { liftPanelSelftest } from "./pieces/liftPanel";
import { liftsSelftest } from "./pieces/lifts";
import { mapPiecesSelftest } from "./pieces/mapPieces";
import { loadVeilSelftest } from "./perf/loadVeil";
import { mapNavSelftest } from "./perf/mapNav";
import { lookSelftest } from "./look/look";
import { mapTreesSelftest } from "./realmap/mapTrees";
import { materialSelftest } from "./assets/material";
import { modelSelftest } from "./model/model";
import { mountainLagSelftest } from "./realmap/mountainLag";
import { mountainSelftest } from "./realmap/mountain";
import { mountainStressSelftest } from "./realmap/mountainStress";
import { newMapSelftest } from "./terrain/newMap";
import { nightSelftest } from "./look/night";
import { objectLookSelftest } from "./look/objectLook";
import { outlinerSelftest } from "./assets/outliner";
import { paintAssetSelftest } from "./texture/paintAsset";
import { paintDragSelftest } from "./paint/paintDrag";
import { paintLagSelftest } from "./texture/paintLag";
import { paintSelftest } from "./paint/paint";
import { panLag2Selftest } from "./game/panLag2";
import { panLagSelftest } from "./game/panLag";
import { panelsSelftest } from "./app/panels";
import { partsSelftest } from "./pieces/parts";
import { placeSelftest } from "./assets/place";
import { popOutSelftest } from "./game/popOut";
import { railGameSelftest } from "./pieces/railGame";
import { railSelftest } from "./pieces/rail";
import { railSolidSelftest } from "./pieces/railSolid";
import { rampDragSelftest } from "./terrain/rampDrag";
import { realTrailsSelftest } from "./trails/realTrails";
import { recoverSelftest } from "./pieces/recover";
import { recycleSelftest } from "./app/recycle";
import { refreshLookSelftest } from "./look/refreshLook";
import { repeatsSelftest } from "./terrain/repeats";
import { replaySelftest } from "./game/replay";
import { resortSelftest } from "./terrain/resort";
import { rocksSelftest } from "./realmap/rocks";
import { savingSelftest } from "./app/saving";
import { scatterSelftest } from "./assets/scatter";
import { sessionSelftest } from "./trails/session";
import { skySelftest } from "./look/sky";
import { smokeSelftest } from "./app/smoke";
import { snowLookSelftest } from "./paint/snowLook";
import { spawnSelftest } from "./terrain/spawn";
import { stageSelftest } from "./model/stage";
import { startupSelftest } from "./app/startup";
import { terrainLinesSelftest } from "./terrain/terrainLines";
import { terrainViewSelftest } from "./terrain/terrainView";
import { texCheckSelftest } from "./look/texCheck";
import { texPaintSelftest } from "./texture/texPaint";
import { toolsSelftest } from "./model/tools";
import { trailStressSelftest } from "./trails/trailStress";
import { trailTowerSelftest } from "./trails/trailTower";
import { trailsSelftest } from "./trails/trails";
import { treeViewSelftest } from "./look/treeView";
import { treesSelftest } from "./look/trees";
import { uiFixesSelftest } from "./app/uiFixes";
import { uiSelftest } from "./app/ui";
import { updatesSelftest } from "./app/updates";
import { userMapSelftest } from "./look/userMap";
import { vramSelftest } from "./perf/vram";
import { wheelsSelftest } from "./pieces/wheels";

// Each self-test by the name of the folder it runs in ( the last part of STUDIO_SELFTEST ).
const ROUTES: Record<string, ( dir: string ) => Promise<unknown>> = {
  // app
  fresh:        freshSelftest,
  designtools:  designToolsSelftest,
  icons:        iconSheet,
  panels:       panelsSelftest,
  recycle:      recycleSelftest,
  saving:       savingSelftest,
  startup:      startupSelftest,
  ui:           uiSelftest,
  uifixes:      uiFixesSelftest,
  updates:      updatesSelftest,
  // terrain
  brush:        brushSelftest,
  brushdrag:    brushDragSelftest,
  brushstress:  brushStressSelftest,
  newmap:       newMapSelftest,
  rampdrag:     rampDragSelftest,
  repeats:      repeatsSelftest,
  resort:       resortSelftest,
  spawn:        spawnSelftest,
  terrainlines: terrainLinesSelftest,
  terrainview:  terrainViewSelftest,
  // realmap
  bigmap:       bigMapSelftest,
  dems:         demsSelftest,
  exportinner:  exportInnerSelftest,
  inner:        innerSelftest,
  maptrees:     mapTreesSelftest,
  mountain:     mountainSelftest,
  mtnstress:    mountainStressSelftest,
  mtnlag:       mountainLagSelftest,
  rocks:        rocksSelftest,
  // trails
  realtrails:   realTrailsSelftest,
  session:      sessionSelftest,
  trails:       trailsSelftest,
  trailstress:  trailStressSelftest,
  trailtower:   trailTowerSelftest,
  // paint
  grip:         gripSelftest,
  paint:        paintSelftest,
  paintdrag:    paintDragSelftest,
  snowshots:    snowLookSelftest,
  // texture
  gradient:     gradientSelftest,
  paintasset:   paintAssetSelftest,
  paintlag:     paintLagSelftest,
  texpaint:     texPaintSelftest,
  // model
  convert:      convertSelftest,
  curve:        curveSelftest,
  editview:     editViewSelftest,
  model:        modelSelftest,
  stage:        stageSelftest,
  tools:        toolsSelftest,
  // assets
  assetcopy:    assetCopySelftest,
  assetgrid:    assetGridSelftest,
  assetnav:     assetNavSelftest,
  assets:       assetsSelftest,
  assetsfull:   assetsFullSelftest,
  bllook:       blLookSelftest,
  dragaim:      dragAimSelftest,
  dragcards:    dragCardsSelftest,
  filedrop:     fileDropSelftest,
  library:      librarySelftest,
  material:     materialSelftest,
  outliner:     outlinerSelftest,
  place:        placeSelftest,
  scatter:      scatterSelftest,
  // look
  allfeatures:  allFeaturesSelftest,
  designlook:   designLookSelftest,
  gamelook:     gameLookSelftest,
  gameref:      gameRefSelftest,
  look:         lookSelftest,
  night:        nightSelftest,
  objlook:      objectLookSelftest,
  refreshlook:  refreshLookSelftest,
  sky:          skySelftest,
  texcheck:     texCheckSelftest,
  trees:        treesSelftest,
  treeview:     treeViewSelftest,
  usermap:      userMapSelftest,
  // pieces
  flipgame:     flipGameSelftest,
  freshlift:    freshLiftSelftest,
  grind:        grindSelftest,
  liftpanel:    liftPanelSelftest,
  lifts:        liftsSelftest,
  mappieces:    mapPiecesSelftest,
  parts:        partsSelftest,
  rail:         railSelftest,
  railgame:     railGameSelftest,
  railsolid:    railSolidSelftest,
  recover:      recoverSelftest,
  wheels:       wheelsSelftest,
  // game
  dronelook:    droneLookSelftest,
  dronepopped:  ( dir: string ) => droneLookSelftest( dir, true ),
  droneraw:     droneRawSelftest,
  gamechat:     gameChatSelftest,
  gamelag:      gameLagSelftest,
  hiddenfps:    hiddenFpsSelftest,
  inputlag:     inputLagSelftest,
  panlag:       panLagSelftest,
  panlag2:      panLag2Selftest,
  popout:       popOutSelftest,
  replay:       replaySelftest,
  // perf
  idlefps:      idleFpsSelftest,
  loadveil:     loadVeilSelftest,
  mapnav:       mapNavSelftest,
  vram:         vramSelftest,
};

let started = false;

export async function maybeRunSelftest() {
  if ( started ) return;
  started   = true;
  const dir = await invoke<string | null>( "selftest_dir" );
  if ( !dir ) return;
  ( await import( "../map/store" ) ).testRun.active = true;
  // ( the folder's own name picks the test; none of these, the default end-to-end run )
  const route = dir.replace( /[\\/]+$/, "" ).split( /[\\/]/ ).pop()!.toLowerCase();
  return ( ROUTES[route] ?? smokeSelftest )( dir );
}
