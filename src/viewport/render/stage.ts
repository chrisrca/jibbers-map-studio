// The Assets workspace's floor, as Blender's 3D view has it: an endless grid fading off, its X and Y axes in red and
// green ( Blender's axes: core/blenderAxes.ts ) on a dark grey; in Rendered shading, snow under the pieces and mountains far off instead ( the game's look ).

import * as THREE from "three/webgpu";
import { abs, cameraPosition, float, fract, fwidth, max, min, mix, positionWorld, smoothstep, vec3 } from "three/tsl";
import { snowLook } from "./terrainRenderer";

// where the flat snow ends and the mountains start rising, and how far out they go ( metres )
const FLAT = 900, OUTER = 2600;

/**
 * Smooth value noise in 2D ( 0..1 ).
**/
function noise2( seed: number ) {
  const h = ( i: number, j: number ) => {
    const x = Math.sin( i * 127.1 + j * 311.7 + seed * 74.7 ) * 43758.5453;
    return x - Math.floor( x );
  };
  return ( x: number, y: number ) => {
    const i  = Math.floor( x ), j = Math.floor( y ), u = x - i, v = y - j;
    const su = u * u * ( 3 - 2 * u ), sv = v * v * ( 3 - 2 * v );
    const a  = h( i, j ) + ( h( i + 1, j ) - h( i, j ) ) * su, b = h( i, j + 1 ) + ( h( i + 1, j + 1 ) - h( i, j + 1 ) ) * su;
    return a + ( b - a ) * sv;
  };
}

function mountains() {
  const A      = 512, Rn = 48;
  const n      = noise2( 5 );
  // ridged noise, a few octaves: sharp crests, soft valleys
  const ridged = ( x: number, y: number ) => {
    let sum = 0, amp = 0.55, f = 1 / 700, norm = 0;
    for ( let o = 0; o < 5; o++ ) {
      const r = 1 - Math.abs( n( x * f + o * 17.3, y * f - o * 9.1 ) * 2 - 1 );
      sum    += r * r * amp;
      norm   += amp;
      amp    *= 0.5;
      f      *= 2.1;
    }
    return sum / norm;
  };
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for ( let j = 0; j <= Rn; j++ ) {
    const u   = j / Rn, r = FLAT + ( OUTER - FLAT ) * u;
    // up from the flat to a crest about two thirds out, easing off behind
    const env = Math.sin( Math.min( 1, u / 0.65 ) * Math.PI * 0.5 ) ** 1.5 * ( u > 0.65 ? 1 - 0.3 * ( ( u - 0.65 ) / 0.35 ) : 1 );
    for ( let i = 0; i <= A; i++ ) {
      const a = ( i / A ) * Math.PI * 2, x = Math.cos( a ) * r, z = Math.sin( a ) * r;
      pos.push( x, env * ( 120 + 620 * ridged( x, z ) ** 1.6 ), z );
    }
  }
  for ( let j = 0; j < Rn; j++ )
    for ( let i = 0; i < A; i++ ) {
      const a = j * ( A + 1 ) + i, b = a + 1, c = a + A + 1, d = c + 1;
      idx.push( a, b, c, b, d, c );
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute( "position", new THREE.Float32BufferAttribute( pos, 3 ) );
  g.setIndex( idx );
  g.computeVertexNormals();
  // the map's snow, and its grey rock where it's steep
  const nrm = g.getAttribute( "normal" ), snow = snowLook.baseColor.value, rockC = snowLook.rockColor.value;
  for ( let k = 0; k < nrm.count; k++ ) {
    const rock = Math.min( 1, Math.max( 0, ( 0.78 - Math.abs( nrm.getY( k ) ) ) / 0.14 ) );
    col.push( snow.r + ( rockC.r - snow.r ) * rock, snow.g + ( rockC.g - snow.g ) * rock, snow.b + ( rockC.b - snow.b ) * rock );
  }
  g.setAttribute( "color", new THREE.Float32BufferAttribute( col, 3 ) );
  const m = new THREE.Mesh( g, new THREE.MeshLambertNodeMaterial( { vertexColors: true } ) );
  m.name  = "stage-mountains";
  return m;
}

// Blender's 3D view background ( its theme's )
export const BLENDER_BG = 0x3d3d3d;

// TSL node types are too strict for this kind of arithmetic
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

// the grid's size ( metres ): it follows the camera, past where its lines have faded
const GRID = 640;

/**
 * The grid: lines every metre and every ten, the axes through the origin, fading with distance.
**/
function grid() {
  const mat    = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, side: THREE.DoubleSide } );
  const p: N   = positionWorld.xz;
  const lineOf = ( scale: number ): N => {
    const c: N = p.div( scale ), w: N = fwidth( c );
    const d: N = abs( fract( c.sub( 0.5 ) ).sub( 0.5 ) ).div( w );
    return float( 1 ).sub( min( min( d.x, d.y ), 1 ) );
  };
  const axis      = ( v: N ): N => float( 1 ).sub( min( abs( v ).div( fwidth( v ).mul( 1.5 ) ), 1 ) );
  const minor     = lineOf( 1 ), major = lineOf( 10 );
  const ax:    N  = axis( p.y ), az: N = axis( p.x );
  const fade:  N  = float( 1 ).sub( smoothstep( 30, 260, positionWorld.distance( cameraPosition ) ) );
  const lines: N  = max( minor.mul( 0.35 ), major.mul( 0.6 ) );
  let col: N      = mix( vec3( 0.33, 0.33, 0.33 ), vec3( 0.42, 0.42, 0.42 ), major );
  // Blender's X red, its Y ( into the scene ) green
  col             = mix( col, vec3( 0.86, 0.2, 0.27 ), ax );
  col             = mix( col, vec3( 0.45, 0.7, 0.1  ), az );
  mat.colorNode   = col;
  mat.opacityNode = max( lines, max( ax, az ).mul( 0.9 ) ).mul( fade );
  // ( small cells, under the camera: across one huge triangle the drawn position loses precision close up, and the
  // lines kinked where the two triangles of a 4 km square met, through the origin; the lines are gone 260 m off )
  const m         = new THREE.Mesh( new THREE.PlaneGeometry( GRID, GRID, GRID / 5, GRID / 5 ), mat );
  m.rotation.x    = -Math.PI / 2;
  m.renderOrder   = -1;
  m.name          = "stage-grid";
  return m;
}

