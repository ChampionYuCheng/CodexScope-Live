# CodexScope-Live 数据细分与图表交互实现计划

> **面向 AI 代理的工作者：** 在当前工作区内按 TDD 顺序逐项执行；每项先观察红灯，再实现最小代码并运行完整回归。

**目标：** 完成会话模型、推理强度和速度细分，为总览、Token、速率和费用图表增加鼠标、触摸与键盘交互，并修复额度响应式布局及深浅主题可读性。

**架构：** 保留 Go 生成器、紧凑数组数据契约和原生 TypeScript/SVG。Go 端补充 completion 紧凑记录；前端在 app.ts 内增加共享离散图表交互控制器，动态重绘通过稳定数据键恢复选中点，不引入图表运行时依赖。

**技术栈：** Go 1.26、TypeScript 5.9、原生 DOM/SVG/CSS、Node.js、Playwright。

**项目边界：** 直接修改 D:\Tool_by_Agent\CodexScope-Live；保留 JUk1-GH/MIT 署名；不使用 worktree；不执行 commit 或 push。

---

## 文件职责

- generate_codex_data.go：导出逐轮 usage/completion、会话模型与 effort 明细、真实延迟统计。
- generate_codex_data_test.go：混合模型、completion 紧凑记录和旧索引兼容回归。
- app.ts：解码新增紧凑字段、计算自定义区间统计、渲染会话详情和共享图表交互。
- app.js：由 tsc 生成，不手工编辑。
- styles.css：tooltip、focus、会话详情、额度响应式和主题对比度。
- index.html：仅在需要稳定 ARIA 容器时增加语义结构。
- verify_interactions.js：Playwright 行为回归，覆盖 pointer、键盘、固定选择和实时局部刷新。
- verify_responsive.js：额度布局、tooltip 边界、375/768/1024/1440 视口回归。
- verify_theme.js：浅色/深色及材质主题的数据文字对比度回归。
- package.json：增加 check:interactions 并纳入 verify。

### 任务 1：补齐自定义区间 completion 数据桥

- [x] 在 generate_codex_data_test.go 新增 TestBuildPayloadExportsCompletionRecordsForCustomRanges，断言 recordsV2 旧索引 0..7 不变、索引 8/9 为 turn/effort；completionRecordsV2 布局为 tsOffset、sidIndex、modelIndex、durationMs、ttfbMs、turnIndex、effortIndex；catalog 能反解记录。
- [x] 运行 go test -run TestBuildPayloadExportsCompletionRecordsForCustomRanges .，预期因 completionRecordsV2 缺失失败。
- [x] 修改 RawExportPayload、buildPayload、buildRawPayload 和导出白名单，保留 ttfbRecordsV2 兼容字段。
- [x] 修改 app.ts：rawDataset 增加 turnAt/effortAt；usage 解码保留索引 8/9；新增 completion 解码与缓存；computeStats 按会话聚合 modelBreakdown、effortBreakdown、latestModel、latestEffort、TTFB/Duration 中位数和 P90。
- [x] 运行 go test ./... 与 npm.cmd run build:frontend，预期通过。

### 任务 2：会话页展示逐轮维度和速度

- [x] 在 verify_interactions.js 写会话详情红灯：注入混合模型 fixture，点击或键盘展开第一行，断言出现 Sol、Terra、high、low、TTFB 中位数/P90、整轮耗时中位数/P90。
- [x] 运行 node verify_interactions.js，预期因详情面板不存在失败。
- [x] 修改 renderSessions：行使用可聚焦按钮语义和 aria-expanded；默认展示最新模型与最新 effort；展开区按模型和 effort 展示 Token/调用量；速度只展示 TTFB 和整轮耗时，不伪造生成 Token/s。
- [x] 在 styles.css 增加会话详情自适应网格、44px 触控目标和 focus-visible。
- [x] 运行 node verify_interactions.js 与 npm.cmd run check:tabs，预期通过。

### 任务 3：建立共享离散图表交互控制器

