import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { plainText, RichText } from "../../../src/ui/widgets/RichText";

describe( "rich text names", () => {
  it( "shows the game's colour tags as colour", () => {
    const html = renderToStaticMarkup( <RichText text="Joyosa Park <color=orange>Plus</color>" /> );
    expect( html ).toBe( 'Joyosa Park <span style="color:orange">Plus</span>' );
  } );
  it( "nests and closes tags, and leaves out ones it doesn't know", () => {
    const html = renderToStaticMarkup( <RichText text="<b>Big <color=#ff0000>red</color></b> <size=20>park</size>" /> );
    expect( html ).toBe( '<span style="font-weight:700">Big </span><span style="font-weight:700;color:#ff0000">red</span> park' );
  } );
  it( "gives the words alone", () => expect( plainText( "Joyosa Park <color=orange>Plus</color>" ) ).toBe( "Joyosa Park Plus" ) );
} );
