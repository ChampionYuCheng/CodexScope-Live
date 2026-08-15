use std::env;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub root: PathBuf,
    pub sessions: PathBuf,
    pub generator: Option<PathBuf>,
    pub port: u16,
    pub interval_ms: u64,
}

impl ServerConfig {
    pub fn from_args<I, S>(args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut root = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let mut sessions = default_sessions_path();
        let mut generator = None;
        let mut port = 4173;
        let mut interval_ms = 1000;
        let mut iter = args.into_iter().skip(1).map(|arg| arg.as_ref().to_owned());

        while let Some(arg) = iter.next() {
            let mut value = || iter.next();
            match arg.as_str() {
                "--root" => {
                    if let Some(value) = value() {
                        root = PathBuf::from(value);
                    }
                }
                "--sessions" => {
                    if let Some(value) = value() {
                        sessions = PathBuf::from(value);
                    }
                }
                "--generator" => {
                    if let Some(value) = value() {
                        generator = Some(PathBuf::from(value));
                    }
                }
                "--port" => {
                    if let Some(value) = value() {
                        if let Ok(parsed) = value.parse::<u16>() {
                            port = parsed;
                        }
                    }
                }
                "--interval-ms" => {
                    if let Some(value) = value() {
                        if let Ok(parsed) = value.parse::<u64>() {
                            interval_ms = parsed.max(100);
                        }
                    }
                }
                _ => {}
            }
        }

        Self {
            root,
            sessions,
            generator,
            port,
            interval_ms,
        }
    }
}

fn default_sessions_path() -> PathBuf {
    if let Some(profile) = env::var_os("USERPROFILE") {
        return PathBuf::from(profile).join(".codex").join("sessions");
    }
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home).join(".codex").join("sessions");
    }
    PathBuf::from(".codex").join("sessions")
}

pub fn safe_relative_path(value: &str) -> Option<PathBuf> {
    let normalized = value.replace('\\', "/");
    let path = Path::new(&normalized);
    if normalized.is_empty() || path.is_absolute() {
        return None;
    }

    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    (!safe.as_os_str().is_empty()).then_some(safe)
}

pub fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

pub fn session_signature(root: &Path) -> io::Result<String> {
    let mut files = Vec::new();
    collect_session_files(root, &mut files)?;
    files.sort();

    let mut total_size = 0u64;
    let mut latest_modified = 0u128;
    for path in &files {
        let metadata = fs::metadata(path)?;
        total_size = total_size.saturating_add(metadata.len());
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        latest_modified = latest_modified.max(modified);
    }

    Ok(format!(
        "files={};bytes={};latest={};paths={:?}",
        files.len(),
        total_size,
        latest_modified,
        files
    ))
}

fn collect_session_files(root: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_session_files(&path, files)?;
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
    Ok(())
}

pub fn data_event(updated_at: SystemTime) -> String {
    let millis = updated_at
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("event: data\ndata: {{\"updatedAt\":{millis}}}\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[test]
    fn parses_root_and_port_arguments() {
        let config = ServerConfig::from_args([
            "codexscope-live",
            "--root",
            "D:/CodexScope",
            "--port",
            "4321",
            "--interval-ms",
            "750",
        ]);
        assert_eq!(config.root, PathBuf::from("D:/CodexScope"));
        assert_eq!(config.port, 4321);
        assert_eq!(config.interval_ms, 750);
    }

    #[test]
    fn rejects_paths_that_escape_the_dashboard_root() {
        assert!(safe_relative_path("index.html").is_some());
        assert!(safe_relative_path("../secret.txt").is_none());
        assert!(safe_relative_path("nested/../../secret.txt").is_none());
    }

    #[test]
    fn detects_json_and_javascript_content_types() {
        assert_eq!(
            content_type(Path::new("data.js")),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(
            content_type(Path::new("status.json")),
            "application/json; charset=utf-8"
        );
    }

    #[test]
    fn file_signature_changes_when_a_session_file_changes() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codexscope-live-{unique}"));
        fs::create_dir_all(&root).unwrap();
        let session = root.join("session.jsonl");
        fs::write(&session, b"first\n").unwrap();
        let before = session_signature(&root).unwrap();
        fs::write(&session, b"first\nsecond\n").unwrap();
        let after = session_signature(&root).unwrap();
        let _ = fs::remove_dir_all(&root);
        assert_ne!(before, after);
    }

    #[test]
    fn builds_a_data_sse_event() {
        let event = data_event(UNIX_EPOCH);
        assert!(event.starts_with("event: data\n"));
        assert!(event.contains("data: {\"updatedAt\":0}"));
        assert!(event.ends_with("\n\n"));
    }
}
