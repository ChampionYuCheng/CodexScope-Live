use std::env;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SERVER_PROTOCOL_VERSION: u8 = 2;

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub root: PathBuf,
    pub sessions: PathBuf,
    pub data_dir: PathBuf,
    pub generator: Option<PathBuf>,
    pub port: u16,
    pub interval_ms: u64,
    pub open_browser: bool,
}

impl ServerConfig {
    pub fn from_args<I, S>(args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let working_dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let executable = env::current_exe().ok();
        let mut root = default_dashboard_root(&working_dir, executable.as_deref());
        let mut sessions = default_sessions_path();
        let mut data_dir = default_data_dir();
        let mut generator = None;
        let mut port = 48173;
        let mut interval_ms = 1000;
        let mut open_browser = true;
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
                "--data-dir" => {
                    if let Some(value) = value() {
                        data_dir = PathBuf::from(value);
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
                "--no-open" => open_browser = false,
                _ => {}
            }
        }

        Self {
            root,
            sessions,
            data_dir,
            generator,
            port,
            interval_ms,
            open_browser,
        }
    }
}

pub fn default_dashboard_root(working_dir: &Path, executable: Option<&Path>) -> PathBuf {
    executable
        .and_then(Path::parent)
        .filter(|directory| directory.join("index.html").is_file())
        .unwrap_or(working_dir)
        .to_path_buf()
}

pub fn dashboard_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/")
}

pub fn health_response(configuration_signature: &str) -> String {
    format!(
        "{{\"ok\":true,\"mode\":\"local\",\"protocol\":{SERVER_PROTOCOL_VERSION},\"config\":\"{configuration_signature}\"}}"
    )
}

pub fn is_compatible_health_response(response: &[u8], expected_signature: &str) -> bool {
    let expected = health_response(expected_signature);
    response
        .windows(expected.len())
        .any(|window| window == expected.as_bytes())
}

pub fn configuration_signature(root: &Path, sessions: &Path, data_dir: &Path) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for value in [root, sessions, data_dir] {
        for byte in value.to_string_lossy().replace('\\', "/").bytes() {
            hash ^= u64::from(byte.to_ascii_lowercase());
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

pub fn private_route<'a>(target: &'a str, access_token: &str) -> Option<&'a str> {
    let target = target.strip_prefix('/')?;
    let remainder = target.strip_prefix(access_token)?;
    if remainder.is_empty() || remainder == "/" {
        return Some("index.html");
    }
    remainder.strip_prefix('/')
}

pub fn is_shutdown_request(method: &str, relative: &str) -> bool {
    method == "POST" && relative == "shutdown"
}

pub fn is_public_asset(relative: &Path) -> bool {
    let normalized = relative.to_string_lossy().replace('\\', "/");
    matches!(
        normalized.as_str(),
        "index.html" | "styles.css" | "app.js" | "live.js" | "theme.js" | "data.sample.js"
    ) || normalized.starts_with("assets/")
}

pub fn security_headers() -> &'static str {
    "Cross-Origin-Resource-Policy: same-origin\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.frankfurter.dev; object-src 'none'; base-uri 'none'; frame-ancestors 'none'\r\nReferrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\n"
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenerationStatus {
    Pending,
    Ok,
    Error,
}

pub fn generation_status_json(status: GenerationStatus) -> &'static str {
    match status {
        GenerationStatus::Pending => "{\"state\":\"pending\"}",
        GenerationStatus::Ok => "{\"state\":\"ok\"}",
        GenerationStatus::Error => "{\"state\":\"error\"}",
    }
}

pub fn generation_error_event() -> String {
    "event: generation-error\ndata: {}\n\n".to_owned()
}

pub fn generate_access_token() -> io::Result<String> {
    let mut bytes = [0u8; 24];
    fill_secure_random(&mut bytes)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
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

fn default_data_dir() -> PathBuf {
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local_app_data).join("CodexScope-Live");
    }
    if let Some(xdg_data_home) = env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(xdg_data_home).join("CodexScope-Live");
    }
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("CodexScope-Live");
    }
    env::temp_dir().join("CodexScope-Live")
}

#[cfg(windows)]
fn fill_secure_random(bytes: &mut [u8]) -> io::Result<()> {
    use std::ffi::c_void;

    #[link(name = "bcrypt")]
    extern "system" {
        fn BCryptGenRandom(
            algorithm: *mut c_void,
            buffer: *mut u8,
            buffer_length: u32,
            flags: u32,
        ) -> i32;
    }

    const BCRYPT_USE_SYSTEM_PREFERRED_RNG: u32 = 0x00000002;
    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            bytes.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status == 0 {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::Other,
            format!("Windows secure random generation failed with status {status}"),
        ))
    }
}

#[cfg(unix)]
fn fill_secure_random(bytes: &mut [u8]) -> io::Result<()> {
    std::io::Read::read_exact(&mut fs::File::open("/dev/urandom")?, bytes)
}

