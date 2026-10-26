import { useEffect, useRef, useState } from "react";
import { customName } from "../../core/types";
import { BlIcon } from "../blender/BlIcon";
import { useEditor, workspaceOf, type Collection, type Selection } from "../../map/store";
import { PLACEHOLDER_COLORS } from "../../viewport/render/objectsRenderer";
import { Icon, type IconName } from "../widgets/icons";
import { getEngine } from "../Viewport";
import { plainText, RichText } from "../widgets/RichText";
import { PopupMenu, type MenuItem } from "../widgets/widgets";

// Collections folded shut ( kept while the app runs ).
const closed = new Set<string>();

type Item = { sel: Selection; name: string; icon?: IconName; dot?: string; bl?: string };

/**
 * A feature's id as words ( "rail_long" → "Rail Long" ).
**/
const pretty = ( id: string ) => id.replace( /_/g, " " ).replace( /\b\w/g, ( c ) => c.toUpperCase() );
const byName = ( a:  { name: string }, b: { name: string } ) => a.name.localeCompare( b.name, undefined, { numeric: true, sensitivity: "base" } );

/**
 * Everything in the map as Outliner items, named as shown.
**/
function useItems(): Item[] {
  const objects = useEditor( ( s ) => s.objects       );
  const spawns  = useEditor( ( s ) => s.spawns        );
  const custom  = useEditor( ( s ) => s.customObjects );
  const shapes  = useEditor( ( s ) => s.shapes        );
  const labels  = useEditor( ( s ) => s.labels        );
  return [
    ...spawns.map( ( s ): Item => ( { sel: { kind: "spawn", uid: s.uid }, name: s.name, icon: "spawn" } ) ),
    ...shapes.map( ( s ): Item => ( { sel: { kind: "shape", uid: s.uid }, name: s.name, icon: s.kind === "circle" ? "shapeCircle" : s.kind === "stamp" ? "shapeCopy" : "shapeCurve" } ) ),
    ...objects.map( ( o ): Item => {
      const c   = o.params?.color;
      const col = c?.type === "String" ? PLACEHOLDER_COLORS[c.value] : undefined;
      return { sel: { kind: "object", uid: o.uid }, name: labels[o.uid] ?? pretty( o.id ), dot: col !== undefined ? `#${col.toString( 16 ).padStart( 6, "0" )}` : "#9a9a9a" };
    } ),
    ...custom.map( ( o ): Item => ( { sel: { kind: "custom", uid: o.uid }, name: labels[o.uid] || customName( o ), icon: "cube", bl: o.model?.curve && !o.model.mesh.f.length ? "outliner_ob_curve" : "outliner_ob_mesh" } ) ),
  ];
}

const st = useEditor.getState;

