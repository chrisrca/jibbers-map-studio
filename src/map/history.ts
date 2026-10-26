// Undo/redo stack. Entries hold their own undo/redo closures ( object edits snapshot immutable
// arrays; terrain edits snapshot touched height rects before and after the stroke ).

export interface HistoryEntry {
  label: string;
  undo(): void;
  redo(): void;
  // memory the entry holds on to ( snapshots ), so old steps can be dropped before memory runs out
  bytes?: number;
}

type Listener = () => void;

class History {
  private past:   HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private listeners = new Set<Listener>();
  limit  = 300;
  // total snapshot memory kept for undo; the oldest steps go first when it's over ( terrain strokes on detailed
  // ground hold megabytes each )
  budget = 1.5e9;

  push( e: HistoryEntry ) {
    this.past.push( e );
    this.future = [];
    this.trim();
    this.emit();
  }

  /**
   * Memory held by all the steps.
  **/
  get bytes() {
    let b = 0;
    for ( const e of this.past   ) b += e.bytes ?? 0;
    for ( const e of this.future ) b += e.bytes ?? 0;
    return b;
  }

  private trim() {
    while ( this.past.length > this.limit ) this.past.shift();
    let total = this.bytes;
    while ( total > this.budget && this.past.length > 1 ) total -= this.past.shift()!.bytes ?? 0;
  }

  /**
   * The steps, oldest first; `current` = how many of them are done ( the rest can be redone ).
  **/
  list(): { labels: string[]; current: number } {
    return { labels: [...this.past.map( ( e ) => e.label ), ...[...this.future].reverse().map( ( e ) => e.label )], current: this.past.length };
  }

  undo() {
    const e = this.past.pop();
    if ( !e ) return null;
    e.undo();
    this.future.push( e );
    this.emit();
    return e.label;
  }

  redo() {
    const e = this.future.pop();
    if ( !e ) return null;
    e.redo();
    this.past.push( e );
    this.emit();
    return e.label;
  }

  clear() {
    this.past   = [];
    this.future = [];
    this.emit();
  }

  /**
   * The steps as they are, set aside ( another document's take their place with `restore` ).
  **/
  take(): { past: HistoryEntry[]; future: HistoryEntry[] } {
    const s     = { past: this.past, future: this.future };
    this.past   = [];
    this.future = [];
    this.emit();
    return s;
  }
  restore( s: { past: HistoryEntry[]; future: HistoryEntry[] } ) {
    this.past   = s.past;
    this.future = s.future;
    this.emit();
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get nextUndo() {
    return this.past[this.past.length - 1]?.label;
  }
  get nextRedo() {
    return this.future[this.future.length - 1]?.label;
  }

  subscribe( l: Listener ) {
    this.listeners.add( l );
    return () => this.listeners.delete( l );
  }
  private emit() {
    this.listeners.forEach( ( l ) => l() );
  }
}

export const history = new History();
