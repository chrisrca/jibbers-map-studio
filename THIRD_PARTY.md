# Third-party code

## PhotoCraft

The paint engine (`src/paint/engine/`) follows PhotoCraft's paint crate: the round tip's measured core and shoulder
(`tipShape` / `tipFalloff`), the generated tips (chalk, charcoal, spatter, bristle, sponge) and patterns (noise,
paper, canvas, dots), the texture modes, the stroke build-up model, and Smudge.

- Source: https://github.com/storytold/photocraft (`crates/paint`)
- Licence: Apache-2.0 or MIT, at your option. Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors.

Ported to TypeScript and adapted; the MIT licence text:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
> documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of
> the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
> WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
> COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
> OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## csg.js

The booleans (`src/model/csg.ts`) follow Evan Wallace's csg.js: convex polygons kept in BSP trees, split by each
other's planes, the parts inside or outside the other solid dropped.

- Source: https://github.com/evanw/csg.js
- Licence: MIT. Copyright (c) 2011 Evan Wallace (http://madebyevan.com/).

Ported to TypeScript (iterative where it recursed); the MIT licence text is as above.

## Blender

The Assets workspace uses Blender's own icons: interface icons from `release/datafiles/icons_svg` and toolbar icons
from `release/datafiles/icons/*.dat`, gathered by `tools/build_blender_icons.py` into
`src/ui/blender/icons.generated.ts` (white drawn in the theme's text colour; the toolbar's triangles as SVG).

- Source: https://projects.blender.org/blender/blender
- Licence: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0), by the Blender Foundation and
  Blender's icon designers. https://creativecommons.org/licenses/by-sa/4.0/ — the icons as adapted here are shared
  under the same licence.

## Unity class layouts (UnityPy)

`src-tauri/src/gamelook/unity_typetrees.json` holds the layouts of the few Unity classes the app reads from the game's own
files (the game ships without them). They're taken from UnityPy's type tree tables by
`tools/dump_unity_typetrees.py`, and the reader (`src-tauri/src/gamelook/unityfile.rs`) follows UnityPy's.

- Source: https://github.com/K0lb3/UnityPy
- Licence: MIT, Copyright (c) 2019-2026 K0lb3

## Jibbers Map Tools

The official features' stand-in pieces (`library/placeholders/*.glb`, `placeholders.json`, and the app pieces in
`library/Library/Features`) are the placeholder prefabs of Jibbers' Map Tools package: their meshes, parameters,
colliders and bounds, read by `tools/extract_placeholders.py`. The game's own look of each feature (its meshes,
textures, materials, lights and wheels), its sky (its sky shader, translated to WGSL on the player's machine, its sky
states and settings), its snow (the terrain's snow and rock textures and their material) and its mark are never
shipped: the studio reads them from the player's own copy of the game (`src-tauri/src/gamelook/mod.rs`, `gamelook/sky.rs`,
`gamelook/terrain.rs`, `gamelook/icon.rs`) into their data folder.

- Source: the `fun.jibbers.map-tools` Unity package, https://github.com/jibbers-ski/Map-Tools
- Licence: MIT. Copyright (c) 2026 jibbers-ski. The licence text ships beside them as
  `library/placeholders/MAP-TOOLS-LICENSE.txt` (and is as above).
