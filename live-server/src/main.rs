use codexscope_live::{
    configuration_signature, content_type, dashboard_url, data_event, generate_access_token,
    generation_error_event, generation_status_json, health_response, is_compatible_health_response,
    is_public_asset, private_route, safe_relative_path, security_headers, session_signature,
    GenerationStatus, ServerConfig,
};
use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};

type Clients = Arc<Mutex<Vec<mpsc::Sender<String>>>>;

#[derive(Clone)]
struct AppState {
    root: PathBuf,
    data_dir: PathBuf,
    access_token: String,
    configuration_signature: String,
    generation_status: Arc<Mutex<GenerationStatus>>,
    clients: Clients,
}

fn main() {
    let config = ServerConfig::from_args(env::args());
    let dashboard_url = dashboard_url(config.port);
    if let Err(error) = fs::create_dir_all(&config.root) {
        eprintln!("无法准备面板目录 {}: {error}", config.root.display());
        std::process::exit(1);
    }
    if let Err(error) = fs::create_dir_all(&config.data_dir) {
        eprintln!(
            "无法准备本地数据目录 {}: {error}",
            config.data_dir.display()
        );
        std::process::exit(1);
    }
    let instance_signature =
        configuration_signature(&config.root, &config.sessions, &config.data_dir);

    let listener = match TcpListener::bind(("127.0.0.1", config.port)) {
        Ok(listener) => listener,
        Err(error)
            if error.kind() == io::ErrorKind::AddrInUse
                && existing_live_server(config.port, &instance_signature) =>
        {
            println!("CodexScope-Live 已在运行: {dashboard_url}");
            if config.open_browser {
                let _ = open_dashboard(&dashboard_url);
            }
            return;
        }
        Err(error) if error.kind() == io::ErrorKind::AddrInUse => {
            eprintln!(
                "端口 {} 已被其他程序或不兼容的 CodexScope-Live 实例占用。请关闭旧窗口后重试，或使用 --port 指定其他端口。",
                config.port
            );
            std::process::exit(1);
        }
        Err(error) => {
            eprintln!("无法监听 {dashboard_url}: {error}");
            std::process::exit(1);
        }
    };
    listener
        .set_nonblocking(true)
        .expect("failed to configure local listener");

    let access_token = generate_access_token().unwrap_or_else(|error| {
        eprintln!("无法生成本地安全访问令牌: {error}");
        std::process::exit(1);
    });

    let state = AppState {
        root: config.root.clone(),
        data_dir: config.data_dir.clone(),
        access_token,
        configuration_signature: instance_signature,
        generation_status: Arc::new(Mutex::new(GenerationStatus::Pending)),
        clients: Arc::new(Mutex::new(Vec::new())),
    };
    let monitor_state = state.clone();
    let monitor_config = config.clone();
    thread::spawn(move || monitor_sessions(monitor_config, monitor_state));

    if !config.sessions.is_dir() {
        eprintln!(
            "未找到 Codex 会话目录 {}，暂时显示示例数据。运行 Codex 后会自动检测。",
            config.sessions.display()
        );
    }
    println!("CodexScope-Live: {dashboard_url}");
    if config.open_browser {
        if let Err(error) = open_dashboard(&dashboard_url) {
            eprintln!("无法自动打开浏览器，请手动访问 {dashboard_url}: {error}");
        }
    }
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

fn existing_live_server(port: u16, expected_signature: &str) -> bool {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    let Ok(mut stream) = TcpStream::connect_timeout(&address.into(), Duration::from_millis(500))
    else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut response = Vec::new();
    stream.read_to_end(&mut response).is_ok()
        && is_compatible_health_response(&response, expected_signature)
}

#[cfg(target_os = "windows")]
fn open_dashboard(url: &str) -> io::Result<()> {
    Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .map(|_| ())
}

#[cfg(target_os = "macos")]
fn open_dashboard(url: &str) -> io::Result<()> {
    Command::new("open").arg(url).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_dashboard(url: &str) -> io::Result<()> {
    Command::new("xdg-open").arg(url).spawn().map(|_| ())
}

fn monitor_sessions(config: ServerConfig, state: AppState) {
    let mut previous = session_signature(&config.sessions).ok();
    match run_generator(&config) {
        Ok(()) => set_generation_status(&state, GenerationStatus::Ok),
        Err(error) => {
            set_generation_status(&state, GenerationStatus::Error);
            broadcast(&state.clients, generation_error_event());
            eprintln!("首次生成本地数据失败，继续使用示例数据: {error}");
        }
    }

    loop {
        thread::sleep(Duration::from_millis(config.interval_ms));
        let current = session_signature(&config.sessions).ok();
        if current == previous {
            continue;
        }
        previous = current;
        match run_generator(&config) {
            Ok(()) => {
                set_generation_status(&state, GenerationStatus::Ok);
                broadcast(&state.clients, data_event(SystemTime::now()));
            }
            Err(error) => {
                set_generation_status(&state, GenerationStatus::Error);
                broadcast(&state.clients, generation_error_event());
                eprintln!("检测到日志变化，但生成数据失败: {error}");
            }
        }
    }
}

fn set_generation_status(state: &AppState, status: GenerationStatus) {
    *state
        .generation_status
        .lock()
        .expect("generation status poisoned") = status;
}

fn run_generator(config: &ServerConfig) -> io::Result<()> {
    let output = config.data_dir.join("data.js");
    let cache = config.data_dir.join(".codexscope-cache.json");
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
    if target == "/health" {
        let body = health_response(&state.configuration_signature);
        write_response(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            body.as_bytes(),
        );
        return;
    }
    if target == "/" {
        write_redirect(&mut stream, &format!("/{}/", state.access_token));
        return;
    }

    let target = percent_decode(target).unwrap_or_else(|| "/".to_owned());
    let Some(relative) = private_route(&target, &state.access_token) else {
        write_response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"not found",
        );
        return;
    };
    if relative == "events" {
        serve_events(stream, state.clients);
        return;
    }
    if relative == "status" {
        let status = *state
            .generation_status
            .lock()
            .expect("generation status poisoned");
        write_response(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            generation_status_json(status).as_bytes(),
        );
        return;
    }
    let Some(relative) = safe_relative_path(relative) else {
        write_response(
            &mut stream,
            "400 Bad Request",
            "text/plain; charset=utf-8",
            b"invalid path",
        );
        return;
    };
    let path = if matches!(
        relative.to_string_lossy().as_ref(),
        "data.js" | "data.raw.js"
    ) {
        let generated = state.data_dir.join(&relative);
        if generated.is_file() {
            generated
        } else {
            state.root.join(&relative)
        }
    } else if is_public_asset(&relative) {
        state.root.join(&relative)
    } else {
        write_response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"not found",
        );
        return;
    };
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
    let headers = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-cache\r\n{}Connection: keep-alive\r\n\r\n",
        security_headers()
    );
    if stream.write_all(headers.as_bytes()).is_err() {
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
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\n{}Connection: close\r\n\r\n",
        body.len(),
        security_headers()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}

fn write_redirect(stream: &mut TcpStream, location: &str) {
    let body = b"CodexScope-Live";
    let header = format!(
        "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\n{}Connection: close\r\n\r\n",
        body.len()
        , security_headers()
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
