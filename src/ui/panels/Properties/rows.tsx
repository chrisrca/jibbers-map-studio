// Rows the Properties panels share: a labelled row, and the name field ( Blender's ).

import { uniqueName } from "../../../map/names";
import { useEditor } from "../../../map/store";
import { BlIcon } from "../../blender/BlIcon";

/**
 * Blender's name field at the top of the Properties: the object's icon, and its name to change.
**/
export function NameRow( { uid, name }: { uid: string; name: string } ) {
  return (
    <div className="name-row">
      <span className="ico"><BlIcon name="object_data" size={14} /></span>
      <input
        className="txt"
        defaultValue={name}
        onKeyDown={( e ) => e.key === "Enter" && ( e.target as HTMLInputElement ).blur()}
        onBlur={( e ) => {
          const v  = e.target.value.trim();
          const st = useEditor.getState();
          if ( v && v !== name ) st.renameItem( { kind: "custom", uid }, uniqueName( st, v, uid ) );
          else e.target.value = name;
        }}
      />
    </div>
  );
}

export function Row( { label, children }: { label: string; children: React.ReactNode } ) {
  return (
    <>
      <label style={{ textTransform: "capitalize" }}>{label}</label>
      <div>{children}</div>
    </>
  );
}