- [x] 在 verify_interactions.js 增加共享行为红灯：图表必须可聚焦、有可见 tooltip；ArrowLeft/ArrowRight/Home/End 改变活动点；Enter 固定或解除选择。
- [x] 运行测试，预期因共享交互缺失失败。
- [x] 在 app.ts 增加 bindDiscreteChartInteraction：统一处理 pointermove、pointerdown、setPointerCapture、pointerup、pointerleave、focus、keydown；Enter/Space 固定，Escape 解除；实时重绘按数据 key 恢复，找不到时选择最近点；替换旧监听器避免累积。
- [x] 在 styles.css 增加 chart-interaction-layer、chart-crosshair、chart-tooltip、固定态和 reduced-motion。
- [x] 运行 npm.cmd run build:frontend 与交互测试。

### 任务 4：接入总览 Sparkline 与 Token Scrubber

- [x] 为调用量、峰值速率、缓存命中率写 pointer/键盘红灯，tooltip 同时包含时间和值。
- [x] 为 Token 图写拖动红灯：从 25% 拖至 75%，tooltip 时间/数值变化；点击固定后 CODEXSCOPE_APPLY_DATA 局部刷新保持同一时间键或最近点。
- [x] 改造 renderSparks，给三个 SVG 写入透明命中层、活动圆点和独立格式化值。
- [x] 改造 renderChart，移除只标峰值的静态 tooltip，使用共享控制器显示 crosshair、活动点和所有启用序列值。
- [x] 保留累计/分时、绝对/对数、序列开关，切换后活动索引合法化。
- [x] 运行交互测试、npm.cmd run check:live-data 和 TypeScript 构建。

### 任务 5：接入速率分布与费用走势

- [x] 写红灯：速率柱和费用柱不能只依赖 title；hover/focus 显示可见 tooltip，点击固定，左右键移动。
- [x] 改造 renderDistribution：每根柱有稳定数据索引和 ARIA 标签，共享控制器显示时间、调用数或 Token；模式切换保持同一时间桶。
- [x] 改造 renderCost：费用柱显示时间和当前币种金额；USD/CNY 切换后固定柱保持且 tooltip 金额更新。
- [x] 运行交互测试与 TypeScript 构建。

### 任务 6：额度响应式与深浅主题可读性

- [x] 扩展 verify_responsive.js 红灯：375/768/1024/1440 下额度行不重叠、不横向溢出；轨道可见高度不少于 8px，触控模式不少于 10px；tooltip 保持在视口内。
- [x] 扩展 verify_theme.js 红灯：浅色/深色下 dist-bar-value、chart-tooltip、额度值不使用硬编码深色；文字与面板背景的计算对比度至少 4.5:1。
- [x] 修改 styles.css：额度布局使用三列 minmax 网格；轨道高度使用 clamp(8px,1vw,14px)，窄容器折为两行；数据文字和 tooltip 使用主题变量；浅色玻璃提高面板不透明度，深色弱文本提高亮度；保留四种材质和背景图。
- [x] 运行 npm.cmd run check:theme 与 node verify_responsive.js。

### 任务 7：完整回归、审查和记录

- [x] 运行 go test ./...。
- [x] 运行 npm.cmd run build:frontend、npm.cmd run check:interactions、npm.cmd run check:tabs、npm.cmd run check:live-data、npm.cmd run check:theme、npm.cmd run verify。
- [x] 运行 cargo test --manifest-path live-server/Cargo.toml 与 git diff --check。
- [x] 使用 Playwright 在 375、768、1024、1440 四个视口分别检查浅色和深色：tooltip 不溢出、焦点可见、拖动不滚动页面、实时刷新不重置固定点。
- [x] 逐项对照用户提出的数据/UI需求；真实生成 Token/s 不实现，因为底层只提供整轮耗时，界面明确采用 TTFB 与整轮耗时。
- [x] 同步 D:\AI-Memory\Knowledge-Vault\02-Projects\github-star-projects\CodexScope本地改造档案.md，记录实现、验证证据和剩余边界。
- [x] 保留未提交状态，由用户在 IDEA 中检查、提交和推送。

## 完成定义

- 同一会话切换模型后，预设和自定义区间均显示最新模型，并能展开查看模型、effort 和速度明细。
- 四类图表均支持 pointer、触摸等价路径、键盘、点击固定和实时局部刷新状态保持。
- 额度页在 375/768/1024/1440 下无重叠或横向溢出；浅色/深色核心数据达到 4.5:1 对比度。
- 所有项目回归命令退出码为 0；不以静态字符串检查替代真实浏览器行为验证。
