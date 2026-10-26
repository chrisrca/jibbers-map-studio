// A question with a few answers, asked from anywhere and answered in a dialog ( ui/dialogs/Ask.tsx shows it ). Resolves with the
// id of the answer picked ( null: dismissed ), and the text typed when the question has a text field.

import { create } from "zustand";

export interface Answer {
  id:        string;
  label:     string;
  primary?:  boolean;
  // this answer goes with the text field ( disabled while it's empty )
  usesText?: boolean;
}

export interface Question {
  title:   string;
  answers: Answer[];
  // a text field above the answers, starting with this
  text?:   { label: string; value: string };
}

interface AskState {
  question: Question | null;
  resolve:  ( ( a: { id: string; text: string } | null ) => void ) | null;
}

export const useAsk = create<AskState>( () => ( { question: null, resolve: null } ) );

export function ask( question: Question ): Promise<{ id: string; text: string } | null> {
  // ( one at a time: a question already up is dismissed )
  useAsk.getState().resolve?.( null );
  return new Promise( ( resolve ) => useAsk.setState( { question, resolve } ) );
}

export function answer( a: { id: string; text: string } | null ) {
  const { resolve } = useAsk.getState();
  useAsk.setState( { question: null, resolve: null } );
  resolve?.( a );
}
