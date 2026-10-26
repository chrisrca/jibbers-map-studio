fn main() {
    // (a new icon is built into the program: by default only the config file's changes are)
    println!("cargo:rerun-if-changed=icons");
    link();
    tauri_build::build()
}

/// The studio's link into the game (gamelink/: a DLL of its own, loaded into Jibbers.exe), built here for game/mod.rs
/// to carry inside the studio (in a target folder of its own: this build holds the workspace's).
fn link() {
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let root = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let target = out.join("gamelink");
    let status = std::process::Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .args(["build", "--release", "-p", "gamelink", "--target-dir"])
        .arg(&target)
        .current_dir(&root)
        .env_remove("CARGO_TARGET_DIR")
        .env_remove("RUSTFLAGS")
        .env_remove("CARGO_ENCODED_RUSTFLAGS")
        .status()
        .expect("run cargo for the game link");
    assert!(status.success(), "building the game link (gamelink/) failed");
    println!("cargo:rustc-env=JIBBERS_LINK_DLL={}", target.join("release").join("jibbers_link.dll").display());
    println!("cargo:rerun-if-changed=gamelink/src");
    println!("cargo:rerun-if-changed=gamelink/Cargo.toml");
}
