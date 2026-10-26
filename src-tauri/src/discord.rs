//! Discord Rich Presence: "Playing Jibbers Map Studio" with what's being edited, through the Discord app running on
//! this PC (nothing when it isn't). One thread owns the connection; the UI only says what to show.

use std::sync::{Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

const APP_ID: &str = "1561572088219701390";

/// What to show: (details, state), or None for nothing.
#[derive(Clone, PartialEq)]
struct Shown {
    details: String,
    state: String,
}

struct Wanted {
    shown: Option<Shown>,
    /// bumped on every change, so the thread knows it has something new
    gen: u64,
}

static WANTED: Mutex<Wanted> = Mutex::new(Wanted { shown: None, gen: 0 });
static CHANGED: Condvar = Condvar::new();
static STARTED: std::sync::Once = std::sync::Once::new();

#[tauri::command]
pub fn discord_presence(details: Option<String>, state: Option<String>) {
    // (self-test runs stay out of the status)
    if std::env::var_os("STUDIO_SELFTEST").is_some() {
        return;
    }
    let shown = details.map(|details| Shown { details, state: state.unwrap_or_default() });
    {
        let mut w = WANTED.lock().unwrap();
        if w.shown == shown {
            return;
        }
        w.shown = shown;
        w.gen += 1;
    }
    CHANGED.notify_all();
    STARTED.call_once(|| {
        std::thread::Builder::new().name("discord".into()).spawn(run).ok();
    });
}

fn run() {
    let start = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let mut client: Option<DiscordIpcClient> = None;
    let mut sent_gen = 0;
    loop {
        let (shown, gen) = {
            let mut w = WANTED.lock().unwrap();
            // asleep until something changes; a while between tries when Discord isn't there (or went away)
            while w.gen == sent_gen {
                let wait = if client.is_none() && w.shown.is_some() { Duration::from_secs(20) } else { Duration::from_secs(3600) };
                let (g, timeout) = CHANGED.wait_timeout(w, wait).unwrap();
                w = g;
                if timeout.timed_out() && client.is_none() && w.shown.is_some() {
                    break;
                }
            }
            (w.shown.clone(), w.gen)
        };
        match shown {
            None => {
                if let Some(mut c) = client.take() {
                    let _ = c.clear_activity();
                    let _ = c.close();
                }
                sent_gen = gen;
            }
            Some(s) => {
                if client.is_none() {
                    let mut c = DiscordIpcClient::new(APP_ID);
                    if c.connect().is_ok() {
                        client = Some(c);
                    }
                }
                let Some(c) = client.as_mut() else {
                    // (tried again later)
                    sent_gen = gen;
                    continue;
                };
                let mut a = activity::Activity::new()
                    .details(s.details.as_str())
                    .timestamps(activity::Timestamps::new().start(start))
                    .assets(activity::Assets::new().large_image("icon").large_text("Jibbers Map Studio"));
                if !s.state.is_empty() {
                    a = a.state(s.state.as_str());
                }
                // (its reply read, so replies don't pile up; a failure = Discord closed: connected again next time)
                if c.set_activity(a).and_then(|_| c.recv().map(|_| ())).is_err() {
                    let _ = c.close();
                    client = None;
                }
                sent_gen = gen;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Talks to the Discord app running on this PC: the status set for a few seconds, Discord's reply printed.
    #[test]
    #[ignore]
    fn shows_in_discord() {
        let mut c = DiscordIpcClient::new(APP_ID);
        c.connect().expect("Discord app not reachable");
        let a = activity::Activity::new()
            .details("Editing a new map")
            .state("Terrain Mode")
            .assets(activity::Assets::new().large_image("icon").large_text("Jibbers Map Studio"));
        c.set_activity(a).unwrap();
        let (op, reply) = c.recv().unwrap();
        println!("reply {op}: {reply}");
        assert_ne!(reply["evt"], "ERROR", "Discord refused it");
        std::thread::sleep(Duration::from_secs(4));
        c.clear_activity().unwrap();
        let _ = c.recv();
        c.close().unwrap();
    }
}
