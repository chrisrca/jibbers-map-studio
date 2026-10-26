// The Assets workspace's Material tab, as Blender's: the piece's material slots ( add, remove, move, Assign /
// Select / Deselect the faces in Edit Mode ), the slot's material as a named data-block ( browse, rename, users, new,
// unlink ), then Preview, Surface ( Principled-style inputs, each able to take an image ), Settings, the game shader's
// Effects and the piece's Paint. A named material is shared: a change applies wherever the map uses it, as in Blender.

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../core/ipc";
import { materialOverlay, withOverlay } from "../../core/overlay";
import type { CustomMaterial, CustomObjectEntry } from "../../core/types";
import { defaultMaterial, isModel, withModel } from "../../model/objects";
import { materialName } from "../../pieces/userAssets";
import { useEditor } from "../../map/store";
import { NumberField } from "../widgets/controls";
import { ColourChip } from "../widgets/ColourPicker";
import { usePreview, materialSpherePreview } from "../previews";
import { getEngine } from "../Viewport";
import { Dropdown, MenuButton, NumSlider, PanelGroups, type MenuItem } from "../widgets/widgets";
import { BlIcon } from "./BlIcon";
import { paintRows } from "../panels/MaterialEditor";
import { useWeather } from "./WeatherPanels";

type Socket = "base_tex" | "normal_tex" | "metallic_tex" | "roughness_tex" | "emission_tex";
type Prop   = { Float: number } | { Vector: [number, number, number, number] } | { Color: [number, number, number, number] } | { Texture: string };
interface Live {
  begin(): void;
  commit( label: string ): void;
}

/**
 * The piece's slots: a modelled piece's are its faces' ( they can be added, removed, moved, assigned ); another piece's
 * are the distinct materials its parts use.
**/
export function slotsOf( o: CustomObjectEntry ): CustomMaterial[] {
  if ( isModel( o ) ) return o.parts[0]?.materials ?? [];
  const seen = new Map<string, CustomMaterial>();
  for ( const p of o.parts ) for ( const m of p.materials ) seen.set( JSON.stringify( m ), m );
  return [...seen.values()];
}

/**
 * A material's name: its own, else its image's, else Blender's "Material".
**/
export const nameOf = ( m: CustomMaterial ) => ( m.name as string | undefined ) || ( m.base_tex ? materialName( m ) : "Material" );

/**
 * Every named material in the map, by name.
**/
function namedMaterials( objects: CustomObjectEntry[] ) {
  const out = new Map<string, { m: CustomMaterial; users: number }>();
  for ( const o of objects )
    for ( const p of o.parts.filter( ( p ) => p.lod_index === 0 || p.lod_index === undefined ) )
      for ( const m of p.materials ) {
        const n = m.name as string | undefined;
        if ( !n ) continue;
        const e = out.get( n );
        if ( e ) e.users++;
        else out.set( n, { m, users: 1 } );
      }
  return out;
}

/**
 * A name not taken by another material in the map ( Blender's ".001" ).
**/
function freeName( objects: CustomObjectEntry[], want: string ) {
  const taken = namedMaterials( objects );
  if ( !taken.has( want ) ) return want;
  const base = want.replace( /\.\d{3}$/, "" );
  for ( let k = 1; ; k++ ) {
    const n = `${base}.${String( k ).padStart( 3, "0" )}`;
    if ( !taken.has( n ) ) return n;
  }
}

const props     = ( m: CustomMaterial ) => ( m.extra_props ?? {} ) as Record<string, Prop>;
const floatProp = ( m: CustomMaterial, k: string, d: number ) => {
  const p = props( m )[k];
  return p && "Float" in p ? p.Float : d;
};
const vecProp = ( m: CustomMaterial, k: string ): [number, number, number, number] => {
  const p = props( m )[k];
  return p && "Vector" in p ? p.Vector : [0, 0, 0, 0];
};
const withProps = ( m: CustomMaterial, add: Record<string, Prop> ) => ( { ...m, extra_props: { ...props( m ), ...add } } );

