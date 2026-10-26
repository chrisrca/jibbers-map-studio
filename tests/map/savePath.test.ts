import { describe, expect, it } from "vitest";
import { projectPath } from "../../src/map/savePath";

describe( "saving as", () => {
  it( "never puts a project inside another one", () => {
    expect( projectPath( "C:\\Users\\me\\Documents\\Jibbers Maps\\My Map.jbrproj\\test trails" ) ).toBe( "C:\\Users\\me\\Documents\\Jibbers Maps\\test trails.jbrproj" );
    expect( projectPath( "C:\\Maps\\A.jbrproj\\B.jbrproj\\C.jbrproj" )                           ).toBe( "C:\\Maps\\C.jbrproj"                                         );
    expect( projectPath( "C:\\Maps\\New one" )      ).toBe( "C:\\Maps\\New one.jbrproj" );
    expect( projectPath( "C:\\Maps\\Kept.jbrproj" ) ).toBe( "C:\\Maps\\Kept.jbrproj"    );
  } );
} );
