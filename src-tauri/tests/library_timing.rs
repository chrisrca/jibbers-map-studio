//! How long a big project library takes to read and write ( run by hand: `cargo test --release --test library_timing
//! -- --ignored --nocapture`, LIBRARY set to a library.jbrmap ).

#[test]
#[ignore]
fn big_library_read_and_write() {
    let Some(path) = std::env::var_os("LIBRARY") else { return };
    let t = std::time::Instant::now();
    let lib = jibbers_studio_lib::jbrmap::load(&path).unwrap();
    println!("read {:?}: {} meshes, {} textures", t.elapsed(), lib.mesh_library.len(), lib.texture_library.len());
    let out = std::env::temp_dir().join("library-timing.jbrmap");
    let t = std::time::Instant::now();
    jibbers_studio_lib::jbrmap::save(&lib, &out).unwrap();
    println!("written {:?}", t.elapsed());
    let _ = std::fs::remove_file(out);
}
