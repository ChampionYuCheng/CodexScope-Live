# Windows 免安装便携版实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 生成普通 Windows 用户下载、解压并双击即可运行的 CodexScope-Live 发布包，无需安装 Node.js、Go、Rust 或手工配置环境变量。

**架构：** Rust 服务端从可执行文件所在目录自动发现面板资源，启动后打开固定本地地址，并调用同目录内预编译的 Go 数据生成器。PowerShell 发布脚本在开发机上完成前端、Rust、Go 构建，装配完整资源并生成 ZIP；Node 集成测试从最终目录启动程序并验证健康检查和关键静态资源。

**技术栈：** Rust 标准库、Go、PowerShell、Node.js、GitHub Releases。

---

## 文件结构

- 修改：`live-server/src/lib.rs`，解析自动打开参数并选择便携包资源根目录。
- 修改：`live-server/src/main.rs`，启动浏览器、处理重复启动并报告缺失会话目录。
- 创建：`verify_portable_release.js`，验证最终发布目录可独立启动。
- 创建：`scripts/build-windows-release.ps1`，构建并压缩 Windows x64 发布包。
- 修改：`package.json`，暴露 Windows 构建与验证命令。
- 修改：`windows/open-dashboard.cmd`，保留源码模式兼容入口并避免重复打开浏览器。
- 修改：`README.md`、`README.zh-CN.md`，把 GitHub Release 便携包作为普通用户首选入口。
- 修改：`D:/AI-Memory/Knowledge-Vault/02-Projects/github-star-projects/CodexScope本地改造档案.md`，记录最终发布方式和验证结果。

### 任务 1：便携启动行为

- [x] 在 `live-server/src/lib.rs` 中先添加失败测试：存在 `index.html` 时选择 EXE 目录，不存在时回退当前目录；`--no-open` 能关闭自动打开。
- [x] 运行 `cargo test --manifest-path live-server/Cargo.toml`，确认测试因缺少目标行为失败。
- [x] 实现 `default_dashboard_root`、`open_browser` 配置，并在 `main.rs` 启动浏览器；端口已由 CodexScope-Live 占用时只重新打开页面。
- [x] 再次运行 Rust 测试，确认全部通过。

### 任务 2：Windows 发布包

- [x] 创建 `verify_portable_release.js`，要求发布目录包含两个 EXE、完整前端资源、许可证和双语 README，并能通过 `/health`、`/live.js`、`/theme.js` 请求。
- [x] 运行 `node verify_portable_release.js`，确认因发布目录不存在而失败。
- [x] 创建 `scripts/build-windows-release.ps1`：执行前端构建、Go/Rust Release 构建，安全重建 `dist/CodexScope-Live-Windows-x64`，复制完整资源并生成 ZIP。
- [x] 在 `package.json` 增加 `release:windows` 和 `check:release:windows`，运行发布构建与集成验证并确认通过。

### 任务 3：文档、回归与知识同步

- [x] 更新中英文 README，区分普通用户下载 Release 与开发者源码构建，并注明本地数据和 Windows SmartScreen 边界。
- [x] 运行 `npm.cmd run verify`、Tab/实时数据测试、Rust 测试、Go 测试和发布包测试。
- [x] 检查 `git diff --check`、发布 ZIP 内容和 `git status`，不提交、不推送。
- [x] 将便携发布结构、命令和验证证据同步到 CodexScope 项目知识档案。
