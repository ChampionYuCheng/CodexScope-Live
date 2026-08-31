# CodexScope-Live 数据细分与图表交互可行性审计

日期：2026-08-29
状态：P0/P1/P2 已于 2026-08-31 实施并完成自动化回归
范围：本地 Codex JSONL、Go 数据生成器、静态 TypeScript/SVG 前端
隐私边界：仅审计事件类型、字段名、时间、模型、推理档位和计数；不读取或记录提示词、回复正文和工具输出。

## 结论

用户提出的模型切换归属、推理档位、首 Token 延迟、整轮耗时，以及总览/Token/费用/速率图表交互均可实现。当前最优先的问题不是图表，而是会话聚合模型不够细：原始日志按轮次记录 `model` 和 `effort`，但生成器导出的 `UsageEvent` 丢弃了 `turn_id` 与 `effort`，会话排行又只保留首次遇到的单个 `model`。因此，同一会话从 Sol 切换到 Terra 后，Token 事件可以按 Terra 计入模型汇总，但会话行仍可能一直显示 Sol。

速度指标需要拆成两类：

- 可准确展示：首 Token 延迟（TTFB）、整轮耗时、每轮 Token、模型、推理档位。
- 只能估算：真实生成吞吐（Token/s）。`duration_ms` 包含工具调用、等待、审批和子任务时间，不能直接等同于模型解码时间。

## 2026-08-31 实施结果

- 生成器保留 `turn_id`、`model`、`effort`，并导出兼容旧索引的 usage 紧凑记录和独立 `completionRecordsV2`；缓存 schema 已升级。
- 同一会话从 Sol 切到 Terra 后，排行显示最新模型；展开项展示各模型、各推理档位的 Token/调用，以及 TTFB、整轮耗时的中位数和 P90。
- 自定义日期范围与预计算日期预设使用相同统计语义；会话视图导出稳定本地 ID，局部刷新不会把同名会话的展开状态串到另一行。
- 总览三张火花图、Token 折线图、速率柱状图和费用柱状图共用离散图表控制器，支持 pointer 悬浮/拖动、左右键/Home/End、Enter 固定和 Escape 解除。
- 实时更新仍只替换内存数据，不重载文档；固定节点、活动 Tab、会话详情、主题和滚动位置均保留。
- 额度页改为 10–14px 响应式轨道和至少 44px 的信息行；浅色/深色以及背景图材质下的核心数值使用主题语义色和稳定底板。
- 未实现“精确模型生成 Token/s”：底层没有排除工具、审批和等待后的逐 Token 计时，界面继续使用可验证的 TTFB 与整轮耗时口径。

## 已知事实

### 1. 原始日志支持逐轮模型和推理档位

`turn_context` 包含 `turn_id`、`model`、`effort`。8 月 28 日一个去敏样本在同一文件内发生了真实切换：

- 第 8 行：`gpt-5.6-sol`，`effort=high`；
- 第 3664 行：`gpt-5.6-terra`，`effort=high`；
- 第 3673 行：切换后继续产生 `token_count`；
- 第 4326 行：同一 Terra 轮次产生 `task_complete`，含 `duration_ms` 与 `time_to_first_token_ms`。

证据：`C:\Users\ChampionYuCheng\.codex\sessions\2026\08\28\rollout-2026-08-28T09-49-31-01a0460e-d3c1-7cd3-aef4-f1ed44d9ac7f.jsonl:8`、`:3664`、`:3673`、`:4326`。

`token_count` 的 `last_token_usage` 包含输入、缓存输入、缓存写入、输出、推理输出和总 Token。`task_complete` 包含 `turn_id`、开始/结束时间、总耗时和首 Token 延迟。由此可以把模型、推理档位、Token 和延迟关联到同一轮次。

### 2. 当前解析器保留了模型，但丢弃了轮次和推理档位