export class Stage {
  readonly group   = new THREE.Group();
  // the game's look ( Rendered shading ): snow and mountains
  private world    = new THREE.Group();
  private gridMesh = grid();

  constructor() {
    this.group.name    = "stage";
    this.group.visible = false;
    // white snow as the map's looks in daylight, pushed back in depth so a face lying on it always shows over it
    const floor        = new THREE.MeshLambertNodeMaterial( { color: snowLook.baseColor.value, emissive: new THREE.Color( 0.16, 0.165, 0.175 ), polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 } );
    const snow         = new THREE.Mesh( new THREE.CircleGeometry( FLAT + 20, 128 ), floor );
    snow.rotation.x    = -Math.PI / 2;
    snow.name          = "stage-snow";
    this.world.add( snow, mountains() );
    this.world.visible = false;
    this.group.add( this.world, this.gridMesh );
  }

  /**
   * The look: Blender's grid ( and whether it shows ), or the game's snow and mountains.
  **/
  setLook( game: boolean, gridOn: boolean ) {
    this.world.visible    = game;
    this.gridMesh.visible = gridOn && !game;
  }

  // where the floor is ( Three.js space )
  readonly at = new THREE.Vector3();

  show( at: THREE.Vector3 ) {
    this.at.copy( at );
    this.group.position.copy( at );
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  get shown() {
    return this.group.visible;
  }

  /**
   * The grid kept under the camera ( its lines are where they are in the world, wherever it is ).
  **/
  follow( camera: THREE.Camera ) {
    const g = this.gridMesh;
    g.position.set( Math.round( ( camera.position.x - this.at.x ) / 10 ) * 10, 0, Math.round( ( camera.position.z - this.at.z ) / 10 ) * 10 );
  }

  /**
   * The floor under a ray, or null.
  **/
  pick( ray: THREE.Ray ): THREE.Vector3 | null {
    if ( !this.shown || Math.abs( ray.direction.y ) < 1e-6 ) return null;
    const t = ( this.at.y - ray.origin.y ) / ray.direction.y;
    if ( t <= 0 ) return null;
    const p = ray.origin.clone().addScaledVector( ray.direction, t );
    return Math.hypot( p.x - this.at.x, p.z - this.at.z ) <= 2000 ? p : null;
  }
}
