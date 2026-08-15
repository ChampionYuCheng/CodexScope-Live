use codexscope_live::{
    content_type, data_event, safe_relative_path, session_signature, ServerConfig,
};
use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};

type Clients = Arc<Mutex<Vec<mpsc::Sender<String>>>>;

#[derive(Clone)]
struct AppState {
    root: PathBuf,
    clients: Clients,
}

fn main() {
    let config = ServerConfig::from_args(env::args());
    if let Err(error) = fs::create_dir_all(&config.root) {
        eprintln!("无法准备面板目录 {}: {error}", config.root.display());
        std::process::exit(1);
    }

    let listener = match TcpListener::bind(("127.0.0.1", config.port)) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("无法监听 http://127.0.0.1:{}: {error}", config.port);
            std::process::exit(1);
        }
    };
    listener
        .set_nonblocking(true)
        .expect("failed to configure local listener");

    let state = AppState {
        root: config.root.clone(),
        clients: Arc::new(Mutex::new(Vec::new())),
    };
    let monitor_state = state.clone();
    let monitor_config = config.clone();
    thread::spawn(move || monitor_sessions(monitor_config, monitor_state));

    println!(
        "CodexScope live dashboard: http://127.0.0.1:{}",
        config.port
    );
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                let connection_state = state.clone();
                thread::spawn(move || handle_connection(stream, connection_state));
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(20));
            }
            Err(error) => eprintln!("接受浏览器连接失败: {error}"),
        }
    }
}

fn monitor_sessions(config: ServerConfig, state: AppState) {
    let mut previous = session_signature(&config.sessions).ok();
    if let Err(error) = run_generator(&config) {
        eprintln!("首次生成本地数据失败，继续使用现有或示例数据: {error}");
    }

    loop {
        thread::sleep(Duration::from_millis(config.interval_ms));
        let current = session_signature(&config.sessions).ok();
        if current == previous {
            continue;
        }
        previous = current;
        match run_generator(&config) {
            Ok(()) => broadcast(&state.clients, data_event(SystemTime::now())),
            Err(error) => eprintln!("检测到日志变化，但生成数据失败: {error}"),
        }
    }
}

fn run_generator(config: &ServerConfig) -> io::Result<()> {
    let output = config.root.join("data.js");
    let cache = config.root.join(".codexscope-cache.json");
    if let Some(generator) = find_generator(config) {
        let status = Command::new(generator)
            .current_dir(&config.root)
            .args([
                "--root",
                config.sessions.to_string_lossy().as_ref(),
                "--out",
                output.to_string_lossy().as_ref(),
                "--cache",
                cache.to_string_lossy().as_ref(),
            ])
            .status()?;
        if status.success() {
            return Ok(());
        }
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("数据生成器退出码 {:?}", status.code()),
        ));
    }

    let source = config.root.join("generate_codex_data.go");
    if !source.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "未找到预编译生成器或 generate_codex_data.go",
        ));
    }
    let status = Command::new("go")
        .current_dir(&config.root)
        .args([
            "run",
            "generate_codex_data.go",
            "--root",
            config.sessions.to_string_lossy().as_ref(),
            "--out",
            output.to_string_lossy().as_ref(),
            "--cache",
            cache.to_string_lossy().as_ref(),
        ])
        .status()
        .map_err(|error| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("无法运行 Go 生成器: {error}"),
            )
        })?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::Other,
            format!("Go 数据生成器退出码 {:?}", status.code()),
        ))
    }
}

fn find_generator(config: &ServerConfig) -> Option<PathBuf> {
    if let Some(path) = &config.generator {
        return path.exists().then_some(path.clone());
    }
    [
        config.root.join("codexscope-windows-amd64.exe"),
        config.root.join("codexscope-generator.exe"),
        config.root.join("bin").join("codexscope-windows-amd64.exe"),
        config.root.join("bin").join("codexscope-generator.exe"),
    ]
    .into_iter()
    .find(|path| path.exists())
}

fn broadcast(clients: &Clients, event: String) {
    let mut clients = clients.lock().expect("client list poisoned");
    clients.retain(|client| client.send(event.clone()).is_ok());
}

fn handle_connection(mut stream: TcpStream, state: AppState) {
    let mut request = [0u8; 8192];
    let size = match stream.read(&mut request) {
        Ok(size) => size,
        Err(_) => return,
    };
    let request = String::from_utf8_lossy(&request[..size]);
    let Some(request_line) = request.lines().next() else {
        return;
    };
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("/");
    if method != "GET" {
        write_response(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain; charset=utf-8",
            b"GET only",
        );
        return;
    }

    let target = target.split('?').next().unwrap_or("/");
    if target == "/events" {
        serve_events(stream, state.clients);
        return;
    }
    if target == "/health" {
        write_response(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            br#"{"ok":true,"mode":"local"}"#,
        );
        return;
    }

    let target = percent_decode(target).unwrap_or_else(|| "/".to_owned());
    let relative = target.trim_start_matches('/');
    let relative = if relative.is_empty() {
        "index.html"
    } else {
        relative
    };
    let Some(relative) = safe_relative_path(relative) else {
        write_response(
            &mut stream,
            "400 Bad Request",
            "text/plain; charset=utf-8",
            b"invalid path",
        );
        return;
    };
    let path = state.root.join(relative);
    match fs::read(&path) {
        Ok(body) => write_response(&mut stream, "200 OK", content_type(&path), &body),
        Err(error) if error.kind() == io::ErrorKind::NotFound => write_response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"not found",
        ),
        Err(_) => write_response(
            &mut stream,
            "500 Internal Server Error",
            "text/plain; charset=utf-8",
            b"read failed",
        ),
    }
}

fn serve_events(mut stream: TcpStream, clients: Clients) {
    let headers = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\n\r\n";
    if stream.write_all(headers).is_err() {
        return;
    }
    let (sender, receiver) = mpsc::channel();
    clients.lock().expect("client list poisoned").push(sender);
    loop {
        match receiver.recv_timeout(Duration::from_secs(15)) {
            Ok(event) => {
                if stream.write_all(event.as_bytes()).is_err() || stream.flush().is_err() {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if stream.write_all(b": ping\n\n").is_err() || stream.flush().is_err() {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn write_response(stream: &mut TcpStream, status: &str, mime: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return None;
            }
            let high = hex_value(bytes[index + 1])?;
            let low = hex_value(bytes[index + 2])?;
            output.push(high * 16 + low);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).ok()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