export function MaterialTab( { o, live }: { o: CustomObjectEntry; live: Live } ) {
  // ( the active slot is the piece's, as Blender's active material index is the object's: kept however the tab is drawn )
  const [slot, setSlotState] = useState( () => activeSlot.get( o.uid ) ?? 0 );
  const setSlot              = ( k: number ) => {
    activeSlot.set( o.uid, k );
    setSlotState( k );
  };
  const editing = useEditor( ( s ) => s.modelEdit?.uid === o.uid );
  const objects = useEditor( ( s ) => s.customObjects            );
  const slots   = slotsOf( o );
  const i       = Math.max( 0, Math.min( slot, slots.length - 1 ) );
  const m       = slots[i];
  const shape   = isModel( o );
  const named   = namedMaterials( objects );
  const users   = m?.name ? named.get( m.name as string )?.users ?? 1 : 1;

  /**
   * Every material that's this slot's changed: wherever it's used when it's named, else in this piece.
  **/
  const change = ( f: ( m: CustomMaterial ) => CustomMaterial ) => {
    live.begin();
    useEditor.setState( ( s ) => {
      const cur = slotsOf( s.customObjects.find( ( x ) => x.uid === o.uid ) ?? o )[i];
      if ( !cur ) return {};
      const name = cur.name as string | undefined, key = JSON.stringify( cur );
      const same = ( mm: CustomMaterial ) => ( name ? mm.name === name : JSON.stringify( mm ) === key );
      return {
        customObjects: s.customObjects.map( ( x ) =>
          name || x.uid === o.uid ? { ...x, parts: x.parts.map( ( p ) => ( { ...p, materials: p.materials.map( ( mm ) => ( same( mm ) ? f( mm ) : mm ) ) } ) ) } : x,
        ),
      };
    } );
  };
  const commit = ( label = "Edit material" ) => live.commit( label );
  const field  = <K extends keyof CustomMaterial>( k: K, v: CustomMaterial[K] ) => change( ( mm ) => ( { ...mm, [k]: v } ) );

  /**
   * This piece's slots set afresh ( a modelled piece's faces remapped by `remap` ).
  **/
  const setSlots = ( list: CustomMaterial[], label: string, remap?: ( slot: number ) => number ) => {
    live.begin();
    useEditor.setState( ( s ) => ( {
      customObjects: s.customObjects.map( ( x ) => {
        if ( x.uid !== o.uid || !isModel( x ) ) return x;
        const mesh = remap ? { ...x.model.mesh, m: x.model.mesh.f.map( ( _, k ) => remap( x.model.mesh.m[k] ?? 0 ) ) } : x.model.mesh;
        return withModel( { ...x, parts: [{ ...x.parts[0], materials: list }, ...x.parts.slice( 1 )] }, { ...x.model, mesh } );
      } ),
    } ) );
    commit( label );
  };
  /**
   * This slot ( only ) given material `next`.
  **/
  const putInSlot = ( next: CustomMaterial, label: string ) => {
    if ( shape ) return setSlots( slots.map( ( s, k ) => ( k === i ? next : s ) ), label );
    const key = JSON.stringify( m );
    live.begin();
    useEditor.setState( ( s ) => ( {
      customObjects: s.customObjects.map( ( x ) => ( x.uid === o.uid ? { ...x, parts: x.parts.map( ( p ) => ( { ...p, materials: p.materials.map( ( mm ) => ( JSON.stringify( mm ) === key ? next : mm ) ) } ) ) } : x ) ),
    } ) );
    commit( label );
  };

  const add = () => {
    setSlots( [...slots, { ...defaultMaterial(), name: freeName( objects, "Material" ) }], "Add material slot" );
    setSlot( slots.length );
  };
  const remove = () => {
    if ( slots.length <= 1 ) return;
    // ( the removed slot's faces go to the one before it, as in Blender )
    setSlots( slots.filter( ( _, k ) => k !== i ), "Remove material slot", ( s ) => ( s === i ? Math.max( 0, i - 1 ) : s > i ? s - 1 : s ) );
    setSlot( Math.max( 0, i - 1 ) );
  };
  const move = ( d: number ) => {
    const j = i + d;
    if ( j < 0 || j >= slots.length ) return;
    const list = [...slots];
    [list[i], list[j]] = [list[j], list[i]];
    setSlots( list, "Move material slot", ( s ) => ( s === i ? j : s === j ? i : s ) );
    setSlot( j );
  };
  const unused = () => {
    if ( !isModel( o ) ) return;
    const used = new Set( o.model.mesh.m );
    const keep = slots.map( ( _, k ) => k ).filter( ( k ) => used.has( k ) );
    if ( !keep.length || keep.length === slots.length ) return;
    setSlots( keep.map( ( k ) => slots[k] ), "Remove unused slots", ( s ) => Math.max( 0, keep.indexOf( s ) ) );
    setSlot( 0 );
  };

  const specials: MenuItem[] = [
    { label: "Copy Material",  bl: "copydown",  run:      () => ( copied = structuredClone( m ) ) },
    { label: "Paste Material", bl: "pastedown", disabled: !copied, run: () => copied && change( ( mm ) => ( { ...structuredClone( copied! ), name: mm.name } ) ) },
    { label: "Copy Material to Selected", run: () => copyToSelected( o, m ) },
    ...( shape ? [{ label: "Remove Unused Slots", run: unused } as MenuItem] : [] ),
  ];
  const browse: MenuItem[] = [
    ...[...named.entries()].map( ( [n, e] ) => ( { label: n, bl: "material", checked: m?.name === n, run: () => putInSlot( e.m, "Assign material" ) } ) ),
    ...( useEditor.getState().assetLibrary.filter( ( e ) => e.kind === "material" && e.material ).length
      ? [{ label: "Library", sep: true } as MenuItem, ...useEditor.getState().assetLibrary.filter( ( e ) => e.kind === "material" && e.material ).slice( 0, 60 ).map( ( e ) => ( { label: e.name, bl: "material", run: () => putInSlot( { ...( e.material as CustomMaterial ), name: freeName( objects, e.name ) }, "Assign material" ) } ) )]
      : [] ),
  ];

  const pickTexture = async ( s: Socket ) => {
    const dir  = useEditor.getState().projectDir;
    const file = await open( { title: "Pick an image", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "tga", "bmp", "webp"] }] } );
    if ( !dir || typeof file !== "string" ) return;
    try {
      const key = await ipc.addTextureToProject( dir, file, s !== "base_tex" && s !== "emission_tex" );
      useEditor.setState( { library: "assets/library.jbrmap" } );
      getEngine()?.customR.reloadLibrary();
      // ( an image on a black glow would show nothing: white lets it through )
      change( ( mm ) => ( { ...mm, [s]: key, ...( s === "emission_tex" && mm.emission_color.r + mm.emission_color.g + mm.emission_color.b === 0 ? { emission_color: { r: 1, g: 1, b: 1, a: 1 } } : {} ) } ) );
      commit( "Image texture" );
    } catch ( e ) {
      useEditor.getState().toast( `Couldn't use that image: ${e}`, "error" );
    }
  };
  /**
   * An input's image: the file it takes ( pick another, take it away ), as a linked Image Texture node shows.
  **/
  const image = ( s: Socket ) => {
    const key = ( m[s] as string ) ?? "";
    return (
      <>
        <label />
        <div className="bl-socket">
          <BlIcon name="image" size={14} />
          <span className={key ? "" : "muted"} title={key || undefined}>{key ? key.split( "/" ).pop()?.replace( /-[0-9a-f]{8}$/, "" ) : "No image"}</span>
          <button className="btn small" title="Open an image" onClick={() => pickTexture( s )}><BlIcon name="file_folder" size={14} /></button>
          {key && <button className="btn small" title="Unlink" onClick={() => { field( s, "" ); commit( "Unlink image" ); }}><BlIcon name="x" size={14} /></button>}
        </div>
      </>
    );
  };
  const strength = Math.max( m?.emission_color.r ?? 0, m?.emission_color.g ?? 0, m?.emission_color.b ?? 0 );
  const scroll   = m ? vecProp( m, "_UvScroll" ) : [0, 0, 0, 0];
  const weather  = useWeather();
  const preview  = usePreview( () => ( m ? materialSpherePreview( m ) : Promise.resolve( null ) ), [m ? JSON.stringify( m ) : ""] );

  if ( !m ) return null;
  return (
    <PanelGroups kind="Material">
    <div className="props">
      <div className="bl-list-row">
        <div className="bl-list" role="listbox">
          { slots.map( ( s, k ) => (
            <div key={k} className={`bl-list-item ${k === i ? "on" : ""}`} onClick={() => setSlot( k )}>
              <BlIcon name="material" size={14} />
              <span className="name">{nameOf( s )}</span>
            </div>
          ) ) }
        </div>
        <div className="bl-list-side">
          <button className="bl-ibtn" title="Add Material Slot" disabled={!shape} onClick={add}><BlIcon name="add" size={14} /></button>
          <button className="bl-ibtn" title="Remove Material Slot" disabled={!shape || slots.length <= 1} onClick={remove}><BlIcon name="remove" size={14} /></button>
          <MenuButton bl="downarrow_hlt" className="bl-ibtn" title="Material Specials" items={specials} caret={false} />
          { shape && slots.length > 1 && (
            <>
              <button className="bl-ibtn" title="Move Up" disabled={i === 0} onClick={() => move( -1 )}><BlIcon name="tria_up" size={14} /></button>
              <button className="bl-ibtn" title="Move Down" disabled={i === slots.length - 1} onClick={() => move( 1 )}><BlIcon name="tria_down" size={14} /></button>
            </>
          ) }
        </div>
      </div>
      { editing && shape && (
        <div className="bl-row3">
          <button className="btn" onClick={() => getEngine()?.modelEd.menus.assignSlot( i ) || useEditor.getState().toast( "Select some faces first", "info" )}>Assign</button>
          <button className="btn" onClick={() => getEngine()?.modelEd.menus.selectSlot( i, true )}>Select</button>
          <button className="btn" onClick={() => getEngine()?.modelEd.menus.selectSlot( i, false )}>Deselect</button>
        </div>
      ) }
      <div className="bl-datablock">
        <MenuButton bl="material" className="bl-ibtn browse" title="Browse Material to be linked" items={browse.length ? browse : [{ label: "No other materials", disabled: true }]} />
        <input
          className="txt"
          key={`${o.uid}:${i}:${nameOf( m )}`}
          defaultValue={nameOf( m )}
          onKeyDown={( e ) => e.key === "Enter" && ( e.target as HTMLInputElement ).blur()}
          onBlur={( e ) => {
            const v = e.target.value.trim();
            if ( !v || v === nameOf( m ) ) return;
            const n = freeName( objects.map( ( x ) => x ), v );
            change( ( mm ) => ( { ...mm, name: n } ) );
            commit( "Rename material" );
          }}
        />
        { users > 1 && (
          <button className="bl-ibtn users" title={`Display number of users of this data (click to make a single-user copy)`} onClick={() => putInSlot( { ...m, name: freeName( objects, nameOf( m ) ) }, "Make single user" )}>
            {users}
          </button>
        ) }
        <button className="bl-ibtn" title="New Material" onClick={() => putInSlot( { ...structuredClone( m ), name: freeName( objects, nameOf( m ) ) }, "New material" )}><BlIcon name="duplicate" size={14} /></button>
        <button className="bl-ibtn" title="Unlink Data-Block" onClick={() => putInSlot( defaultMaterial(), "Unlink material" )}><BlIcon name="x" size={14} /></button>
      </div>

      <div className="section">Preview</div>
      <div className="bl-preview">{preview ? <img src={preview} alt="" draggable={false} /> : <span className="spinner-inline" />}</div>

      <div className="section">Surface</div>
      <label>Surface</label>
      <div className="bl-node"><BlIcon name="shading_rendered" size={14} />Principled BSDF</div>
      <label>Base Color</label>
      <div><ColourChip value={[m.base_color.r, m.base_color.g, m.base_color.b]} onChange={( [r, g, b] ) => { field( "base_color", { r, g, b, a: m.base_color.a } ); commit(); }} /></div>
      {image( "base_tex" )}
      <label>Metallic</label>
      <NumSlider value={m.metallic} min={0} max={1} onChange={( v ) => field( "metallic", v )} onCommit={commit} />
      {image( "metallic_tex" )}
      <label>Roughness</label>
      <NumSlider value={1 - m.smoothness} min={0} max={1} onChange={( v ) => field( "smoothness", 1 - v )} onCommit={commit} />
      {image( "roughness_tex" )}
      <label>Alpha</label>
      <NumSlider value={m.base_color.a} min={0} max={1} onChange={( v ) => field( "base_color", { ...m.base_color, a: v } )} onCommit={commit} />
      <label>Normal</label>
      <div className="bl-node muted">{m.normal_tex ? "Normal Map" : "Default"}</div>
      {image( "normal_tex" )}
      <label>Emission Color</label>
      <div>
        <ColourChip
          value={strength > 0 ? [m.emission_color.r / strength, m.emission_color.g / strength, m.emission_color.b / strength] : [0, 0, 0]}
          onChange={( [r, g, b] ) => { const k = strength || 1; field( "emission_color", { r: r * k, g: g * k, b: b * k, a: 1 } ); commit(); }}
        />
      </div>
      {image( "emission_tex" )}
      <label>Emission Strength</label>
      <NumberField
        value={strength}
        step={0.1}
        min={0}
        max={100}
        onChange={( v ) => change( ( mm ) => {
          const s = Math.max( mm.emission_color.r, mm.emission_color.g, mm.emission_color.b ), c = s > 0 ? mm.emission_color : { r: 1, g: 1, b: 1, a: 1 }, d = s > 0 ? s : 1;
          return { ...mm, emission_color: { r: ( c.r / d ) * v, g: ( c.g / d ) * v, b: ( c.b / d ) * v, a: 1 } };
        } )}
        onCommit={commit}
      />
      <label>Scale</label>
      <div className="pair">
        <NumberField value={m.tiling.x} step={0.1} onChange={( v ) => field( "tiling", { ...m.tiling, x: v } )} onCommit={commit} />
        <NumberField value={m.tiling.y} step={0.1} onChange={( v ) => field( "tiling", { ...m.tiling, y: v } )} onCommit={commit} />
      </div>
      <label>Location</label>
      <div className="pair">
        <NumberField value={m.offset.x} step={0.05} onChange={( v ) => field( "offset", { ...m.offset, x: v } )} onCommit={commit} />
        <NumberField value={m.offset.y} step={0.05} onChange={( v ) => field( "offset", { ...m.offset, y: v } )} onCommit={commit} />
      </div>

      <div className="section">Settings</div>
      <label>Blend Mode</label>
      <Dropdown
        value={m.render_mode}
        menuTitle="Blend Mode"
        options={[{ value: 0, label: "Opaque" }, { value: 1, label: "Alpha Clip" }, { value: 2, label: "Alpha Blend" }]}
        onChange={( v ) => { field( "render_mode", Number( v ) ); commit(); }}
      />
      { m.render_mode === 1 && (
        <>
          <label>Clip Threshold</label>
          <NumSlider value={m.alpha_cutoff} min={0} max={1} onChange={( v ) => field( "alpha_cutoff", v )} onCommit={commit} />
        </>
      ) }
      <label />
      <label className="check">
        <input type="checkbox" checked={m.cull_mode !== 0} onChange={( e ) => { field( "cull_mode", e.target.checked ? 2 : 0 ); commit(); }} /> Backface Culling
      </label>

      <div className="section">Effects</div>
      <label />
      <label className="check">
        <input type="checkbox" checked={!!materialOverlay( m )} onChange={( e ) => { change( ( mm ) => withOverlay( mm, e.target.checked ) ); commit(); }} /> Snow on Top
      </label>
      <label>UV Scroll</label>
      <div className="pair">
        <NumberField value={scroll[0]} step={0.01} onChange={( v ) => change( ( mm ) => withProps( mm, { _UvScroll: { Vector: [v, vecProp( mm, "_UvScroll" )[1], 0, 0] } } ) )} onCommit={commit} />
        <NumberField value={scroll[1]} step={0.01} onChange={( v ) => change( ( mm ) => withProps( mm, { _UvScroll: { Vector: [vecProp( mm, "_UvScroll" )[0], v, 0, 0] } } ) )} onCommit={commit} />
      </div>
      <label>Glow Pulse</label>
      <NumSlider value={floatProp( m, "_EmissionPulse", 0 )} min={0} max={1} onChange={( v ) => change( ( mm ) => withProps( mm, { _EmissionPulse: { Float: v } } ) )} onCommit={commit} />
      <label>Pulse Speed</label>
      <NumberField value={floatProp( m, "_EmissionPulseSpeed", 1 )} step={0.1} min={0} max={20} unit="Hz" onChange={( v ) => change( ( mm ) => withProps( mm, { _EmissionPulseSpeed: { Float: v } } ) )} onCommit={commit} />
      <label>Glow Flicker</label>
      <NumSlider value={floatProp( m, "_EmissionFlicker", 0 )} min={0} max={1} onChange={( v ) => change( ( mm ) => withProps( mm, { _EmissionFlicker: { Float: v } } ) )} onCommit={commit} />
      {isModel( o ) && <div className="section">Paint</div>}
      {isModel( o ) && paintRows( o, weather )}
    </div>
    </PanelGroups>
  );
}

// Each piece's active slot.
const activeSlot = new Map<string, number>();

// The material copied with Copy Material.
let copied: CustomMaterial | null = null;

/**
 * The other selected pieces given this material in every slot ( Blender's Copy Material to Selected ).
**/
function copyToSelected( from: CustomObjectEntry, m: CustomMaterial ) {
  const st     = useEditor.getState();
  const others = st.selection.filter( ( s ) => s.kind === "custom" && s.uid !== from.uid ).map( ( s ) => s.uid );
  if ( !others.length ) return st.toast( "Select other pieces too", "info" );
  st.updateCustom( "Copy material to selected", others, ( x ) => {
    const next = { ...x, parts: x.parts.map( ( p ) => ( { ...p, materials: p.materials.map( () => m ) } ) ) };
    return isModel( next ) ? withModel( next, next.model ) : next;
  } );
}
