//! The network: OpenStreetMap's Overpass (several servers tried), and plain fetches the page can't make itself.

use tauri::ipc::Response;
use super::{err, CmdResult};

/// An OpenStreetMap Overpass query (ski runs and lifts), sent from here rather than the web view so it names the app:
/// the public servers turn away requests that look like a browser but aren't one. The two main servers are asked at
/// once and the first good answer wins; then the others, one at a time. The answer's JSON as text.
#[tauri::command]
pub async fn overpass_query(query: String) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || overpass(&query)).await.map_err(|e| e.to_string())?.map_err(err)
}

pub const OVERPASS: [&str; 4] = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

pub fn overpass_ask(url: &str, query: &str) -> anyhow::Result<String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(8))
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("JibbersMapStudio/", env!("CARGO_PKG_VERSION"), " (map editor for the game Jibbers)"))
        .build();
    let r = agent.post(url).send_form(&[("data", query)]);
    let host = url.split('/').nth(2).unwrap_or(url);
    match r {
        Ok(r) => Ok(r.into_string()?),
        Err(ureq::Error::Status(code, _)) => anyhow::bail!("{host} answered {code}"),
        Err(e) => anyhow::bail!("{host}: {e}"),
    }
}

pub fn overpass(query: &str) -> anyhow::Result<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    for url in &OVERPASS[..2] {
        let (tx, url, q) = (tx.clone(), *url, query.to_string());
        std::thread::spawn(move || {
            let _ = tx.send(overpass_ask(url, &q));
        });
    }
    drop(tx);
    let mut errors = Vec::new();
    for r in rx {
        match r {
            Ok(body) => return Ok(body),
            Err(e) => errors.push(format!("{e:#}")),
        }
    }
    for url in &OVERPASS[2..] {
        match overpass_ask(url, query) {
            Ok(body) => return Ok(body),
            Err(e) => errors.push(format!("{e:#}")),
        }
    }
    anyhow::bail!("OpenStreetMap servers are busy or unreachable ({})", errors.join("; "))
}

/// Fetches a web address (optionally just `range`, an HTTP Range like "bytes=0-1023") for the elevation sources whose
/// servers don't let a web page read them (no CORS: Copernicus, NRCan, ...). The answer as raw bytes: status (u16),
/// the headers as JSON (u32 length first), then the body (little-endian).
#[tauri::command]
pub async fn http_fetch(url: String, range: Option<String>) -> CmdResult<Response> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(120))
            .user_agent(concat!("JibbersMapStudio/", env!("CARGO_PKG_VERSION"), " (map editor for the game Jibbers)"))
            .build();
        let mut req = agent.get(&url);
        if let Some(r) = &range {
            req = req.set("Range", r);
        }
        let resp = match req.call() {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(e) => anyhow::bail!("{}: {e}", url.split('/').nth(2).unwrap_or(&url)),
        };
        let status = resp.status();
        let headers: serde_json::Map<String, serde_json::Value> =
            resp.headers_names().into_iter().filter_map(|n| resp.header(&n).map(|v| (n.to_ascii_lowercase(), serde_json::Value::String(v.to_string())))).collect();
        let head = serde_json::to_vec(&headers)?;
        let mut body = Vec::new();
        std::io::Read::read_to_end(&mut resp.into_reader(), &mut body)?;
        let mut out = Vec::with_capacity(6 + head.len() + body.len());
        out.extend_from_slice(&status.to_le_bytes());
        out.extend_from_slice(&(head.len() as u32).to_le_bytes());
        out.extend_from_slice(&head);
        out.extend_from_slice(&body);
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
    .map(Response::new)
    .map_err(err)
}
