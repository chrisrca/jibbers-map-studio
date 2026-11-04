// The grind guides on jib pieces: where the game will grab a rider onto them ( viewport/tools/grindGuide.ts ).

import * as THREE from "three/webgpu";
import { type CustomObjectEntry } from "../../../core/types";
import { type GrindGuide, disposeGuide, grindGuide, guideObject } from "../../tools/grindGuide";
import { worldSurface } from "./geometry";
import type { CustomObjectsRenderer } from "./index";

// Jibs' grind guides.
export class GrindGuides {
  constructor( private renderer: CustomObjectsRenderer ) {}

  // grind guides ( where the game grabs a rider onto a jib ): selected jibs, or all of them
  group       = new THREE.Group();
  cache       = new Map<string, { data: CustomObjectEntry; obj: THREE.Group | null; guide: GrindGuide | null }>();
  private all = false;
  // a piece whose rail is being edited ( its curve is drawn instead )
  private hidden: string | null = null;
  // when each piece was last seen changed: one changing frame after frame ( dragged ) keeps its old guide until it's
  // still a moment ( made again from its surface every frame, that was a few ms a frame )
  private changedAt = new Map<string, number>();
  private later: ReturnType<typeof setTimeout> | null = null;
  // a piece being dragged by its tool ( a repeat's point ): no guide while it is, its rail not yet laid along the new
  // shape and the guide a few milliseconds to work out ( set by the engine )
  busy: ( uid: string ) => boolean = () => false;

  /**
   * Grind guides on every jib, not just selected ones.
  **/
  setAll( on: boolean ) {
    this.all = on;
    this.update();
  }

  hide( uid: string | null ) {
    if ( this.hidden === uid ) return;
    this.hidden = uid;
    this.update();
  }

  /**
   * The guide of a shown jib ( selected, or all are on ), for the Properties panel.
  **/
  of( uid: string ): GrindGuide | null {
    return this.cache.get( uid )?.guide ?? null;
  }

  update() {
    const want = new Set<string>();
    for ( const [uid, s] of this.renderer.shown ) {
      if ( s.data.surface_type === "Jib" && uid !== this.hidden && !this.busy( uid ) && ( this.all || this.renderer.selected.has( uid ) ) ) want.add( uid );
    }
    const now = performance.now();
    for ( const [uid, c] of this.cache ) {
      const s = this.renderer.shown.get( uid );
      // ( changed again within a moment of the last change: kept as it is, looked at again once it's still )
      if ( want.has( uid ) && s && s.built !== c.data && s.built === s.data ) {
        const prev = this.changedAt.get( uid );
        this.changedAt.set( uid, now );
        if ( prev !== undefined && now - prev < 150 ) {
          this.later ??= setTimeout( () => {
            this.later = null;
            this.update();
          }, 180 );
          continue;
        }
      }
      if ( !want.has( uid ) || !s || s.built !== c.data ) {
        if ( c.obj ) {
          this.group.remove( c.obj );
          disposeGuide( c.obj );
        }
        this.cache.delete( uid );
      }
    }
    for ( const uid of want ) {
      const s = this.renderer.shown.get( uid )!;
      // only from meshes built for the current data ( a changed piece is rebuilt first )
      if ( this.cache.has( uid ) || !s.built || s.built !== s.data || !s.group.children.length ) continue;
      const guide = grindGuide( s.data, worldSurface( s.group, 30000 ) );
      const obj   = guide ? guideObject( guide ) : null;
      if ( obj ) this.group.add( obj );
      this.cache.set( uid, { data: s.data, obj, guide } );
    }
    window.dispatchEvent( new CustomEvent( "grind-guides" ) );
  }
}
