// Painted modelled pieces ( the Material workspace's Texture Paint ): one texture a piece, laid over its faces by
// its paint layout ( model/uv.ts ), painted with the paint engine through the screen ( viewport/edit/meshPainter.ts ). Kept in
// the project as paint/models/<uid>.png; in the game it's the piece's base texture.
//
// A piece keeps its layout while its faces stay the same ones ( moving corners stretches the paint with them, as in
// Blender ). When the faces change ( an extrude, a cut, a modifier ), a layout is made for the new ones and the paint
// carried across by position: each texel of the new layout takes the colour of the nearest one of the old.

export { topoSig, paintAtlas, atlasFor, type TexelMap, texelMap, texelsNear } from "./atlas";
export { type Channel, channelKey, type PieceTexture, pieceTexture, putPieceTexture, onPieceTexture, pendingOf, channelPixels, storeOf, updateNormal } from "./textures";
export { prepare, matchTexels, carry, setBakedLook, resample, resizeTexture } from "./carry";
export { editTexture, recordStroke, editChannels } from "./edits";
export { loadPieceTextures, resetPieceTextures, savePieceTextures, textureForGame } from "./files";

export const PAINT_SIZE = 1024;

/**
 * The painted texture's key in the map's library.
**/
export const paintKey = ( uid: string ) => `Models/${uid}/paint`;
