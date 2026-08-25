# CodexScope-Live v0.2.0 发布安全加固实施计划

> 本计划只处理已确认的公开发布阻断问题，不重做 UI，不提交、不推送，也不修改 GitHub 上现有的 v0.1.9 Release。

**目标：** 让 Windows 免安装版在不要求用户配置环境变量的前提下，安全读取本机 Codex 会话；阻止跨站页面读取本地数据；让运行状态、重复启动和发布包验证可信。

**总体设计：** Rust 服务启动时创建随机访问前缀，根地址只重定向到本次运行的私有路径；静态资源采用白名单，生成数据写入 `%LOCALAPPDATA%/CodexScope-Live`。健康检查使用协议版本和配置指纹判断是否可复用旧实例。发布脚本固定 Windows x64 目标，验证器必须解压并验证最终 ZIP、SHA256、PE 架构和真实生成数据。

---

## 任务 1：安全路由和实例识别

- [x] 在 `live-server/src/lib.rs` 添加失败测试：私有路径解析、静态资源白名单、安全响应头、带协议和配置指纹的健康响应。
- [x] 运行 Rust 测试，确认新测试先失败。
- [x] 实现每次启动随机访问令牌、根路径重定向、私有路由、静态资源白名单和严格安全头；移除 SSE 跨域放行。
- [x] 仅当已运行实例的协议版本和配置指纹一致时复用端口，否则明确报错退出。
- [x] 再次运行 Rust 测试，确认通过。

## 任务 2：运行数据隔离与真实状态

- [x] 添加失败测试：`--data-dir` 参数、默认本地数据目录、生成状态 JSON 和错误 SSE 事件。
- [x] 将 `data.js`、`data.raw.js` 和缓存写入独立数据目录；安装目录只提供只读前端和生成器。
- [x] 增加 `/status` 私有接口；生成器首次或增量运行失败时更新状态并广播错误事件。
- [x] 修改 `live.js` 使用相对私有 URL，并根据 `/status` 显示“实时监控中”或“数据生成失败”，避免连接成功却伪装数据成功。
- [x] 运行 Rust、前端和实时状态验证。

## 任务 3：最终 ZIP 的可复现发布验证

- [x] 先增强 `verify_portable_release.js`，让旧发布结果因未解压 ZIP、未核验 SHA/架构/真实数据/跨站阻断而失败。
- [x] 将版本统一为 `0.2.0`，发布文件命名为 `CodexScope-Live-v0.2.0-Windows-x64.zip`。
- [x] 在 PowerShell 构建中固定 Rust `x86_64-pc-windows-msvc` 和 Go `windows/amd64`，并安全恢复构建环境。
- [x] 验证器解压 ZIP 到临时目录后启动程序，使用最小真实 JSONL fixture 验证生成器输出，检查两个 EXE 的 PE Machine 为 `0x8664`。
- [x] 校验 SHA256 文件、包内禁止项、安装目录运行后无私有运行数据，并验证无令牌 `/data.js` 不可访问及跨站脚本无法读取数据。
- [x] 运行完整 Windows 构建和发布验证。

## 任务 4：文档、版本和知识同步

- [x] 更新 `CHANGELOG.md`、中英文 README、`START-HERE.txt`，修复 README 截图语法并写清数据目录、安全模型和 SHA256 校验方式。
- [x] 运行 `npm.cmd run verify`、Tab/实时数据/主题检查、Rust 测试、Go 测试和最终 ZIP 验证。
- [x] 检查 `git diff --check`、`git status` 和最终包内容，不提交、不推送。
- [x] 把 v0.2.0 的安全设计、发布命令和验证证据同步到 `D:/AI-Memory/Knowledge-Vault/02-Projects/github-star-projects/CodexScope本地改造档案.md`。

## 完成标准

- 远程网页不能通过 `<script src="http://127.0.0.1:端口/data.js">` 读取会话数据。
- 应用目录运行前后均不出现真实 `data.js`、`data.raw.js` 或缓存文件。
- 生成器失败时页面明确显示失败，不能显示“实时监控中”。
- 不同根目录、会话目录或数据目录的旧实例不会被静默复用。
- 发布验证针对最终 ZIP 本身，并证明 SHA256、x64 架构、真实数据生成和安全边界。
- 所有版本号和文档统一为 v0.2.0。

## 任务 5：源码启动器版本错配回归（2026-08-25）

- [x] 复现旧 `live-server/target/release` EXE 托管新版 `live.js` 时 `/status` 返回 404，并确认页面误报“数据生成失败”。
- [x] 添加失败测试，要求源码启动器在存在 Cargo 时优先校验/构建当前源码，并要求页面把缺少 `/status` 识别为旧服务。
- [x] 修改 Windows 源码启动器为 `cargo run --release` 优先、缓存 EXE 仅作为无 Cargo 时的回退；修改页面诊断文案。
- [x] 重新构建本机 Release 服务并验证 `protocol=2`、私有路由、`status=ok` 和 `%LOCALAPPDATA%` 数据目录。
