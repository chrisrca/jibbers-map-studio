//! How long the studio takes to start, step by step: `<studio data>\boot.log`, written afresh each start (milliseconds
//! since the program started, then what was done by then). The page adds its own steps (`boot_mark`).

use std::io::Write;
use std::sync::OnceLock;
use std::time::Instant;

static START: OnceLock<Instant> = OnceLock::new();

/// The clock starts (at the program's start); the log begins again.
pub fn start() {
    START.get_or_init(Instant::now);
    if let Ok(d) = crate::library::userassets::data_dir() {
        let _ = std::fs::create_dir_all(&d);
        let _ = std::fs::write(d.join("boot.log"), "");
    }
    mark("program started");
}

/// A step done: written with the time since the start.
pub fn mark(what: &str) {
    let ms = START.get().map_or(0, |s| s.elapsed().as_millis());
    if let Ok(d) = crate::library::userassets::data_dir() {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(d.join("boot.log")) {
            let _ = writeln!(f, "{ms:>7} ms  {what}");
        }
    }
}