#[cfg(not(any(windows, unix)))]
fn fill_secure_random(_bytes: &mut [u8]) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "secure random generation is unsupported on this platform",
    ))
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
            "--data-dir",
            "D:/CodexScope-Data",
            "--port",
            "4321",
            "--interval-ms",
            "750",
        ]);
        assert_eq!(config.root, PathBuf::from("D:/CodexScope"));
        assert_eq!(config.data_dir, PathBuf::from("D:/CodexScope-Data"));
        assert_eq!(config.port, 4321);
        assert_eq!(config.interval_ms, 750);
        assert!(config.open_browser);
    }

    #[test]
    fn no_open_argument_disables_browser_launch() {
        let config = ServerConfig::from_args(["codexscope-live", "--no-open"]);
        assert!(!config.open_browser);
    }

    #[test]
    fn portable_root_prefers_executable_directory_with_dashboard() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_nanos();
        let sandbox = std::env::temp_dir().join(format!("codexscope-root-{unique}"));
        let executable_dir = sandbox.join("portable");
        let working_dir = sandbox.join("working");
        fs::create_dir_all(&executable_dir).unwrap();
        fs::create_dir_all(&working_dir).unwrap();
        fs::write(executable_dir.join("index.html"), b"dashboard").unwrap();
        let executable = executable_dir.join("CodexScope-Live.exe");

        let root = default_dashboard_root(&working_dir, Some(&executable));

        let _ = fs::remove_dir_all(&sandbox);
        assert_eq!(root, executable_dir);
    }

    #[test]
    fn development_root_falls_back_to_working_directory() {
        let working_dir = PathBuf::from("D:/CodexScope-Live");
        let executable =
            PathBuf::from("D:/CodexScope-Live/live-server/target/debug/codexscope-live.exe");

        let root = default_dashboard_root(&working_dir, Some(&executable));

        assert_eq!(root, working_dir);
    }

    #[test]
    fn builds_loopback_dashboard_url() {
        assert_eq!(dashboard_url(48173), "http://127.0.0.1:48173/");
    }

    #[test]
    fn reuses_only_a_compatible_server_instance() {
        let body = health_response("abc123");
        let response = format!("HTTP/1.1 200 OK\r\n\r\n{body}");

        assert!(is_compatible_health_response(response.as_bytes(), "abc123"));
        assert!(!is_compatible_health_response(
            response.as_bytes(),
            "different"
        ));
        assert!(!is_compatible_health_response(
            b"HTTP/1.1 200 OK\r\n\r\n{\"ok\":true,\"mode\":\"local\"}",
            "abc123"
        ));
    }

    #[test]
    fn configuration_signature_changes_with_private_data_sources() {
        let first = configuration_signature(
            Path::new("D:/app"),
            Path::new("D:/sessions-a"),
            Path::new("D:/data"),
        );
        let second = configuration_signature(
            Path::new("D:/app"),
            Path::new("D:/sessions-b"),
            Path::new("D:/data"),
        );
        assert_ne!(first, second);
    }

    #[test]
    fn private_routes_require_the_exact_access_token() {
        assert_eq!(
            private_route("/secret-token/data.js", "secret-token"),
            Some("data.js")
        );
        assert_eq!(
            private_route("/secret-token/assets/logo.svg", "secret-token"),
            Some("assets/logo.svg")
        );
        assert_eq!(private_route("/data.js", "secret-token"), None);
        assert_eq!(private_route("/wrong/data.js", "secret-token"), None);
    }

    #[test]
    fn accepts_only_private_shutdown_posts() {
        assert!(is_shutdown_request("POST", "shutdown"));
        assert!(!is_shutdown_request("GET", "shutdown"));
        assert!(!is_shutdown_request("POST", "status"));
    }

    #[test]
    fn static_file_allowlist_excludes_source_and_private_files() {
        assert!(is_public_asset(Path::new("index.html")));
        assert!(is_public_asset(Path::new("assets/logo.svg")));
        assert!(!is_public_asset(Path::new("generate_codex_data.go")));
        assert!(!is_public_asset(Path::new("README.md")));
        assert!(!is_public_asset(Path::new(".codexscope-cache.json")));
    }

    #[test]
    fn browser_responses_include_cross_origin_protection() {
        let headers = security_headers();
        assert!(headers.contains("Cross-Origin-Resource-Policy: same-origin"));
        assert!(headers.contains("X-Content-Type-Options: nosniff"));
        assert!(headers.contains("Content-Security-Policy:"));
        assert!(headers.contains("Referrer-Policy: no-referrer"));
        assert!(!headers.contains("Access-Control-Allow-Origin"));
    }

    #[test]
    fn generated_access_tokens_are_random_hex_values() {
        let first = generate_access_token().unwrap();
        let second = generate_access_token().unwrap();
        assert_eq!(first.len(), 48);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn generation_status_and_error_event_do_not_expose_paths() {
        let status = generation_status_json(GenerationStatus::Error);
        assert_eq!(status, "{\"state\":\"error\"}");
        let event = generation_error_event();
        assert_eq!(event, "event: generation-error\ndata: {}\n\n");
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
