// Edit Mode without a window: the editor on a modelled piece at the origin, seen by a camera of its own ( 800 × 600 ),
// given keys and clicks as the view passes them on.

import * as THREE from "three/webgpu";
import { history } from "../../../src/map/history";
import { useEditor } from "../../../src/map/store";
import type { Mesh, V3 } from "../../../src/model/mesh";
import { newModelObject } from "../../../src/model/objects";
import type { MenuItem } from "../../../src/ui/widgets/widgets";
import { ModelEditor } from "../../../src/viewport/edit/model/modelEditor";

export const W = 800, H = 600;

export function editing( start: Mesh, from: V3 = [4, 3, 5] ) {
  history.clear();
  const o = newModelObject( "m", start, [0, 0, 0] );
  // ( the Assets workspace first: going into it sets the map's pieces aside for its own scene )
  useEditor.setState( { tool: "model" } );
  useEditor.setState( {
    customObjects: [o],
    selection:     [{ kind: "custom", uid: "m" }],
    cursor3d:      [0, 0, 0],
    modelTools:    { snap: false, snapTo: "increment", proportional: false, propRadius: 1, pivot: "median" },
  } );
  const camera = new THREE.PerspectiveCamera( 50, W / H, 0.1, 1000 );
  camera.position.set( from[0], from[1], -from[2] );
  camera.lookAt( 0, 0, 0 );
  camera.updateMatrixWorld();
  const menus: { title: string; items: MenuItem[] }[] = [];
  const view                                          = {
    camera,
    host: { clientWidth: W, clientHeight: H, getBoundingClientRect: () => ( { left: 0, top: 0, width: W, height: H } ) } as unknown as HTMLElement,
    ray:  ( x: number, y: number ) => {
      const r = new THREE.Raycaster();
      r.setFromCamera( new THREE.Vector2( ( x / W ) * 2 - 1, 1 - ( y / H ) * 2 ), camera );
      return r;
    },
    menu: ( _x: number, _y: number, title: string, items: MenuItem[] ) => void menus.push( { title, items } ),
  };
  const ed = new ModelEditor( view );
  ed.enter( "m" );
  const mods    = { shiftKey: false, ctrlKey: false, altKey: false };
  const mesh    = () => ed.obj()!.model.mesh;
  // a point of the piece on the screen
  const at      = ( p: V3 ): [number, number] => {
    const [x, y] = ed.picking.screen( ed.world( ed.obj()!, p ) );
    return [x, y];
  };
  const key     = ( k: string, m: Partial<typeof mods> = {} ) => ed.key( { key: k, ...mods, ...m } as KeyboardEvent );
  const move    = ( x: number, y: number, m: Partial<typeof mods> = {} ) => ed.move( { ...mods, ...m } as PointerEvent, x, y );
  const click   = ( x: number, y: number, m: Partial<typeof mods> = {} ) => {
    move( x, y, m );
    ed.down( { button: 0, ...mods, ...m } as PointerEvent, x, y );
    ed.up( { button: 0, ...mods, ...m } as PointerEvent, x, y );
  };
  // a menu's item run, by its label ( in a submenu too )
  const choose  = ( label: string ) => {
    const find = ( items: MenuItem[] ): MenuItem | undefined => {
      for ( const it of items ) {
        if ( it.label === label ) return it;
        const sub = it.sub && find( it.sub );
        if ( sub ) return sub;
      }
    };
    const it = find( menus[menus.length - 1]?.items ?? [] );
    if ( !it?.run ) throw new Error( `no ${label} in the menu` );
    it.run();
  };
  return { ed, mesh, at, key, move, click, choose, menus };
}

/**
 * The middle of an edge on the screen.
**/
export const midOf = ( e: ReturnType<typeof editing>, a: number, b: number ): [number, number] => {
  const [ax, ay] = e.at( e.mesh().v[a] ), [bx, by] = e.at( e.mesh().v[b] );
  return [( ax + bx ) / 2, ( ay + by ) / 2];
};
