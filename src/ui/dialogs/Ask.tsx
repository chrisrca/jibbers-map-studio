// The dialog for app/ask.ts's questions.

import { useEffect, useState } from "react";
import { answer, useAsk } from "../../app/ask";

export function AskDialog() {
  const q               = useAsk( ( s ) => s.question );
  const [text, setText] = useState( "" );
  useEffect( () => setText( q?.text?.value ?? "" ), [q] );
  if ( !q ) return null;
  const pick = ( id: string ) => answer( { id, text: text.trim() } );
  return (
    <div className="modal-back" onMouseDown={( e ) => e.target === e.currentTarget && answer( null )}>
      <div
        className="modal"
        style={{ width: "min(460px, 94vw)" }}
        onKeyDown={( e ) => {
          if ( e.key === "Escape" ) answer( null );
        }}
      >
        <h2>{q.title}</h2>
        { q.text && (
          <label className="ask-field">
            <span>{q.text.label}</span>
            <input className="txt" autoFocus value={text} onChange={( e ) => setText( e.target.value )} />
          </label>
        ) }
        <div className="actions">
          <button className="btn" onClick={() => answer( null )}>Cancel</button>
          { q.answers.map( ( a ) => (
            <button key={a.id} className={`btn${a.primary ? " primary" : ""}`} disabled={a.usesText && !text.trim()} onClick={() => pick( a.id )}>
              {a.label}
            </button>
          ) ) }
        </div>
      </div>
    </div>
  );
}