当前 `UsageEvent` 只有时间、会话、Token、模型和快照，没有 `turn_id`、`effort`；`CompletionEvent` 也没有这两个维度。[generate_codex_data.go](../generate_codex_data.go#L35)
解析器在遇到 `turn_context` 时只更新文件级 `parsed.Model`，没有保存当前 `turn_id` 或 `effort`。[generate_codex_data.go](../generate_codex_data.go#L733)
后续 `token_count` 用当时的 `parsed.Model` 创建事件，因此 Token 的模型归属具备逐轮基础，但推理档位和轮次关联已经丢失。[generate_codex_data.go](../generate_codex_data.go#L759)

### 3. 会话排行单模型显示的根因已确定

构建会话排行时，`sessionRow` 只有一个 `model` 字段。[generate_codex_data.go](../generate_codex_data.go#L1421)
某个会话第一次遇到 Usage 事件时写入模型，后续同会话事件只累计 Token/调用，不更新模型，也不保留模型分段。[generate_codex_data.go](../generate_codex_data.go#L1467)
前端对自定义时间范围执行同样的“首次模型固定”逻辑。[app.ts](../app.ts#L523)

这解释了用户观察到的现象：如果筛选区间内该会话的第一条事件来自 Sol，排行会一直显示 Sol，即使后续 Terra Token 已经增长。

### 4. 延迟字段可用，但真实解码速度不可直接得出

解析器已经读取 `task_complete.duration_ms` 与 `time_to_first_token_ms`，但导出时主要只把 TTFB 聚合到模型层。[generate_codex_data.go](../generate_codex_data.go#L788)
样本中的一轮 `duration_ms=4,657,602`，而 TTFB 为 `35,886ms`。如此长的整轮耗时显然可能包含工具执行和等待；用 `output_tokens / duration` 展示为“模型速度”会误导。

## 当前假设与待确认语义

“速度”至少有两个合理模型：

1. **交互响应速度**：TTFB、整轮耗时、中位数、P90/P95。字段直接存在，准确且适合用户判断体感。
2. **生成吞吐速度**：输出 Token/s。当前只能以 `output_tokens / (completed_at - started_at)` 或 `output_tokens / (duration_ms - TTFB)` 估算；工具密集型轮次会显著失真。

建议默认实现模型 1；模型 2 若保留，必须命名为“估算吞吐”，附口径说明，并允许排除含工具调用/超长等待的轮次。该语义在编码前由项目负责人确认。

## 数据权威链

| 角色 | 载体 | 责任 |
|---|---|---|
| 产生者/权威来源 | Codex 本地 JSONL | 逐轮模型、effort、Token、完成时间与延迟 |
| 处理者 | `generate_codex_data.go` | 去敏解析、增量缓存、归一化、聚合 |
| 派生数据 | `data.js` / `data.raw.js` | 浏览器消费的预计算视图与原始压缩记录 |
| 消费者 | `app.ts` / `app.js` | 筛选、排行、图表与交互 |
| 业务负责人 | CodexScope-Live 维护者 | 决定速度口径、排行展示和隐私边界 |

## 可行性矩阵

| 需求 | 可行性 | 数据来源 | 约束 |
|---|---|---|---|
| 同一会话正确识别 Sol→Terra | 直接支持 | `turn_context.model` + `turn_id` | 需升级事件 schema 和缓存版本 |
| 会话内按模型拆分 Token/调用 | 直接支持 | 逐轮模型 + `token_count` | 会话 UI 要支持多模型明细 |
| 显示推理档位 | 直接支持 | `turn_context.effort` | 当前生成器未保留，需新增字段 |
| TTFB、整轮耗时分类 | 直接支持 | `task_complete` | 应展示中位数/P90，避免只看平均值 |
| 精确模型解码 Token/s | 不直接支持 | 缺少稳定的逐 Token 生成时钟 | 只能估算并明确口径 |
| 总览三张小图 Hover | 直接支持 | 已有时间桶 | 当前 SVG 只有 `<path>`，需交互覆盖层 |
| Token 图 Hover/拖动/键盘 | 直接支持 | 已有 trend buckets | 需共享 Crosshair/Tooltip/Scrubber |
| 费用柱状图 Hover/点击 | 直接支持 | distribution cost buckets | 当前只有原生 `title`，应改为可固定 Tooltip |
| 速率图 Hover/点击 | 直接支持 | distribution buckets | 与费用图共用柱状图交互层 |
| 额度页响应式优化 | 直接支持 | CSS | 当前轨道 5–6px 且多处按高度继续压缩 |
| 明暗主题与背景图可读性 | 直接支持 | 主题变量 + CSS | 需建立图表语义色和对比度底板 |

## 推荐数据模型

不要再把“会话”和“模型”做一对一关系，改为：

```text
Session
  ├─ Turn (turn_id, started_at, completed_at)
  │    ├─ model
  │    ├─ effort
  │    ├─ usage
  │    ├─ ttfb_ms
  │    └─ duration_ms
  └─ Aggregates
       ├─ by_model[]
       └─ by_effort[]
```

建议扩展：

- `UsageEvent`：新增 `TurnID`、`Effort`；
- `CompletionEvent`：新增 `TurnID`、`Effort`，保留 `DurationMs`、`TTFBMs`；
- 原始导出记录：新增 effort 目录和 turn 目录，避免重复字符串；
- 会话排行：显示“最近模型”+“多模型”标识，展开后按模型/effort 展示 Token、调用、TTFB 中位数、P90 和整轮耗时；
- 缓存：提升 `cacheVersion`，防止旧缓存继续缺少新增字段。

## 推荐交互结构

当前折线图和小图是手写 SVG，主图 Tooltip 只在渲染时固定到最新点或峰值，并没有 Pointer 事件。[app.ts](../app.ts#L878)
总览三个 Sparkline 只是生成路径；其 SVG 还被标成 `aria-hidden`。[app.ts](../app.ts#L1230)、[index.html](../index.html#L247)
费用走势仅给每根柱子加原生 `title`，速率柱状图同样没有可固定的详情层。[app.ts](../app.ts#L1180)、[app.ts](../app.ts#L1058)

建议保持无运行时依赖的便携目标，在现有 TypeScript/SVG 上抽一个共享交互控制器，而不是立即引入大型图表库：

- `InteractiveLineChart`：最近点命中、十字线、Tooltip、拖动游标、左右方向键、Home/End；
- `InteractiveBarChart`：Hover/Focus 预览，点击/Enter 固定，再次点击或 Esc 关闭；
- Pointer Capture：鼠标、触控笔和触屏使用同一套事件；
- 实时刷新只更新路径与数据，不重建交互容器；保留当前锁定点，若点已移出窗口再自动释放；
- Tooltip 提供时间、总量、输入、缓存、输出、推理、调用、费用等与页面对应的字段；
- 图表下方保留简洁的可访问数据摘要，不能只依赖 Hover。

页面映射：

| 页面 | 推荐交互 |
|---|---|
| 总览 | Sparkline Hover/Focus，显示时间、值、相邻桶变化；小卡不常驻 X 轴，避免拥挤 |
| Token | 十字线 + 拖动 Scrubber + 多序列 Tooltip；可选拖框缩放，提供“重置视图” |
| 模型与费用 | 柱子 Hover/Focus/点击固定；显示时间、费用、模型占比和 Token 构成 |
| 速率 | 与费用图共用柱状交互；切换调用/Token 时保留选中时间桶 |

## 额度页与主题问题

额度轨道当前基础高度只有 6px，在紧凑高度媒体查询中降到 5px；同时使用固定列宽与多层 `max-height` 规则，因此浏览器缩放时容易显得细、挤和不协调。[styles.css](../styles.css#L1682)、[styles.css](../styles.css#L3509)
建议以容器宽度而非主要依赖屏幕高度来布局：轨道视觉高度 10–14px、可交互命中区至少 28px；宽屏横排，中屏卡片化两列，小屏单列；百分比和值使用 `clamp()`，环形图和进度列表不再相互抢固定列宽。

深色主题中，坐标轴文字已覆盖为 `var(--muted)`，但柱状图顶部值仍硬编码为 `#172b49`，没有深色覆盖，这正是截图中“661”不醒目的直接原因。[styles.css](../styles.css#L3070)、[styles.css](../styles.css#L4679)

主题层建议新增语义变量：

- `--chart-label`、`--chart-label-strong`、`--chart-grid`；
- `--tooltip-bg`、`--tooltip-text`、`--tooltip-border`；
- `--plot-scrim`：自定义背景图下保证图表区域对比度；
- `--focus-ring`、`--selection-fill`、`--selection-stroke`。

所有主题至少满足普通文字 4.5:1 对比度；液态玻璃/亚克力主题必须给数据层单独加稳定底板，不能让文字直接依赖背景图亮暗。支持 `prefers-reduced-motion`，交互目标至少 44px，键盘焦点必须可见。

## 推荐实施顺序

### P0：先修数据正确性

1. 扩展解析状态：当前 `turn_id`、`model`、`effort`；
2. Token/完成事件按轮次落库并升级缓存 schema；
3. 会话聚合改成多模型、多 effort；
4. 增加“同一会话 Sol→Terra”的回归测试；
5. 用 8 月 28 日去敏样本做只读验收。

### P1：建立共用图表交互层

1. Token 主图 Crosshair/Tooltip/Scrubber；
2. 总览三个 Sparkline 接入相同命中算法；
3. 费用和速率柱状图接入 Hover/Focus/Click；
4. 验证实时刷新时不丢选中状态、不整页闪烁。

### P2：额度响应式与主题可读性

1. 重排额度组件和轨道尺寸；
2. 图表语义色、Tooltip 和背景图数据底板；
3. 375/768/1024/1440 宽度、80%/100%/125%/150% 浏览器缩放验收；
4. 键盘、触屏、`prefers-reduced-motion` 和高对比度验收。

## 暂不建议

- 在 P0 前先做大量 Tooltip：会让错误的会话模型归属以更精致的形式继续展示。
- 把 `duration_ms` 直接命名为“模型生成速度”：它包含工具和等待时间。
- 只靠原生 `title`：不可固定、触屏体验差、内容样式不可控。
- 为单一交互立即引入大型图表依赖：当前项目的单文件静态前端和便携发行目标更适合先复用现有 SVG。

## 待负责人确认

1. “速度”默认采用 TTFB/整轮耗时，还是同时提供明确标注的“估算吞吐”？
2. 会话排行默认显示“最近使用模型”，还是显示“主要模型（Token 占比最高）”？建议默认最近模型，并加多模型标识。
3. Token 图的拖动需求是“拖动游标查看”，还是“拖框缩放时间范围”？建议先做游标，缩放作为第二阶段。