/**
 * Blender's Outliner: the map's contents in collections the user makes, names and nests. Click selects ( Shift/Ctrl
 * adds ), double-click renames, drag moves things between collections, right-click for more. The active collection
 * ( click one ) is where new things go.
**/
export function Outliner() {
  const items                   = useItems();
  const assets                  = useEditor( ( s ) => workspaceOf( s.tool ) === "assets" );
  const hidden                  = useEditor( ( s ) => s.hiddenInView                     );
  const collections             = useEditor( ( s ) => s.collections                      );
  const membership              = useEditor( ( s ) => s.membership                       );
  const selection               = useEditor( ( s ) => s.selection                        );
  const activeCollection        = useEditor( ( s ) => s.activeCollection                 );
  const locked                  = useEditor( ( s ) => s.locked                           );
  const mapName                 = useEditor( ( s ) => s.map?.name ?? "Map"               );
  const [q,        setQ       ] = useState( "" );
  const [renaming, setRenaming] = useState<string | null>( null );
  const [menu,     setMenu    ] = useState<{ at: DOMRect; items: MenuItem[] } | null>( null );
  const [dropOn,   setDropOn  ] = useState<string | null>( null );
  const [, bump]                = useState( 0 );

  const sel     = new Set( selection.map( ( s ) => s.uid ) );
  const active  = selection[selection.length - 1]?.uid;
  const ids     = new Set( collections.map( ( c ) => c.id ) );
  const home    = ( uid: string ) => ( membership[uid] && ids.has( membership[uid] ) ? membership[uid] : null );
  const ql      = q.trim().toLowerCase();
  const matches = ( it: Item ) => !ql || it.name.toLowerCase().includes( ql );

  // what's in each collection ( and whether anything under it matches the search )
  const childCols  = ( parent: string | null ) => collections.filter( ( c ) => c.parent === parent );
  const childItems = ( parent: string | null ) => items.filter( ( it ) => home( it.sel.uid ) === parent ).sort( byName );
  const countIn    = ( id: string ): number  => childItems( id ).length + childCols( id ).reduce( ( n, c ) => n + countIn( c.id ), 0 );
  const hasMatch   = ( id: string ): boolean => childItems( id ).some( matches ) || childCols( id ).some( ( c ) => hasMatch( c.id ) );

  const click = ( s: Selection, e: React.MouseEvent ) => {
    if ( e.shiftKey || e.ctrlKey ) st().setSelection( sel.has( s.uid ) ? selection.filter( ( x ) => x.uid !== s.uid ) : [...selection, s] );
    else st().setSelection( [s] );
  };
  const itemsUnder = ( id: string ): Selection[] => [...childItems( id ).map( ( i ) => i.sel ), ...childCols( id ).flatMap( ( c ) => itemsUnder( c.id ) )];

  // ---------------------------------------------------------------- dragging rows onto collections
  const drag  = useRef<{ what: { items: string[] } | { collection: string }; x: number; y: number; on: boolean; label: string } | null>( null );
  const ghost = useRef<HTMLDivElement>( null );
  useEffect( () => {
    const move = ( e: PointerEvent ) => {
      const d = drag.current;
      if ( !d ) return;
      if ( !d.on && Math.hypot( e.clientX - d.x, e.clientY - d.y ) < 5 ) return;
      d.on = true;
      document.body.classList.add( "ol-dragging" );
      if ( ghost.current ) {
        ghost.current.style.display   = "block";
        ghost.current.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 10}px)`;
        ghost.current.textContent     = d.label;
      }
      const row = ( document.elementFromPoint( e.clientX, e.clientY ) as HTMLElement | null )?.closest<HTMLElement>( "[data-drop]" );
      setDropOn( row?.dataset.drop ?? null );
    };
    const up = ( e: PointerEvent ) => {
      const d      = drag.current;
      drag.current = null;
      document.body.classList.remove( "ol-dragging" );
      if ( ghost.current ) ghost.current.style.display = "none";
      setDropOn( null );
      if ( !d?.on ) return;
      const row = ( document.elementFromPoint( e.clientX, e.clientY ) as HTMLElement | null )?.closest<HTMLElement>( "[data-drop]" );
      if ( !row ) return;
      const to = row.dataset.drop === "root" ? null : row.dataset.drop!;
      if ( "items" in d.what ) st().moveToCollection( d.what.items, to );
      else if ( d.what.collection !== to ) st().moveCollection( d.what.collection, to );
    };
    window.addEventListener( "pointermove", move );
    window.addEventListener( "pointerup",   up   );
    return () => {
      window.removeEventListener( "pointermove", move );
      window.removeEventListener( "pointerup",   up   );
    };
  }, [] );
  const startItemDrag = ( e: React.PointerEvent, it: Item ) => {
    if ( e.button !== 0 ) return;
    const uids   = sel.has( it.sel.uid ) ? selection.map( ( s ) => s.uid ) : [it.sel.uid];
    drag.current = { what: { items: uids }, x: e.clientX, y: e.clientY, on: false, label: uids.length > 1 ? `${uids.length} items` : it.name };
  };
  const startCollectionDrag = ( e: React.PointerEvent, c: Collection ) => {
    if ( e.button !== 0 ) return;
    drag.current = { what: { collection: c.id }, x: e.clientX, y: e.clientY, on: false, label: c.name };
  };

  // ---------------------------------------------------------------- right-click menus
  const at        = ( e: React.MouseEvent ) => new DOMRect( e.clientX, e.clientY, 0, 0 );
  const moveItems = ( uids: string[] ): MenuItem[] => [
    { label: `Move to ${plainText( mapName )}`, icon: "mountain", run: () => st().moveToCollection( uids, null ) },
    ...collections.map( ( c ) => ( { label: `Move to ${c.name}`, icon: "collection" as IconName, run: () => st().moveToCollection( uids, c.id ) } ) ),
  ];
  const collectionMenu = ( e: React.MouseEvent, c: Collection | null ) => {
    e.preventDefault();
    e.stopPropagation();
    const list: MenuItem[] = [
      { label: "New collection", icon: "plus", run: () => setRenaming( st().newCollection( c?.id ?? null ) ) },
    ];
    if ( c )
      list.push(
        { label: "Rename",              keys:  "Double-click", run: () => setRenaming( c.id ) },
        { label: "Select what's in it", run:   () => st().setSelection( itemsUnder( c.id ) ) },
        { label: "Make active",         title: "New things go into the active collection", run: () => st().setActiveCollection( c.id ) },
        { sep:   true,                  label: "" },
        { label: "Delete collection",   icon:  "trash", title: "What's in it moves up a level", run: () => st().deleteCollection( c.id ) },
      );
    setMenu( { at: at( e ), items: list } );
  };
  const itemMenu = ( e: React.MouseEvent, it: Item ) => {
    e.preventDefault();
    e.stopPropagation();
    if ( !sel.has( it.sel.uid ) ) st().setSelection( [it.sel] );
    const uids = sel.has( it.sel.uid ) ? selection.map( ( s ) => s.uid ) : [it.sel.uid];
    setMenu( {
      at: at( e ),
      items: [
        { label: "Rename",    keys: "Double-click", run: () => setRenaming( it.sel.uid ) },
        { label: "Frame",     keys: "F",            run: () => getEngine()?.nav.frameSelection() },
        { label: "Duplicate", keys: "Shift D",      run: () => st().duplicateSelected() },
        { label: "Copy",      keys: "Ctrl C",       run: () => window.dispatchEvent( new KeyboardEvent( "keydown", { key: "c", ctrlKey: true } ) ) },
        { label: "Delete", icon: "trash", keys: "X", run: () => st().removeSelected() },
        { label: locked[it.sel.uid] ? "Unlock" : "Lock", icon: locked[it.sel.uid] ? "unlock" : "lock", run: () => st().setLocked( uids, !locked[it.sel.uid] ) },
        { sep:   true, label: "" },
        ...moveItems( uids ),
      ],
    } );
  };

  // ---------------------------------------------------------------- rows
  const nameField = ( current: string, done: ( v: string ) => void ) => (
    <input
      className="ol-rename"
      autoFocus
      defaultValue={current}
      onFocus={( e ) => e.target.select()}
      onPointerDown={( e ) => e.stopPropagation()}
      onBlur={( e ) => {
        done( e.target.value );
        setRenaming( null );
      }}
      onKeyDown={( e ) => {
        if ( e.key === "Enter" ) ( e.target as HTMLInputElement ).blur();
        if ( e.key === "Escape" ) setRenaming( null );
        e.stopPropagation();
      }}
    />
  );

  const renderItem = ( it: Item, depth: number ) => (
    <div
      key={it.sel.uid}
      className={`ol-row ${active === it.sel.uid ? "active" : sel.has( it.sel.uid ) ? "sel" : ""}`}
      style={{ ["--indent" as string]: `${depth * 16}px` }}
      onPointerDown={( e ) => startItemDrag( e, it )}
      onClick={( e ) => click( it.sel, e )}
      onDoubleClick={() => setRenaming( it.sel.uid )}
      onContextMenu={( e ) => itemMenu( e, it )}
    >
      <span className="chev" />
      {it.dot ? <span className="dot" style={{ background: it.dot }} /> : <span className="ico">{assets ? <BlIcon name={it.bl ?? "outliner_ob_mesh"} size={14} /> : <Icon name={it.icon!} size={14} />}</span>}
      {renaming === it.sel.uid ? nameField( it.name, ( v ) => v.trim() && v !== it.name && st().renameItem( it.sel, v ) ) : <span className="name">{it.name}</span>}
      {assets && it.bl && <span className="ol-data"><BlIcon name={it.bl === "outliner_ob_curve" ? "outliner_data_curve" : "outliner_data_mesh"} size={14} /></span>}
      {assets && <span className="spacer" />}
      { assets && (
        <span
          className={`ol-toggle${hidden[it.sel.uid] ? " on" : ""}`}
          title={hidden[it.sel.uid] ? "Show in Viewport" : "Hide in Viewport"}
          onPointerDown={( e ) => e.stopPropagation()}
          onDoubleClick={( e ) => e.stopPropagation()}
          onClick={( e ) => {
            e.stopPropagation();
            const h = { ...hidden };
            if ( h[it.sel.uid] ) delete h[it.sel.uid];
            else h[it.sel.uid] = true;
            useEditor.setState( { hiddenInView: h } );
          }}
        >
          <BlIcon name={hidden[it.sel.uid] ? "hide_on" : "hide_off"} size={14} />
        </span>
      ) }
      { ( !assets || locked[it.sel.uid] ) && <span
        className={`ol-toggle${locked[it.sel.uid] ? " on" : ""}`}
        title={locked[it.sel.uid] ? ( assets ? "Make Selectable" : "Unlock" ) : assets ? "Disable Selection" : "Lock"}
        onPointerDown={( e ) => e.stopPropagation()}
        onDoubleClick={( e ) => e.stopPropagation()}
        onClick={( e ) => {
          e.stopPropagation();
          // ( the whole selection when the row is in it, as Blender's toggles do )
          st().setLocked( sel.has( it.sel.uid ) ? selection.map( ( s ) => s.uid ) : [it.sel.uid], !locked[it.sel.uid] );
        }}
      >
        {assets ? <BlIcon name={locked[it.sel.uid] ? "restrict_select_on" : "restrict_select_off"} size={13} /> : <Icon name={locked[it.sel.uid] ? "lock" : "unlock"} size={13} />}
      </span> }
    </div>
  );

  const renderCollection = ( c: Collection, depth: number ): React.ReactNode => {
    if ( ql && !hasMatch( c.id ) ) return null;
    const shut = closed.has( c.id ) && !ql;
    return (
      <div key={c.id} style={{ display: "contents" }}>
        <div
          className={`ol-row coll ${activeCollection === c.id ? "coll-active" : ""} ${dropOn === c.id ? "drop" : ""}`}
          data-drop={c.id}
          style={{ ["--indent" as string]: `${depth * 16}px` }}
          onPointerDown={( e ) => startCollectionDrag( e, c )}
          onClick={() => st().setActiveCollection( activeCollection === c.id ? null : c.id )}
          onDoubleClick={() => setRenaming( c.id )}
          onContextMenu={( e ) => collectionMenu( e, c )}
        >
          <span
            className="chev"
            onPointerDown={( e ) => e.stopPropagation()}
            onClick={( e ) => {
              e.stopPropagation();
              if ( closed.has( c.id ) ) closed.delete( c.id );
              else closed.add( c.id );
              bump( ( n ) => n + 1 );
            }}
          >
            <Icon name={shut ? "chevronRight" : "chevronDown"} size={12} />
          </span>
          <span className="ico"><Icon name="collection" size={14} /></span>
          {renaming === c.id ? nameField( c.name, ( v ) => st().renameCollection( c.id, v ) ) : <span className="name">{c.name}</span>}
          <span className="count">{countIn( c.id )}</span>
        </div>
        { !shut && (
          <>
            {childCols( c.id ).map( ( k ) => renderCollection( k, depth + 1 ) )}
            {childItems( c.id ).filter( matches ).map( ( it ) => renderItem( it, depth + 1 ) )}
          </>
        ) }
      </div>
    );
  };

  return (
    <>
      <div className="area-header">
        <span className="editor-icon" title="Outliner"><Icon name="outliner" /></span>
        <label className="search" style={{ flex: 1 }}>
          <Icon name="search" size={13} />
          <input placeholder="Search" value={q} onChange={( e ) => setQ( e.target.value )} />
        </label>
        <button
          className="btn ghost"
          title={`New collection${activeCollection ? " (inside the active one)" : ""}`}
          onClick={() => setRenaming( st().newCollection( activeCollection ) )}
        >
          <Icon name="collection" size={14} />
          <Icon name="plus" size={10} />
        </button>
      </div>
      <div className="tree" onContextMenu={( e ) => collectionMenu( e, null )} onClick={( e ) => e.target === e.currentTarget && st().setSelection( [] )}>
        <div
          className={`ol-row coll ${activeCollection === null ? "coll-active" : ""} ${dropOn === "root" ? "drop" : ""}`}
          data-drop="root"
          style={{ ["--indent" as string]: "0px" }}
          onClick={() => st().setActiveCollection( null )}
          onContextMenu={( e ) => collectionMenu( e, null )}
          title="The whole map: new things go here unless a collection is active"
        >
          <span className="chev" />
          <span className="ico">{assets ? <BlIcon name="outliner_collection" size={14} /> : <Icon name="mountain" size={14} />}</span>
          <span className="name">{assets ? "Scene Collection" : <RichText text={mapName} />}</span>
          {!assets && <span className="count">{items.length}</span>}
        </div>
        {childCols( null ).map( ( c ) => renderCollection( c, 1 ) )}
        {childItems( null ).filter( matches ).map( ( it ) => renderItem( it, 1 ) )}
        {items.length === 0 && collections.length === 0 && <div className="empty">Nothing placed yet. Right-click to make a collection.</div>}
      </div>
      <div ref={ghost} className="ol-ghost" />
      {menu && <PopupMenu anchor={menu.at} items={menu.items} onClose={() => setMenu( null )} />}
    </>
  );
}
