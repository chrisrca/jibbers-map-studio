// The trail ground's settings, and the bend it keeps ( a coarse field of metres added to the ground beneath ).

export interface GroundSettings {
  // metres round the trails the ground bends to meet them ( beyond, it's the ground beneath )
  blend:     number;
  // noise between and round the trails: metres up and down, how big its features are, how rough, how far from a
  // trail it starts
  amount:    number;
  size:      number;
  roughness: number;
  edge:      number;
  seed:      number;
}

export const REAL_GROUND: GroundSettings = {
  blend:     80,
  amount:    0,
  size:      300,
  roughness: 0.5,
  edge:      40,
  seed:      1,
};

export const NEW_GROUND: GroundSettings = {
  blend:     150,
  amount:    6,
  size:      250,
  roughness: 0.45,
  edge:      80,
  seed:      1,
};

// The bend ( metres added to the ground beneath ) on a coarse grid; never changed once made ( undo keeps old ones ).
export interface Field {
  x0:       number;
  z0:       number;
  sp:       number;
  w:        number;
  h:        number;
  c:        Float32Array;
  // the runs' offsets spread before fading ( what the next change starts from: only round what changed is worked
  // out again )
  s:        Float32Array;
  // the settings it was made with ( others: made again everywhere )
  settings: GroundSettings;
  // 2: read between its cells smoothly ( Catmull-Rom ); missing: straight between them, as the first trails' saved
  // ground was made ( their cells showed as facets and steps )
  v?:       number;
  // the ground beneath, smoothed ( ~8 m ), near the runs: what runs keeping the ground's detail lay their shape on
  // ( the ground less this is the detail )
  b?:       Float32Array;
}

export type Rect = [number, number, number, number];

export const sameSettings = ( a: GroundSettings | undefined, b: GroundSettings ) =>
  !!a && a.blend === b.blend && a.amount === b.amount && a.size === b.size && a.roughness === b.roughness && a.edge === b.edge && a.seed === b.seed;
