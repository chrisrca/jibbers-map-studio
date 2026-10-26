// The studio's icons: line drawings on a 16×16 grid in the style of Blender's icon set ( 1.2 px strokes, round ends,
// currentColor so they follow the theme ). Every icon in the app comes from here — no emoji or font symbols.

import type { ReactNode } from "react";

const ICONS = {
  // ---- general
  trash: <path d="M2.6 4.2h10.8M6.3 4.2V2.9h3.4v1.3M3.9 4.2l.6 8.5c0 .5.4.9.9.9h5.2c.5 0 .9-.4.9-.9l.6-8.5M6.6 6.8v4.4M9.4 6.8v4.4" />,
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3 8h10" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  refresh: <path d="M13 8a5 5 0 1 1-1.6-3.7M13.2 2.4v2.9h-2.9" />,
  undo: <path d="M5.5 3.5 2.5 6.5l3 3M2.8 6.5h6.7a3.6 3.6 0 0 1 0 7.2H6.8" />,
  redo: <path d="M10.5 3.5l3 3-3 3M13.2 6.5H6.5a3.6 3.6 0 0 0 0 7.2h2.7" />,
  check: <path d="M3 8.6l3.1 3.1L13 4.8" />,
  chevronDown: <path d="M4.5 6.2 8 9.7l3.5-3.5" />,
  chevronRight: <path d="M6.2 4.5 9.7 8l-3.5 3.5" />,
  play: <path d="M5 3.3v9.4L12.6 8z" fill="currentColor" />,
  folder: <path d="M1.8 4.3c0-.6.4-1 1-1h3.2l1.4 1.5h5.8c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z" />,
  folderOpen: (
    <>
      <path d="M1.8 12.2V4.3c0-.6.4-1 1-1h3.2l1.4 1.5h4.9c.6 0 1 .4 1 1v1.4" />
      <path d="M1.8 12.4 3.9 7.8c.2-.4.5-.6.9-.6h9.5l-2.1 5c-.2.4-.5.6-.9.6H2.6" />
    </>
  ),
  import: <path d="M8 2v7.6M5 6.8 8 9.8l3-3M2.5 10.2v2.2c0 .6.4 1 1 1h9c.6 0 1-.4 1-1v-2.2" />,
  export: <path d="M8 10V2.4M5 5.2 8 2.2l3 3M2.5 10.2v2.2c0 .6.4 1 1 1h9c.6 0 1-.4 1-1v-2.2" />,
  search: (
    <>
      <circle cx="6.9" cy="6.9" r="4.3" />
      <path d="M10.1 10.1 13.6 13.6" />
    </>
  ),
  libraryAdd: (
    <>
      <path d="M3 2.5h7.5l2.5 2.5v8.5H3z" />
      <path d="M8 6.5v5M5.5 9h5" />
    </>
  ),
  dot: <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />,
  clone: <path d="M6.3 2.4h3.4v3.3l2.7 1.5v2.2H3.6V7.2l2.7-1.5zM3 11.5h10M4.6 13.6h6.8" />,
  selVert: (
    <>
      <path d="M2.5 13.5 13.5 2.5M2.5 2.5h11v11h-11z" strokeOpacity=".45" />
      <circle cx="13.5" cy="2.5" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  selEdge: (
    <>
      <path d="M2.5 2.5h11v11h-11z" strokeOpacity=".45" />
      <path d="M2.5 2.5h11" strokeWidth="2.4" />
    </>
  ),
  selFace: (
    <>
      <path d="M2.5 2.5h11v11h-11z" fill="currentColor" fillOpacity=".55" />
    </>
  ),
  extrude: <path d="M3 10.5h10v3H3zM5 10.5V6.5h6v4M8 6.3V1.8M6.2 3.6 8 1.8l1.8 1.8" />,
  inset: <path d="M2.5 2.5h11v11h-11zM5.5 5.5h5v5h-5zM2.5 2.5l3 3M13.5 2.5l-3 3M2.5 13.5l3-3M13.5 13.5l-3-3" />,
  bevel: <path d="M2.5 13.5V7l4.5-4.5h6.5v11zM7 2.5V7H2.5" />,
  loopcut: (
    <>
      <path d="M2.5 2.5h11v11h-11z" />
      <path d="M8 1.5v13" stroke="#ffd23f" />
    </>
  ),
  swap: <path d="M4 5.5h8.5M10.5 3.3l2.2 2.2-2.2 2.2M12 10.5H3.5M5.5 8.3l-2.2 2.2 2.2 2.2" />,
  lock: <path d="M3.8 7.2h8.4v6.3H3.8zM5.4 7.2V5.1a2.6 2.6 0 0 1 5.2 0v2.1M8 9.6v1.6" />,
  unlock: <path d="M3.8 7.2h8.4v6.3H3.8zM5.4 7.2V5.1a2.6 2.6 0 0 1 5.1-.7M8 9.6v1.6" />,
  popOut: <path d="M9.2 2.5h4.3v4.3M13.5 2.5 7.6 8.4M12 9.6v2.9c0 .6-.4 1-1 1H3.5c-.6 0-1-.4-1-1V5c0-.6.4-1 1-1h2.9" />,
  gear: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.9M8 12.3v1.9M1.8 8h1.9M12.3 8h1.9M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" />
    </>
  ),
  logo: (
    <>
      <path d="M1.5 13.2 6.2 5.6l2.4 3.8 1.6-2.3 4.3 6.1z" />
      <path d="M4.9 7.7 6.2 8.6l1.2-.9" />
      <path d="M3 13.2c2.4-.4 4.6-1.6 6.6-3.6" />
    </>
  ),
  mountain: (
    <>
      <path d="M1.5 13.2 6.2 5.6l2.4 3.8 1.6-2.3 4.3 6.1z" />
      <path d="M4.9 7.7 6.2 8.6l1.2-.9" />
    </>
  ),
  cube: <path d="M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8zM2.5 4.8 8 7.8l5.5-3M8 7.8v6.4" />,
  brush: (
    <>
      <path d="M13.8 2.2 7.9 8.3" />
      <path d="M9.3 9.6 6.6 6.9" />
      <path d="M6.4 7.2C4.6 7 3.3 8.2 3.2 9.9c-.1 1.4-.6 2.5-1.6 3.4 2.9.3 5.2-.4 6.4-1.9.7-.9.6-1.8.9-2.4" />
    </>
  ),
  knife: (
    <>
      <path d="M2.5 13.5 9.2 6.8l2.6 2.6-6.7 4.1z" fill="currentColor" fillOpacity=".3" />
      <path d="M2.5 13.5 9.2 6.8l2.6 2.6-6.7 4.1zM9.2 6.8l3.4-3.4a1.4 1.4 0 0 1 2 2l-2.8 4" />
    </>
  ),
  spin: (
    <>
      <path d="M8 2.5v11" strokeDasharray="1.5 1.5" />
      <path d="M12.6 6.2A5 2.2 0 1 1 3.4 6.2M3.4 6.2l.2 2M3.4 6.2l1.9-.6" />
      <path d="M11 4.2v6.2" />
    </>
  ),
  primPlane: <path d="M1.8 10 6.6 6.2h7.6L9.4 10z" />,
  primCircle: <ellipse cx="8" cy="8.6" rx="6" ry="2.8" />,
  primCylinder: (
    <>
      <ellipse cx="8" cy="4.2" rx="5" ry="1.8" />
      <path d="M3 4.2v7.6c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4.2" />
    </>
  ),
  primCone: (
    <>
      <path d="M8 2 3 11.8M8 2l5 9.8" />
      <ellipse cx="8" cy="11.8" rx="5" ry="1.8" />
    </>
  ),
  primSphere: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <ellipse cx="8" cy="8" rx="5.6" ry="2" />
      <path d="M8 2.4v11.2" strokeOpacity=".5" />
    </>
  ),
  primIcosphere: (
    <>
      <path d="M8 2.2 13 5.1v5.8L8 13.8 3 10.9V5.1z" />
      <path d="M8 2.2 5.4 9.6h5.2zM3 5.1l2.4 4.5L3 10.9M13 5.1l-2.4 4.5 2.4 1.3M5.4 9.6 8 13.8l2.6-4.2" strokeOpacity=".6" />
    </>
  ),
  primTorus: (
    <>
      <ellipse cx="8" cy="8.4" rx="6.2" ry="3.4" />
      <ellipse cx="8" cy="7.9" rx="2.6" ry="1.1" />
    </>
  ),
  primGrid: <path d="M1.8 10.5 6.2 5.5h8l-4.4 5zM4 8h8.1M5.8 10.5 10.2 5.5M9.8 10.5l4.4-5" />,
  rail: (
    <>
      <path d="M1.5 6.5h13" strokeWidth="2" />
      <path d="M4 7v6M12 7v6" />
    </>
  ),
  areaSelect: (
    <>
      <path d="M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11" />
      <path d="M7 2.5h2M7 13.5h2M2.5 7v2M13.5 7v2" />
    </>
  ),

  home: <path d="M2.2 7.6 8 2.6l5.8 5M3.8 6.4v7h3.3V9.6h1.8v3.8h3.3v-7" />,

  // ---- object tools
  cursor: <path d="M3.6 2.2v10.4l2.8-2.6 1.9 4.2 1.8-.8-1.9-4.1 3.9-.3z" />,
  move: <path d="M8 1.8v12.4M1.8 8h12.4M6.2 3.6 8 1.8l1.8 1.8M6.2 12.4 8 14.2l1.8-1.8M3.6 6.2 1.8 8l1.8 1.8M12.4 6.2 14.2 8l-1.8 1.8" />,
  rotate: <path d="M13.2 8.3a5.2 5.2 0 1 1-1.6-3.9M13.2 2.6v3h-3" />,
  scale: (
    <>
      <rect x="2" y="7.2" width="6.8" height="6.8" rx=".8" />
      <path d="M8.8 2h5.2v5.2M14 2 9.2 6.8" />
    </>
  ),
  place: (
    <>
      <path d="M8 1.4v4.9M6 4.4 8 6.4l2-2" />
      <path d="M2.8 9.2 8 7.4l5.2 1.8v3.6L8 14.6l-5.2-1.8zM2.8 9.2 8 11l5.2-1.8M8 11v3.6" />
    </>
  ),
  spawn: <path d="M3.8 14.2V2.2M3.8 2.6h8.4l-2 2.9 2 2.9H3.8" />,

  // ---- sculpt brushes
  draw: <path d="M1.5 13.5h13M2.4 13.5c1.8 0 2.7-3.6 5.6-3.6s3.8 3.6 5.6 3.6M8 7.6V2M5.8 4.2 8 2l2.2 2.2" />,
  layer: <path d="M1.5 13.5h13M3 13.5l1.4-3h7.2l1.4 3M4.4 10.5V7.4h7.2v3.1M6 4.4h4" />,
  clay: (
    <>
      <path d="M1.5 13.5h13" />
      <path d="M2.4 13.5C2.8 9.4 5.1 6.4 8 6.4s5.2 3 5.6 7.1" />
      <path d="M4.4 11.4c2.2-1 5-1 7.2 0M6 8.9c1.3-.5 2.7-.5 4 0" />
    </>
  ),
  smooth: <path d="M1.5 5.8c1.2-1.7 2.4-1.7 3.6 0s2.4 1.7 3.6 0 2.4-1.7 3.6 0 1.2 0 1.2 0M1.5 12.2h13M8 7.6v2.8M6.6 9.2 8 10.6l1.4-1.4" />,
  flatten: <path d="M1.5 13h13M2.5 9.4h11M5 2.4l1.6 1.6M8 2v2.6M11 2.4 9.4 4M6.4 6.2 8 7.6l1.6-1.4" />,
  terrace: <path d="M1.5 13.5h3v-2.7h3V8.1h3V5.4h3V2.7h1" />,
  noise: <path d="M1.5 13.8h13M1.5 11.6l1.8-3.4 1.6 2.1 2.3-5.2 1.9 4.1 1.4-1.8 1.5 2.4 2.5-4.6" />,
  crease: <path d="M1.5 5.2 6 6.3 8 13l2-6.7 4.5-1.1M6.8 2.4 8 3.6l1.2-1.2" />,
  pinch: (
    <>
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <path d="M2 2l3.3 3.3M14 2l-3.3 3.3M2 14l3.3-3.3M14 14l-3.3-3.3M2.8 5.4h2.6V2.8M13.2 5.4h-2.6V2.8M2.8 10.6h2.6v2.6M13.2 10.6h-2.6v2.6" />
    </>
  ),
  smudge: <path d="M1.5 6.2c2.2-1.8 4 1.3 6.2 0M1.5 9.4c2.2-1.8 4 1.3 6.2 0M1.5 12.6c2.2-1.8 4 1.3 6.2 0M10 9.4h4.5M12.4 7.3l2.1 2.1-2.1 2.1" />,
  mask: (
    <>
      <circle cx="8" cy="8" r="5.6" strokeDasharray="2.1 1.6" />
      <path d="M8 4.4a3.6 3.6 0 0 1 0 7.2z" fill="currentColor" stroke="none" />
    </>
  ),

  // ---- ground paint
  paintSnow: <path d="M8 1.8v12.4M2.6 4.9l10.8 6.2M2.6 11.1l10.8-6.2M6.4 2.5 8 4.1l1.6-1.6M6.4 13.5 8 11.9l1.6 1.6M2.3 7.3l2.2.5-.6 2.2M13.7 8.7l-2.2-.5.6-2.2" />,
  texture: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 6h12M2 10h12M6 2v12M10 2v12" strokeOpacity=".55" />
      <path d="M2 2h4v4H2zM6 6h4v4H6zM10 10h4v4h-4zM10 2h4v4h-4zM2 10h4v4H2z" fill="currentColor" fillOpacity=".3" stroke="none" />
    </>
  ),
  image: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <circle cx="5.6" cy="6" r="1.3" />
      <path d="m2.5 12.5 4-4 2.5 2.5 2-2 2.5 2.5" />
    </>
  ),
  fill: (
    <>
      <path d="M3 7.5 7.5 3l5 5-4.5 4.5z" fill="currentColor" fillOpacity=".35" />
      <path d="M3 7.5 7.5 3l5 5-4.5 4.5zM5.5 1.5l2 1.5M3 7.5h9.5" />
      <path d="M13.5 10.5s1 1.5 1 2.2a1 1 0 0 1-2 0c0-.7 1-2.2 1-2.2z" fill="currentColor" />
    </>
  ),
  gradient: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M2 14 14 2" />
      <path d="M2 10.5 10.5 2M2 7 7 2M2 3.5 3.5 2" strokeOpacity=".5" />
    </>
  ),
  paintMarking: (
    <>
      <path d="M2.2 11.4 11.4 2.2l2.4 2.4-9.2 9.2z" fill="currentColor" fillOpacity=".35" />
      <path d="M2.2 11.4 11.4 2.2l2.4 2.4-9.2 9.2zM1.5 14.5h3" />
    </>
  ),
  paintPowder: (
    <>
      <path d="M1.5 13h13M2.5 13c.8-2.9 2.8-4.4 5.5-4.4s4.7 1.5 5.5 4.4" />
      <path d="M4.6 5.4h.01M8 3.4h.01M11.4 5.4h.01M6.2 1.8h.01M9.8 1.8h.01" strokeWidth="2" />
    </>
  ),
  paintGrip: (
    <>
      <path d="M1.5 13h13" />
      <path d="M2.5 13c.8-2.9 2.8-4.4 5.5-4.4s4.7 1.5 5.5 4.4" strokeDasharray="1.4 1.6" />
      <path d="M5 5.5 8 2.5l3 3M8 2.5v4" />
    </>
  ),
  paintFlow: <path d="M3.5 14.2V6M6.5 14.2V6M9.5 14.2V6M12.5 14.2V6M2.4 4.4 8 1.6l5.6 2.8" />,

  // ---- terrain shapes
  trail: (
    <>
      <path d="M3.4 13c.6-3.4 2.6-4.6 4.6-5.2s3.6-1.7 4.4-4.6" />
      <circle cx="3.4" cy="13" r="1.3" fill="currentColor" />
      <circle cx="8" cy="7.8" r="1.3" fill="currentColor" />
      <circle cx="12.4" cy="3.2" r="1.3" fill="currentColor" />
    </>
  ),
  shapeCurve: (
    <>
      <path d="M1.5 13.5h13" />
      <path d="M2 13.5c5.6 0 8.8-2.8 10.4-8.8v8.8" />
      <circle cx="2" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.4" cy="4.7" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  shapeCircle: (
    <>
      <ellipse cx="8" cy="11.2" rx="6.3" ry="2.6" />
      <path d="M3.3 9.6C4.4 6.5 5.9 4.6 8 4.6s3.6 1.9 4.7 5" />
    </>
  ),
  shapeCopy: (
    <>
      <rect x="2" y="2" width="8" height="8" rx="1" strokeDasharray="1.8 1.4" />
      <rect x="6" y="6" width="8" height="8" rx="1" />
    </>
  ),
  view3d: <path d="M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8zM2.5 4.8 8 7.8l5.5-3M8 7.8v6.4" />,

  // ---- editor chrome ( Blender's area headers, status bar, reports )
  chevronLeft: <path d="M9.8 4.5 6.3 8l3.5 3.5" />,
  chevronUp: <path d="M4.5 9.8 8 6.3l3.5 3.5" />,
  outliner: <path d="M2.5 3.5h11M3 3.5v9h2.6M3 8h2.6M7.5 8h6M7.5 12.5h6" />,
  properties: (
    <>
      <path d="M2.5 4.2h11M2.5 8h11M2.5 11.8h11" />
      <circle cx="5.6" cy="4.2" r="1.4" fill="var(--icon-fill, #262624)" />
      <circle cx="10.4" cy="8" r="1.4" fill="var(--icon-fill, #262624)" />
      <circle cx="7" cy="11.8" r="1.4" fill="var(--icon-fill, #262624)" />
    </>
  ),
  assets: (
    <>
      <rect x="2.3" y="2.3" width="4.9" height="4.9" rx="1" />
      <rect x="8.8" y="2.3" width="4.9" height="4.9" rx="1" />
      <rect x="2.3" y="8.8" width="4.9" height="4.9" rx="1" />
      <rect x="8.8" y="8.8" width="4.9" height="4.9" rx="1" />
    </>
  ),
  collection: <path d="M2.2 3h11.6v2.6H2.2zM3 5.6h10v7.6H3zM6.4 8.2h3.2" />,
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="2.5" cy="6" r=".9" /><circle cx="5.5" cy="6" r=".9" /><circle cx="8.5" cy="6" r=".9" /><circle cx="11.5" cy="6" r=".9" />
      <circle cx="2.5" cy="10" r=".9" /><circle cx="5.5" cy="10" r=".9" /><circle cx="8.5" cy="10" r=".9" /><circle cx="11.5" cy="10" r=".9" />
    </g>
  ),
  eye: (
    <>
      <path d="M1.6 8s2.4-4.3 6.4-4.3S14.4 8 14.4 8s-2.4 4.3-6.4 4.3S1.6 8 1.6 8z" />
      <circle cx="8" cy="8" r="1.9" />
    </>
  ),
  game: (
    <>
      <path d="M5.1 5h5.8c2 0 3.4 1.7 3.4 3.9 0 1.6-.8 2.8-1.9 2.8-1.4 0-1.9-1.7-3-1.7H6.6c-1.1 0-1.6 1.7-3 1.7-1.1 0-1.9-1.2-1.9-2.8C1.7 6.7 3.1 5 5.1 5z" />
      <path d="M5 6.9v2.2M3.9 8h2.2M10.4 7.3h.01M11.6 8.7h.01" />
    </>
  ),
  person: (
    <>
      <circle cx="8" cy="3.6" r="1.7" />
      <path d="M5.2 14.2 6.4 9.2 5 7.1 8 6l3 1.1-1.4 2.1 1.2 5" />
    </>
  ),
  frame: <path d="M2.5 5.8V2.5h3.3M10.2 2.5h3.3v3.3M13.5 10.2v3.3h-3.3M5.8 13.5H2.5v-3.3" />,
  mouseLeft: (
    <>
      <rect x="4" y="1.8" width="8" height="12.4" rx="4" />
      <path d="M4 6.6h8M8 1.8v4.8" />
      <path d="M4.6 6.1V5.7A3.4 3.4 0 0 1 7.5 2.4v3.7z" fill="currentColor" stroke="none" />
    </>
  ),
  mouseRight: (
    <>
      <rect x="4" y="1.8" width="8" height="12.4" rx="4" />
      <path d="M4 6.6h8M8 1.8v4.8" />
      <path d="M11.4 6.1V5.7a3.4 3.4 0 0 0-2.9-3.3v3.7z" fill="currentColor" stroke="none" />
    </>
  ),
  mouseMiddle: (
    <>
      <rect x="4" y="1.8" width="8" height="12.4" rx="4" />
      <rect x="7.1" y="3.4" width="1.8" height="3.4" rx=".9" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.2v4M8 4.8h.01" strokeWidth="1.6" />
    </>
  ),
  warning: <path d="M8 2.2 14.3 13.3H1.7zM8 6.6v3.2M8 11.6h.01" />,
  magnet: (
    <>
      <path d="M3.4 2.6h2.8v5.6a1.8 1.8 0 0 0 3.6 0V2.6h2.8v5.6a4.6 4.6 0 0 1-9.2 0z" />
      <path d="M3.4 5.3h2.8M9.8 5.3h2.8" />
    </>
  ),
  error: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" />
    </>
  ),
  dots: (
    <g fill="currentColor" stroke="none">
      <circle cx="3.5" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.5" cy="8" r="1.1" />
    </g>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon( { name, size = 16, className, title }: { name: IconName; size?: number; className?: string; title?: string } ) {
  return (
    <svg
      className={`icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {ICONS[name]}
    </svg>
  );
}

// Every icon ( for the self-test's icon sheet ).
export const ICON_NAMES = Object.keys( ICONS ) as IconName[];
