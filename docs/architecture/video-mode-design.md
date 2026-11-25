# 通用视频提示词优化（Video Mode）架构分析与落地方案

> 文档性质：架构分析 + 功能设计 + 实施计划  
> 产品主线：通用视频提示词优化；桌宠动画仅作为端到端测试案例  
xia> 目标程序：Prompt Optimizer v2.15.2  
> 源码位置：`E:\prompt-optimizer-2.15.2`  
> 线上仓库：<https://github.com/linshenkx/prompt-optimizer>  
> 参考探索：`E:\pet-motion-prompt`（桌宠动画提示词编译器，详见 3.6 与附录 D）  
> 编写日期：2026-11-12  
> 文档版本：v0.1（草案）  
> 说明：本文基于对上述源码的静态阅读；当前开发机尚未启用 pnpm，因此尚未实际启动应用做运行验证。文中的命令和验收步骤以“环境修好后可以照着执行”为目标。

---

## 0. 结论摘要（先看这一节）

### 0.1 要做的功能

在现有主导航的 **基础（Basic）／上下文（Context）／图像（Image）** 之外，新增一个一级模式 **视频（Video）**：

- 用户输入“视频要求”的文本；
- 可选上传 0～4 张参考图；
- 系统先用文本模型把要求优化成更完整的视频提示词（主体、动作、场景、镜头、光线、风格、时长、画面比例等）；
- 用户选择视频模型后，直接生成一个短视频预览；
- 生成结果是**临时的**：可以预览、下载、重新生成，但不长期存进应用数据库；
- 优化后的提示词、参考图、模型选择和历史版本要能保存、恢复、收藏和备份；
- 基础/上下文/图像已有的基础能力，视频模式尽量对齐。

### 0.2 最重要的一条判断

**这不是“加一个按钮”的纯界面功能，而是新增一个一级工作区。**  
它会同时影响：导航、路由、会话保存、历史记录、收藏、评估、数据备份、模型管理、桌面版 IPC、国际化、移动端布局。根据现有代码估算，至少涉及 **30～40 个文件**。因此建议分三期做，不要一次性把所有能力都塞进去。

### 0.3 推荐路线

| 阶段 | 做什么 | 目的 |
|---|---|---|
| Phase 0 | 确认视频供应商（建议 Seedance 2.0 Fast/Flash）、额度、参考图含义、时长/比例默认值、首帧比例行为 | 先排除“API 能不能用、CORS 能不能过”的最大不确定性 |
| Phase 1 | “视频模式骨架 + 结构化视频提示词”（`VideoPromptSpec` + `structured/compact` 两种输出） | 先把导航、路由、会话、历史、收藏、i18n 跑通，不碰视频生成 |
| Phase 2 | 接入 1 家视频模型，做能力位、预检、异步生成、预览、下载、取消、基础体检；用桌宠 `shy` 案例做端到端回归 | 做出用户能真正看到的短视频结果 |
| Phase 3 | 多列对比、评估、更多供应商、桌宠测试案例复盘/可选导出、桌面/插件完善 | 对齐基础/上下文/图像的完整能力 |

### 0.4 最大风险

1. **视频文件很大**：5 秒 1080p 视频常见 5～20MB，不能像图片一样直接 base64 塞进 IndexedDB；否则会重演项目历史上“数据库膨胀到 GB 级”的问题。
2. **视频生成是异步任务**：通常要几十秒到几分钟，需要“提交任务 → 轮询进度 → 下载结果 → 可取消”的完整状态机，不能沿用图片的“一次请求直接返回”。
3. **一级模式是跨层改动**：`FunctionMode` 这个类型在 core、UI、路由、会话、收藏、评估、备份里都有分支；漏掉一处就可能出现“能进页面但保存/恢复/收藏失效”。
4. **供应商差异大**：鉴权、任务接口、返回格式、URL 有效期、是否支持参考图、是否支持音频都不一样，必须用适配器隔离。

### 0.5 已确认与仍待决定

已确认：**产品主线是通用视频提示词优化；桌宠动画只作为端到端测试案例，不进入通用主流程。**

仍待决定（详见 [第 9 节](#9-需要你决定的问题)）：**用哪家视频供应商、参考图角色的默认策略、生成结果要不要长期保存**。

---

## 1. 需求定义

### 1.1 用户故事

> 作为一个不熟悉视频提示词的用户，我输入一句视频创意和几张参考图，选择视频模型；系统先帮我把提示词补全为包含主体、动作、镜头、光线、风格、时长、画面比例的完整描述；然后我直接生成一个短视频预览，满意就下载，不满意就继续迭代。

### 1.2 功能范围

#### MVP（第一期必须有的）

- 新增一级模式“视频”，有独立路由和独立工作区；
- 视频要求文本输入，支持变量语法（沿用现有变量系统）；
- 可选参考图上传（建议 0～4 张，沿用现有图片压缩/上传能力），并声明用途（`subject/style/first_frame/last_frame`）；
- 文本优化模型选择 + 视频提示词模板选择；
- 可选的结构化视频规格（MVP 先做 6 类：subject/framing/camera/motion/style/negative）；
- `structured`（十段式）与 `compact`（一段大白话）两种提示词输出；
- 一键优化、流式显示优化后的提示词；
- 迭代优化、版本历史、历史复用；
- 会话自动保存/恢复（文本、规格、参考图引用/角色、模型选择、参数）；
- 收藏提示词（提示词 + 参考图；不收藏视频文件）；
- 中/英/繁三语文案；
- 移动端可用；
- 视频生成：至少 1 家供应商，异步任务、进度、预览、下载、取消、失败提示；
- 生成前预检：比例/首帧/时长/能力位；生成后基础体检：时长/分辨率/音频/URL 过期；
- 生成结果临时保存：刷新后提示“结果已过期”，不崩溃、不丢提示词。

#### 后续增强（Phase 3 或更晚）

- 2 列视频对比（A/B）；
- 提示词评估（prompt-only）；
- 视频结果评估（需要视频理解模型）；
- 参考图角色：首帧、尾帧、主体、风格；
- 音频/对白/音效；
- 多镜头/分镜脚本；
- 更多视频供应商；
- 浏览器插件内的视频生成（受 CORS 限制，见风险）；
- MCP 暴露“视频提示词优化”工具（生成能力暂不暴露）。

#### 明确不做（至少这一版不做）

- 视频剪辑时间线、拼接、转场；
- 局部重绘、蒙版、抠像、口型同步、超分；
- 长视频（几分钟以上）；
- 多人协作、云端项目空间；
- 把生成的视频文件长期存进应用数据库。

### 1.3 与现有三种模式的能力对齐

“支持那三个功能都有的基础功能”落地为下面这张表。✅ 表示目标支持，◐ 表示分阶段支持，— 表示不做。

| 能力 | 基础 Basic | 上下文 Context | 图像 Image | 视频 Video（目标） |
|---|---|---|---|---|
| 提示词输入 | ✅ | ✅ | ✅ | ✅ |
| 模板选择 | ✅ | ✅ | ✅ | ✅ |
| 文本模型选择 | ✅ | ✅ | ✅ | ✅ |
| 一键优化 / 迭代 | ✅ | ✅ | ✅ | ✅ |
| 优化历史 / 版本链 | ✅ | ✅ | ✅ | ✅ |
| 会话自动保存/恢复 | ✅ | ✅ | ✅ | ✅（不保存视频字节） |
| 测试 / 生成 | 文本测试 | 多轮测试 | 图像生成 | 视频生成（异步） |
| 结构化提示词规格 | — | — | — | ✅（可选高级层） |
| 参考图角色声明 | — | — | ◐（多图但无角色） | ✅（subject/style/first_frame/last_frame） |
| 生成前预检 | — | — | ◐（格式/大小） | ✅（比例/首帧/时长/能力位） |
| 生成后基础体检 | — | — | ◐（预览） | ✅（时长/分辨率/音频/URL 过期） |
| 多列对比 | ✅ | ✅ | ✅ | ◐ Phase 3（建议先 2 列） |
| 评估 | ✅ | ✅ | ✅ | ◐ 先做提示词评估，视频结果评估后续 |
| 收藏 | ✅ | ✅ | ✅ | ✅（提示词 + 参考图；视频文件不收藏） |
| 数据备份 | ✅ | ✅ | ✅ | ✅（模型配置 + 提示词/参考图；视频文件不备份） |
| 移动端 | ✅ | ✅ | ✅ | ✅ |
| Web / 桌面 / 插件 | ✅ | ✅ | ✅ | ◐ Web/桌面优先；插件受 CORS 影响 |

### 1.4 关键产品决策

| 决策 | 建议 | 理由 |
|---|---|---|
| 本次产品主线是什么？ | **通用视频提示词优化**；桌宠动画只作为端到端测试案例，不做成用户必填的产品预设 | 你的目标是主页面通用视频能力；桌宠案例用来验证“结构化规格 + 参考图 + 动作描述”是否真的有用，不把 384×512/基线/bounds.txt 带进主流程。 |
| 一个视频工作区，还是拆成“文生视频/图生视频/多图参考”三个子模式？ | **先做一个 `/video/create` 工作区**，参考图可选 0～4 张 | 用户描述的是一个连续流程“要求 + 参考图”；先拆三个子模式会让路由、会话、导航、测试成倍增加。等供应商能力明确后再拆。 |
| 视频提示词输出成什么形态？ | **结构化规格 + 两种提示词风格**：`structured`（十段式，可复现）和 `compact`（一段大白话，动作更听劝），默认 `auto` | 参考 `pet-motion-prompt` 的实测：长提示词+时间切片会让模型只做保守微动；但结构化规格更利于编辑、校验和复用。 |
| 参考图的含义 | MVP 提供 4 个可选角色：`subject`（角色外观）、`style`（画风）、`first_frame`（首帧）、`last_frame`（末帧）；默认 `subject`，不强制 | `pet-motion-prompt` 证明“多图不声明角色，模型会串脸/串风格”。这比单纯按上传顺序更可控。 |
| 生成结果是否长期保存 | **不保存视频字节**；只保留本次会话的临时地址/海报图 | 视频太大，IndexedDB 不适合；也符合“临时的生成结果”的描述。 |
| 默认时长/比例/分辨率 | 通用默认 5 秒、16:9、720p、1 条、无音频；桌宠测试案例用 4 秒、3:4、480p/720p | 测试案例的画布契约不同；用测试配置区分，不把桌宠默认值写进通用产品。 |
| 生成后要不要做“结果体检”？ | MVP 做基础体检：时长/分辨率/比例/音频/文件大小/URL 过期；完整 QA（循环、抠图、基线）放 Phase 3 或独立工具 | 视频生成的不确定性比图片高；至少要让用户知道“结果哪里不对”。 |
| 是否自动重试 | 不自动重试 | 视频生成通常按次计费，自动重试可能产生意外费用。 |
| 插件是否支持生成 | 先保证 Web/桌面；插件做“能打开、能优化提示词”，生成失败时提示改用桌面版 | 浏览器插件受跨域和权限限制；不必要的 host 权限会影响上架审核。 |
| 是否把 `pet-motion-prompt` 整体搬进来？ | **不整体搬**；借鉴它的“规格 + 能力位 + 预检 + 结果体检”，桌宠后处理只作为测试案例/外部工具 | 它是 Python + ffmpeg + Pillow 的独立流水线，主应用是 TypeScript/浏览器；直接搬会破坏架构。 |

---

## 2. 现有架构回顾

这一节是“现有程序是怎么搭的”，也是上一轮分析的文字版记录。第 3 节开始才是视频模式的具体设计。

### 2.1 四层结构

可以把它想成一家餐厅：

```text
不同门店：网页 / 浏览器插件 / 桌面窗口 / MCP 对外窗口
                    ↓
前台与菜单：共享界面 ui（页面、按钮、会话、多语言）
                    ↓
中央厨房：核心引擎 core（优化流程、模型、模板、历史、收藏、存储）
                    ↓
食材供应：各家 AI 服务商 / 本地数据库 / 本地文件
```

- **core** 是“中央厨房”，负责真正做菜；
- **ui** 是“前台”，负责点单、上菜、记住客人当前点到哪一步；
- **web / extension / desktop / mcp-server** 是“不同门店”，只负责开门营业和平台差异；
- **adapter（适配器）** 是“电源转换插头”，把统一请求转换成各家 AI 能听懂的格式。

### 2.2 模块清单

#### 运行外壳

| 模块 | 对应功能 | 位置 |
|---|---|---|
| Web 应用 | 浏览器打开即用；可安装成 PWA，支持离线 | `packages/web` |
| Chrome 插件 | 点插件图标，新开一个完整页面使用；不读取其他网页 | `packages/extension` |
| 桌面应用 | Windows/macOS/Linux 安装包；本地文件、自动更新、网络设置 | `packages/desktop` |
| MCP 服务 | 让 Claude Desktop 等外部工具调用 3 个文本优化工具 | `packages/mcp-server` |
| 部署配置 | Docker、Vercel、Cloudflare 上线；访问密码 | 根目录 `Dockerfile`、`docker/`、`middleware.js`、`vercel.json`、`wrangler.jsonc` |

#### 共享界面

| 模块 | 对应功能 | 位置 |
|---|---|---|
| 应用骨架与导航 | 顶部 Basic/Pro/Image 模式切换；收藏、历史、模板、模型、数据管理入口 | `packages/ui/src/components/app-layout` |
| 路由与工作区 | 9 个主页面：基础系统/基础用户、Pro 多消息/变量、图像文生图/图生图/多图、竞技场、收藏 | `ui/src/router`、`components/basic-mode`、`context-mode`、`image-mode`、`arena-mode`、`favorites` |
| 会话状态 | 自动保存/恢复输入、结果、测试列、模型选择 | `ui/src/stores/session` |
| 交互逻辑 | 把“点击优化/迭代/测试/评估”翻译成 core 调用，把流式结果放回页面 | `ui/src/composables` |
| 组件库 | 输入框、结果框、测试区、模型/模板/变量/收藏/数据管理弹窗 | `ui/src/components` |
| 界面辅助服务 | 导入导出、变量抽取、模板增强、图像风格提取 | `ui/src/services` |
| 多语言与主题 | 中/英/繁三语；明暗主题 | `ui/src/i18n`、`config/naive-theme` |
| 外部集成 | Prompt Garden 提示词库导入、收藏预览插件 | `ui/src/integrations` |

#### 核心引擎

| 模块 | 对应功能 | 位置 |
|---|---|---|
| 提示词服务 | 一次优化、迭代、测试的总调度 | `packages/core/src/services/prompt` |
| AI 通信 | 统一调用约 17 种文本接入方式、约 10 种图像接入方式；流式、工具调用 | `core/src/services/llm`、`image`、`image-understanding` |
| 模型管理 | 文本/图像模型配置、默认值、启停、参数校验 | `core/src/services/model`、`image-model` |
| 模板管理 | 内置/用户模板、模板语言、变量替换 | `core/src/services/template` |
| 历史记录 | 优化版本链 v0/v1/v2… | `core/src/services/history` |
| 收藏资产 | 收藏、分类、标签、媒体、版本 | `core/src/services/favorite` |
| 上下文与变量 | Pro 模式的消息、变量、工具定义；变量提取与变量值生成 | `core/src/services/context`、`variable-extraction`、`variable-value-generation` |
| 评估与对比 | AI 评分、多结果对比、文本差异 | `core/src/services/evaluation`、`compare` |
| 存储、偏好、备份 | 浏览器数据库/文件、设置项、整包导入导出 | `core/src/services/storage`、`preference`、`data` |
| 标准数据模型 | 统一的提示词资产结构，供收藏、历史、会话共用 | `core/src/services/prompt-model` |

### 2.3 模块职责与边界

| 模块 | 负责什么 | 边界：不负责什么 |
|---|---|---|
| core 提示词服务 | 把模板、模型、输入组装成一次请求；校验空输入/空结果；统一包装错误 | 不画界面；不决定按钮位置；不直接读写浏览器数据库；不保存 UI 会话 |
| core AI 通信与适配器 | 把统一消息转成各家 API 格式；处理流式、工具调用、错误 | 不选模板；不存历史；不实现评分规则 |
| core 模型/模板管理 | 保存配置、默认值、启停、参数校验；列出可用模板 | 不发起 AI 请求；不渲染下拉框 |
| core 历史/收藏/上下文 | 版本链、收藏资产、Pro 变量与消息的持久化和查询 | 不决定页面展示顺序；不做 AI 生成；不管理主题 |
| core 存储/偏好/备份 | 统一键值存取；屏蔽 localStorage、IndexedDB、文件存储差异；整包导入导出 | 不懂业务含义；不校验提示词质量；不负责界面提示文案 |
| ui 骨架与路由 | 页面拼装、模式切换、弹窗入口、网址与页面对应 | 不直接调用 AI 厂商 SDK；不实现业务规则 |
| ui 工作区与会话 | 用户动作→服务调用；流式结果→页面；自动保存/恢复现场 | 不实现 AI 协议；不直接操作数据库；不定义模型参数 |
| ui 组件与语言包 | 展示、交互、三语文案、主题 | 不包含业务流程；不直接读写存储 |
| 运行外壳 | 启动、打包、平台差异、权限 | 不复制业务逻辑；不重复实现页面 |
| 桌面主进程与 preload | 文件、网络、自动更新、本地服务发现；通过 IPC 暴露安全接口 | 不做页面；不决定业务规则 |
| MCP 服务 | 协议转换、参数校验，把 core 能力暴露成工具 | 不做 UI；不复刻优化逻辑 |

**一句话原则：** core 像中央厨房，ui 像前台，外壳像不同门店。菜谱和做菜在中央厨房，前台只负责点单和上菜；加功能时不要在前台重新做一遍菜。

### 2.4 依赖关系

#### 包与包

```text
网页 web ─────────┐
浏览器插件 extension ─┼──> 共享界面 ui ──> 核心引擎 core ──> 各家 AI 服务
桌面窗口（渲染进程） ─┘                         │
                                                ├──> 浏览器 IndexedDB/localStorage
                                                └──> 桌面文件存储

桌面主进程 desktop ─────────────────────────────> core ──> 文件/AI 服务
MCP 服务 mcp-server ───────────────────────────> core
```

> 桌面版比较特殊：界面不直接调用 core，而是通过 `preload` 安全桥接，把请求转给主进程。这样文件、密钥、系统权限都留在主进程。

#### 一次“优化提示词”的完整链路

1. 用户在输入框输入提示词，选择模型和模板。
2. 工作区组件把动作交给 `usePromptOptimizer` 这类交互逻辑。
3. 交互逻辑组装请求，调用 `PromptService.optimizePromptStream`。
4. `PromptService` 从 `TemplateManager` 取模板，从 `ModelManager` 取模型配置。
5. `LLMService` 根据模型厂商选择适配器，适配器调用真实 AI 服务。
6. AI 返回的文字以流式方式回到页面，显示在结果区。
7. 完成后，`HistoryManager` 创建版本链；会话状态通过 `PreferenceService` 写入本地存储。

#### 改动影响面

- 改 **core**：网页、插件、桌面、MCP 全都会受影响。
- 改 **ui**：网页、插件、桌面都会受影响；桌面还需要重新打包。
- 改 **外壳**：只影响对应的那一个门店。
- 改 **数据字段**：还要考虑旧备份、旧会话、旧收藏能否继续读。

### 2.5 现有扩展点与推荐度

| 推荐度 | 扩展点 | 适合加什么 | 具体位置 | 为什么 / 条件 |
|---|---|---|---|---|
| ★★★★★ P0 | 模板/配方级 | 新的优化风格、行业模板、评估模板 | `core/src/services/template/default-templates/**` + `index.ts` | 引擎已支持；不动界面；最容易先做出效果 |
| ★★★★★ P0 | 现有页面加按钮/面板 | 复制、批量、导出、额外信息 | 对应 `components/*-mode/*.vue`；全局入口可改 `WorkspaceUtilityMenu.vue` 或 `AppHeaderActions.vue` | 复用现有服务；不新增持久化；通常 1～2 个文件 |
| ★★★★★ P0 | 展示/交互增强 | Markdown、差异、全屏、快捷键 | `OutputDisplay*.vue`、`PromptPanel.vue`、`TestAreaPanel.vue` | 纯前端；风险最低；注意移动端 |
| ★★★★ P1 | 新数据字段/导出格式 | 收藏加字段、导出 CSV/JSON | `core/src/interfaces/import-export.ts` + 对应 manager + `DataManager` | 要兼容旧备份；需要新增/迁移测试 |
| ★★★★ P1 | 新文本模型厂商 | 接入一家新 AI | `core/src/services/llm/adapters/*` + `registry.ts` + `model/defaults.ts` | 有 API 文档和密钥；只需实现适配器 |
| ★★★ P1 | 新图像模型/能力 | 新文生图、图生图服务 | `core/src/services/image/adapters/*` + `image-model` + UI `ImageModelManager.vue` | 有图像 API；要测尺寸、参数、下载 |
| ★★★ P1 | 新评估规则 | 新评分维度、评审角色 | `core/src/services/evaluation` + `default-templates/evaluation` + UI `components/evaluation` | 评分标准要先写清楚 |
| ★★★ P1 | 新 MCP 工具 | 让外部工具多一个能力 | `mcp-server/src/index.ts` + `adapters/parameter-adapter.ts` | 无 UI；要按 MCP 协议测试 |
| ★★ P2 | 新一级模式/工作区 | 视频模式、批量模式、Agent 模式 | `FunctionMode` 类型、`router/index.ts`、`AppCoreNav.vue`、`useSessionManager.ts`、新 session store、i18n、history 类型 | 跨 30+ 文件；要先设计状态与导航 |
| ★★ P2 | 桌面独有能力 | 本地文件、托盘、自动更新 | `desktop/main.js`、`preload.js`、core `electron-proxy.ts`、UI | 需要 Windows/macOS 实机测试 |
| ★ P2 | 存储结构/迁移 | 改数据库键、字段、备份格式 | `core/src/services/storage`、`preference`、`data` | 数据丢失风险最高；必须备份+迁移+回滚 |

**视频模式属于 P2 的“新一级模式”，所以必须按“先骨架、后生成、再补齐”的顺序做。**

---

## 3. 视频模式总体设计

### 3.1 页面结构

```text
┌────────────────────────────────────────────────────────────────────┐
│ 顶部：Basic | Context | Image | Video | Arena                      │
├──────────────────────────────────┬─────────────────────────────────┤
│ 左：提示词优化区                  │ 右：视频生成与预览区             │
│ ┌──────────────────────────────┐ │ ┌─────────────────────────────┐ │
│ │ 视频要求（文本输入，支持变量） │ │ │ 参考图预览（0～4 张）        │ │
│ │ [textarea]                   │ │ │ [缩略图] [添加/删除]         │ │
│ │ 参考图上传（可选）            │ │ ├─────────────────────────────┤ │
│ │ 文本模型 / 模板 / 优化按钮    │ │ │ 视频模型 / 时长 / 比例 / 分辨率│ │
│ └──────────────────────────────┘ │ │ [生成视频] [取消]            │ │
│                                  │ ├─────────────────────────────┤ │
│ 优化后的提示词 + 迭代 + 版本历史  │ │ <video> 预览 / 状态 / 下载    │ │
│                                  │ │ 结果临时有效，刷新可能过期    │ │
└──────────────────────────────────┴─────────────────────────────────┘
```

左侧沿用现有 `PromptPanel`／`OptimizeWorkspaceLayout` 的交互；右侧沿用图像模式的“配置 + 结果”结构，但把图片结果换成视频播放器。

### 3.2 用户操作流程

1. 用户点击顶部“视频”，进入 `/video/create`。
2. 输入视频要求，例如：“一只黑猫在雨夜的霓虹街头走路，电影感，镜头跟着猫移动。”
3. 可选上传参考图；界面提示“第 1 张通常作为首帧/主体参考”。
4. 选择文本优化模型和视频提示词模板，点击“优化提示词”。
5. 左侧流式显示优化后的提示词；可继续“迭代”，可切换版本，可保存收藏。
6. 右侧选择视频模型，设置时长/比例/分辨率；点击“生成视频”。
7. 状态依次显示：提交中 → 排队中 → 生成中（进度/已用时）→ 成功/失败/取消。
8. 成功后显示视频播放器、封面、下载按钮；可“重新生成”。
9. 刷新页面：提示词、参考图、模型选择、参数恢复；视频结果如果已过期，显示“结果已过期，请重新生成”，不崩溃。
10. 用户可把提示词收藏；收藏里保留提示词和参考图，不保留视频文件。

### 3.3 方案选择：单工作区 vs 多子模式

#### 方案 A：单工作区（推荐）

- 路由：`/video/create`；
- 一个 `VideoCreateSession`；
- 参考图可选 0～4 张；
- 视频模型能力决定“是否必须上传参考图”。

**优点：**
- 与用户描述的“输入要求和参考图”完全一致；
- 少 2 个路由、少 2 套会话恢复逻辑；
- 顶部导航只多一个“视频”，移动端压力小；
- 供应商能力尚未确定时，不会把产品结构锁死。

**缺点：**
- “文生视频/图生视频”的区别只能靠模型能力和 UI 提示表达；
- 未来如果要拆，需要迁移会话键。

#### 方案 B：三个子模式（文生视频/图生视频/多图参考）

- 路由：`/video/text2video`、`/video/image2video`、`/video/reference2video`；
- 更贴近图像模式的 `text2image/image2image/multiimage`。

**优点：**
- 模式边界清晰，模型能力校验更直接；
- 未来扩展参考图角色更方便。

**缺点：**
- 3 个路由、3 套会话/模板/导航/测试；
- 用户要在三个入口之间选，增加理解成本；
- 目前还不确定供应商是否真的区分这三种能力，容易过度设计。

**结论：先做方案 A。** 在代码里保留 `VideoSubMode = 'create'` 的类型，未来可以扩展成三个子模式而不用推翻数据结构。

### 3.4 视频任务状态机

视频生成和图片生成最大的不同：它不是“一次请求直接返回”，而是“提交任务 → 轮询 → 拿结果”。

```text
idle
  │ 点击生成
  ▼
submitting ──失败──> failed
  │ 提交成功
  ▼
queued
  │ 供应商开始处理
  ▼
running ──失败──> failed
  │ 完成
  ▼
succeeded

任意进行中状态 ──用户取消──> cancelling ──> cancelled
```

UI 需要展示：

| 状态 | 用户看到什么 | 可做什么 |
|---|---|---|
| `idle` | 还没有生成 | 设置参数、点击生成 |
| `submitting` | “正在提交任务…” | 等待 |
| `queued` | “排队中，前面还有任务…” | 取消 |
| `running` | “生成中，已用时 00:35” + 进度条（如果有） | 取消 |
| `succeeded` | 视频播放器 + 下载 | 重新生成、下载、复制链接 |
| `failed` | 错误原因 + 重试 | 重试、修改参数 |
| `cancelled` | “已取消” | 重新生成 |
| `expired` | “上次结果已过期” | 重新生成 |

轮询建议：

- 首次 3 秒后查询，之后 5 秒一次；
- 连续多次无进度时退避到 10 秒；
- 总超时 10～15 分钟（按供应商调整）；
- 页面隐藏时降低轮询频率，避免后台耗电；
- 用户离开工作区时，任务可以继续在 store 内存里跑；应用关闭则丢失（MVP 可接受）。

### 3.5 “临时结果”的生命周期

这是视频模式最重要的设计约束。

```text
生成成功
  │
  ├─ 如果返回的是二进制/Blob：创建 URL.createObjectURL(blob)
  │     └─ 替换结果、清空内容、组件卸载时 revokeObjectURL
  │
  ├─ 如果返回的是供应商 URL：直接放入 <video src="...">
  │     └─ 记录 expiresAt；过期后显示“结果已过期”
  │
  └─ 可选：抽取/保存一张封面图到 ImageStorageService
        └─ 只保存小图，不保存视频字节
```

明确规则：

1. **不把视频 base64 写进 IndexedDB。**
2. **会话快照只保存任务元数据**：`jobId`、`status`、`providerUrl`、`expiresAt`、`posterAssetId`、模型 key、参数、开始时间。
3. **刷新后不自动恢复播放**：如果 URL 还有效，可以显示；否则显示“已过期”。不做自动重新提交，避免意外扣费。
4. **下载是用户主动行为**：用 `<a download>` 或 Blob 下载；桌面版可通过主进程代理下载。
5. **清空内容时释放对象 URL**，避免内存泄漏。
6. **数据备份不包含视频文件**；只包含提示词、参考图引用、模型配置和任务元数据。

### 3.6 对 `E:\pet-motion-prompt` 的复核与设计修正

我读了该目录的 `README.md`、`AGENTS.md`、`docs/01`～`07`、`schemas/pet-clip.schema.json`、`examples/characters/whale_girl/shy.yaml`、`compiled/shy/prompt.md`、`params.json`、`plan.json`、`out/doubao/REPORT.md`。

先给结论：**它不是“视频生成器”，而是“视频提示词规格编译器 + 生成后处理/验收流水线”。** 它不调用模型生成视频，而是把一句“让它害羞一下”编译成：

```text
clip.yaml（PetClipSpec 规格）
  → prompt.md（十段式提示词）
  + params.json（模型/时长/比例/分辨率/seed/能力位）
  + plan.json（帧数/时间轴/缩放推导）
  + assumed.json（哪些字段是默认补的）
```

然后人工把 prompt 粘进豆包/Seedance 生成 mp4，再用 `petmotion post` 抽帧、抠图、对齐、导出，最后 `petmotion qa` 用 14 项指标判定“能不能用”。

#### 3.6.1 它已经验证了什么

| 观察 | 证据 | 对本项目的含义 |
|---|---|---|
| 视频提示词需要 10 类硬约束 | `docs/02-video-spec.md`：身份、构图、机位、背景、动作、时间、循环、风格、技术、负面 | 视频模式不能只做“写得更丰富”，要有可编辑的结构化规格 |
| 参考图必须声明用途 | `subject / style / motion / first_frame / last_frame` | 参考图上传要加“用途”，否则多图会串脸/串风格 |
| 结构化提示词和紧凑提示词效果不同 | `render.promptStyle: sections / compact`；`AGENTS.md` 明确 compact 更适合动作 | 提供两种输出风格，不要只做一种 |
| 首帧尺寸/比例必须等于输出 | 2:3 首帧被模型按 3:4 重构，角色横向变宽约 16% | 生成前必须做比例预检/补边，不能事后拉伸 |
| 提示词锁色不可靠 | `shy v1/v2` 调色板 TV 都是 0.321，后期直方图匹配降到 0.133 | 不要承诺“颜色完全一致”；把校色放后期或接受差异 |
| 模型不遵守“原地不动” | v2–v4 三次加强措辞都被 QA 拦下（基线漂移 18–33px） | UI 要提示“可能漂移”，并提供结果体检；不能只靠提示词 |
| 客户端会带音频/水印 | Seedance 实测：默认带 AAC 音频、右下角“豆包AI生成” | 适配器要声明能力位；UI 提示音频/水印；后处理可遮罩/去音频 |
| API 尚未打通 | `docs/04-project-plan.md` P0-05 未完成，目前是人工客户端生成 | Phase 0 必须先验证 API，不能假设“客户端能用 = API 能用” |
| 只有 1 个角色、2 个动作验证 | `docs/06-progress.md` 明确写了 | 不要把它当成“通用视频引擎”；先当设计参考 |

#### 3.6.2 应该借鉴什么

- **规格先行**：把“视频要求”拆成 `VideoPromptSpec`（主体、构图、机位、背景、动作、时间、循环、风格、技术、负面），而不是只让 LLM 写一段散文。
- **参考图角色**：`subject` 提供角色身份，`style` 只提供画风，`first_frame`/`last_frame` 提供首末帧；提示词里显式写“图片 1 提供…，图片 2 仅提供…”。
- **两种提示词风格**：`structured` 适合可复现、复杂场景；`compact` 适合动作类、模型容易“保守微动”的情况。
- **模型能力位**：适配器声明 `camera_fixed`、`frames`、`seed`、`negative_prompt`、`first_last_frame`、`audio_default` 等能力；UI 据此显示/禁用参数。
- **生成前预检**：比例、首帧尺寸、时长范围、参考图数量、提示词长度、模型能力是否匹配。
- **生成后体检**：时长、分辨率、比例、音频、文件大小、URL 过期；完整 QA（循环、抠图、基线）放独立工具。
- **可复现记录**：spec/prompt/params 的版本与 hash；如果模型支持 seed，一并记录。

#### 3.6.3 不应该直接搬什么

- **桌宠专用画布/基线**：384×512、基线 460、`bounds.txt`、10fps、`desktop_pet_image/<action>/NNN.png`。这些属于桌宠运行时，不属于通用视频模式。
- **Python 后处理链**：ffmpeg 抽帧、Pillow/numpy 抠图、OCR、SSIM/NCC 计算。主应用是 TypeScript/浏览器；直接搬会引入 Python 运行时和打包负担。
- **具体角色 profile/色板/材质**：通用视频模式不应强制用户填“头身比/材质/键色”；这些只在桌宠测试案例/未来可选预设里出现。
- **“一次生成就成功”的预期**：pet 项目实测动作幅度不可控、需要多次重试；UI 要管理预期，提供版本对比和“只改一个变量”的重试。
- **把 `petmotion` 当成主应用依赖**：它是独立程序；主应用不应在浏览器里启动 Python/ffmpeg。

#### 3.6.4 建议的集成方式

| 方案 | 做法 | 适用 | 建议 |
|---|---|---|---|
| A. 只借设计 | 在视频模式实现轻量 `VideoPromptSpec` + 两种提示词风格 + 能力位预检；不做桌宠后处理 | 通用视频提示词优化 | **先做这个** |
| B. 导出 petmotion spec | 视频模式高级面板导出 `.yaml`，交给 `petmotion compile/post/qa` | 仅测试案例/高级用户 | Phase 3 可选，不进入通用主流程 |
| C. 桌面版集成后处理 | Electron 主进程调用 ffmpeg/Python sidecar，做抽帧/抠图/QA | 长期、成本高 | Phase 3+ |
| D. 直接内嵌 Python | 在浏览器/扩展里跑 Python | 不现实 | 不推荐 |

**推荐结论：** 主应用先做 A；桌宠动画只作为测试案例，用来验证通用规格是否覆盖动作/镜头/背景/负面；只有当你明确要做“桌宠资产流水线”时，才考虑 B/C。

### 3.7 本次采用：通用为主，桌宠作为测试案例

| 维度 | 通用视频模式（产品主线） | 桌宠动画（测试案例） |
|---|---|---|
| 使用者 | 任何视频提示词用户 | 你/开发者，用于验收 |
| 输入 | 视频要求 + 可选参考图 | 一句动作 + 三视图/首帧 + 角色设定 |
| 输出 | 通用视频提示词 + 可选结构化规格 + 视频预览 | 同一套提示词，用来对照 `petmotion compile` 的产物 |
| 默认参数 | 5 秒 / 16:9 / 720p | 4 秒 / 3:4 / 720p（仅测试配置） |
| 存储 | 提示词/规格/参考图/任务元数据 | 不把帧序列/`bounds.txt`/桌宠运行时数据存进主应用 |
| 验收 | 提示词可用、生成可预览、能力位正确 | 覆盖 10 类字段，能指导动作/镜头/背景/负面；**不要求复刻 pet 后处理** |
| 不做 | 抠图/基线/帧序列/桌宠运行时 | 不进入产品默认流程 |

**一句话原则：** 产品对外是“通用视频提示词优化”；桌宠案例只负责证明这套通用能力在真实、苛刻的场景里站得住。

---

## 4. 数据与接口设计

### 4.1 核心类型改动

```ts
// core/src/services/prompt/types.ts
export type FunctionMode = 'basic' | 'pro' | 'image' | 'video' | 'arena';

/** 先只有一个 create；未来可扩展为 text2video / image2video / reference2video */
export type VideoSubMode = 'create';
```

```ts
// core/src/services/video/types.ts（新增）
import type { ImageInputRef } from '../image/types';
import type { BaseProvider } from '../shared/types';
import type { UnifiedParameterDefinition } from '../model/parameter-schema';

export interface VideoProvider extends BaseProvider {}

export interface VideoModelCapabilities {
  text2video: boolean;
  image2video: boolean;
  multiImageReference?: boolean;

  // 参数能力位：UI 按这些开关显示/禁用控件
  cameraFixed?: boolean;
  frames?: boolean;
  seed?: boolean;
  negativePrompt?: boolean;
  firstLastFrame?: boolean;
  audioDefault?: boolean;

  durations?: number[];        // 例如 [4, 5, 6, 8, 10, 15]
  aspectRatios?: string[];     // 例如 ['16:9', '9:16', '1:1', '3:4']
  resolutions?: string[];      // 例如 ['480p', '720p', '1080p']
  promptStylePreference?: 'structured' | 'compact';
  verifiedAt?: string;         // 例如 '2026-11-12'，供应商能力回归用
}

export interface VideoModel {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly providerId: string;
  readonly capabilities: VideoModelCapabilities;
  readonly parameterDefinitions: readonly UnifiedParameterDefinition[];
  readonly defaultParameterValues?: Record<string, unknown>;
}

export interface VideoModelConfig {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  enabled: boolean;
  connectionConfig?: {
    apiKey?: string;
    baseURL?: string;
    [key: string]: unknown;
  };
  paramOverrides?: Record<string, unknown>;
  provider: VideoProvider;
  model: VideoModel;
}

export interface VideoRequest {
  configId: string;
  modelId?: string;
  configSnapshot?: VideoModelConfig; // 请求级快照，不落盘
  prompt: string;
  inputImages?: ImageInputRef[];     // 0～4 张参考图，顺序必须与 references 一致
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  negativePrompt?: string;
  seed?: number;
  paramOverrides?: Record<string, unknown>;
}

// 注意：多数视频 API 只接受“有序图片数组”，不提供 role 字段。
// `VideoPromptSpec.references[].role` 用于生成提示词和 UI 排序；
// 发送时按相同顺序映射到 `inputImages`。适配器如支持显式角色，可在自己的请求体里使用。

export type VideoJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface VideoResultItem {
  url?: string;
  /** 仅运行时持有，不落盘；桌面端应优先转换成临时 URL */
  bytes?: ArrayBuffer;
  mimeType?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  posterUrl?: string;
}

export interface VideoJob {
  jobId: string;
  status: VideoJobStatus;
  progress?: number;                 // 0～100，可选
  video?: VideoResultItem;
  error?: { code: string; params?: Record<string, unknown> };
  metadata?: {
    providerId: string;
    modelId: string;
    configId: string;
    createdAt?: number;
    expiresAt?: number;
    [key: string]: unknown;
  };
}

export interface IVideoService {
  generate(request: VideoRequest): Promise<VideoJob>;
  getJob(jobId: string, configId: string): Promise<VideoJob>;
  cancelJob(jobId: string, configId: string): Promise<void>;
  testConnection(config: VideoModelConfig): Promise<VideoJob>;
  getDynamicModels(providerId: string, connectionConfig: Record<string, unknown>): Promise<VideoModel[]>;
  validateRequest(request: VideoRequest): Promise<void>;
}
```

### 4.2 适配器接口

```ts
// core/src/services/video/adapters/abstract-adapter.ts
export interface IVideoProviderAdapter {
  getProvider(): VideoProvider;
  getModels(): VideoModel[];
  getModelsAsync(connectionConfig: Record<string, unknown>): Promise<VideoModel[]>;
  buildDefaultModel(modelId: string): VideoModel;

  createJob(request: VideoRequest, config: VideoModelConfig): Promise<VideoJob>;
  getJob(jobId: string, config: VideoModelConfig): Promise<VideoJob>;
  cancelJob?(jobId: string, config: VideoModelConfig): Promise<void>;
}
```

设计原则与现有 `ImageProviderAdapter` 一致：

- **适配器**只负责“这家供应商怎么提交、怎么查、怎么取消、怎么解析返回值”；
- **VideoService** 负责校验、配置读取、错误包装、轮询辅助；
- **VideoModelManager** 只负责配置 CRUD，不发请求；
- **UI** 不直接调用供应商 API。

### 4.3 视频模型管理

参照 `ImageModelManager`：

```text
VideoModelManager
  ├─ getAllConfigs()
  ├─ getEnabledConfigs()
  ├─ getConfig(id)
  ├─ addConfig(config)
  ├─ updateConfig(id, patch)
  ├─ deleteConfig(id)
  ├─ exportData()/importData()/validateData()
  └─ ensureInitialized()  // 写入默认配置
```

默认配置来源：

```ts
// core/src/services/video-model/defaults.ts
const VIDEO_PROVIDER_ENV_KEYS = {
  gemini: ['VITE_GEMINI_API_KEY'],
  seedance: ['VITE_SEEDANCE_API_KEY', 'VITE_ARK_API_KEY'],
  // 以后按需添加
};
```

> `VITE_SEEDANCE_API_KEY` 是占位名，实际以供应商文档为准；如果与现有 Seedream 共用 ARK 平台，可复用 `VITE_ARK_API_KEY`。  
> 具体先接哪家见 [第 9 节](#9-需要你决定的问题)。适配器隔离做好后，换供应商不需要改 UI 和会话结构。

`pet-motion-prompt` 已经用 YAML 记录过 Seedance 的能力位，建议主应用照这个形状实现：

```yaml
id: seedance_2_flash
display_name: Seedance 2.0 Fast
provider: doubao
ratios: ["3:4", "4:3", "1:1", "9:16", "16:9", "21:9"]
durations_sec: [4, 5, 6, 8, 10, 15]
audio_default: true
supports:
  camera_fixed: false
  frames: false
  seed: false
  negative_prompt: false
  first_last_frame: false
verified_at: "2026-11-12"
notes: "客户端实测；API 行为需 Phase 0 再确认"
```

> YAML 里的 `camera_fixed`/`first_last_frame` 对应 TS 里的 `cameraFixed`/`firstLastFrame`；实现时只保留一套命名映射，不要两套混用。

UI 的行为应该是：

- `seed: false` → 隐藏 seed 输入，或显示“该模型不支持固定 seed”；
- `negative_prompt: false` → 把 `[AVOID]` 追加到主提示词，不显示独立负向输入；
- `first_last_frame: false` → 不允许选择“首尾帧”模式，只允许普通参考图；
- `audio_default: true` → 明确提示“可能带音频”，并给出下载/静音说明；
- `camera_fixed: false` → 不承诺镜头完全固定，预检提示风险。

### 4.4 会话快照

新增 `session/v1/video-create`：

```ts
interface VideoCreateSessionState {
  originalPrompt: string;
  optimizedPrompt: string;
  reasoning: string;
  chainId: string;
  versionId: string;

  // 运行时持有 b64；持久化只保存 assetId
  inputImages: Array<{
    assetId: string;
    b64?: string;
    mimeType?: string;
    role: VideoReferenceRole; // subject/style/first_frame/last_frame
  }>;

  selectedTextModelKey: string;
  selectedVideoModelKey: string;
  selectedTemplateId: string | null;
  selectedIterateTemplateId: string | null;

  // 结构化规格（可选；普通用户可只保留 optimizedPrompt）
  promptSpec?: VideoPromptSpec;
  promptStyle?: 'structured' | 'compact' | 'auto';

  params: {
    duration: number;
    aspectRatio: string;
    resolution: string;
    seed?: number;
    negativePrompt?: string;
    audio?: boolean;
  };

  // 只保存任务元数据，不保存视频字节
  lastJob?: {
    jobId: string;
    status: VideoJobStatus | 'expired';
    videoUrl?: string;
    posterAssetId?: string;
    expiresAt?: number;
    modelKey: string;
    startedAt: number;
  };

  lastActiveAt: number;
  assetBinding?: PromptAssetBinding;
  origin?: PromptSessionOrigin;
}
```

要点：

- **参考图**复用现有 `ImageStorageService`，和图像模式一样保存为 `assetId`；
- **视频结果**不进入 `ImageStorageService`；
- **刷新恢复**时，如果 `lastJob.videoUrl` 存在且未过期，可以显示；否则标记 `expired`；
- **清空内容**时释放对象 URL，并删除不再被引用的参考图（交给现有 GC）。

### 4.5 历史、收藏、评估、备份

#### 历史记录

```ts
// core/src/services/history/types.ts
export type PromptRecordType =
  | ... // 现有类型
  | 'videoOptimize'
  | 'videoIterate';
```

记录元数据建议：

```ts
metadata: {
  functionMode: 'video',
  videoModelKey: string,
  hasReferenceImages: boolean,
  referenceRoles?: string[], // subject/style/first_frame/last_frame
  promptStyle?: 'structured' | 'compact' | 'auto',
  specVersion?: string,      // 例如 video-spec/v1
  duration: number,
  aspectRatio: string,
  resolution: string,
  jobId?: string,            // 便于排查，不用于恢复视频
}
```

只记录“提示词版本”，不记录视频文件。这样历史抽屉仍然轻量。

#### 收藏

```ts
// core/src/services/favorite/types.ts
functionMode: 'basic' | 'context' | 'image' | 'video';
videoSubMode?: 'create';
```

收藏内容：

- 优化后的提示词文本；
- 原始提示词；
- 参考图（复用 `metadata.media.assetIds`）；
- 模型/模板信息；
- 可选：视频封面图（小图），不收藏视频文件。

#### 评估

```ts
// core/src/services/evaluation/types.ts
export type EvaluationSubMode = BasicSubMode | ProSubMode | ImageSubMode | VideoSubMode;

export interface EvaluationModeConfig {
  functionMode: 'basic' | 'pro' | 'image' | 'video';
  subMode: EvaluationSubMode;
}
```

MVP 先支持 `prompt-only`（只评估提示词，不需要视频结果）。视频结果评估需要视频理解模型，放到 Phase 3。

#### 数据备份

`DataManager` 增加 `videoModels` 段：

```ts
data['videoModels'] = await this.videoModelManager?.exportData();
```

`WorkspaceSessionTransfer` 增加 `video-create`：

- 导出/导入 `session/v1/video-create`；
- 校验 `originalPrompt`、`optimizedPrompt`、`inputImages`、`lastJob` 等字段；
- **不校验/不包含视频字节**；
- 旧备份没有 `videoModels` 时，导入仍要成功。

> 注意：`workspace-session-transfer.ts` 里现在的校验逻辑有 `mode.startsWith('image-')` 的分支；视频模式要显式加入，不能假设所有带图模式都是 `image-`。

### 4.6 兼容性策略

1. **旧数据不受影响**：新增字段都有默认值；旧备份没有 `videoModels` 时跳过。
2. **新数据被旧版本读取**：旧版本会拒绝未知的 `video` 模式/备份段，这是预期行为；文档要提示“降级前先导出备份”。
3. **Phase 1 复用 `image-prompt` 内容容器**：视频提示词本质是“文字 + 参考图”，先复用 `PromptContent.kind = 'image-prompt'`，避免改动所有内容消费方；用 `modeKey = 'video-create'` 区分。Phase 3 如需更强类型，再加 `video-prompt`。
4. **会话键只增不改**：`session/v1/video-create` 一旦发布，不再改名；未来拆子模式时做迁移。

### 4.7 视频提示词规格（从 `pet-motion-prompt` 泛化）

不建议把 `PetClipSpec` 原样搬进主应用，因为里面包含桌宠专用的画布、基线、运行时导出。建议抽出一个**通用视频规格**，作为“高级面板”的可选数据结构；普通用户仍然只填一句要求。

```ts
// core/src/services/video/prompt-spec.ts（新增）
export type VideoReferenceRole =
  | 'subject'     // 角色/主体外观
  | 'style'       // 画风/材质
  | 'first_frame' // 首帧
  | 'last_frame'; // 末帧
// 说明：pet 项目里的 `motion` 参考需要“视频输入”，MVP 不做；
// 这里只保留图片能承担的角色。

export interface VideoPromptSpec {
  subject: {
    description: string;
    mustKeep?: string[];
    mustNotChange?: string[];
  };
  framing: {
    shot?: 'wide' | 'full' | 'medium' | 'close_up' | 'extreme_close_up';
    subjectHeightRatio?: number; // 0–1，可选
    baselineY?: number;          // 0–1，仅动画测试案例/未来预设用
    marginRatio?: number;        // 0–1，可选
  };
  camera: {
    locked?: boolean;
    angle?: 'eye_level' | 'low' | 'high' | 'top' | 'dutch';
    lens?: string;
    movement?: 'static' | 'pan' | 'dolly' | 'handheld' | string;
  };
  background: {
    type: 'solid' | 'scene' | 'chroma';
    color?: string;
    description?: string;
  };
  motion: {
    beats: Array<{ start: number; end: number; description: string }>; // 0–1 归一化
    secondary?: string[];
    rootMotion?: 'in_place' | 'translate';
    loopSeam?: 'closed' | 'open' | 'mirror';
    locomotion?: boolean;
    suspended?: boolean;
  };
  time: {
    durationSec: number;
    fps?: number;
    frames?: number;
  };
  style: {
    render?: string;
    lighting?: string;
    palette?: string[];
    negativeStyle?: string[];
  };
  technical: {
    aspectRatio: string;
    resolution: string;
    audio?: boolean;
    seed?: number;
  };
  negative: string[];
  references?: Array<{
    assetId: string;
    role: VideoReferenceRole;
    weight?: number;
  }>;
  promptStyle?: 'structured' | 'compact' | 'auto';
  /** 哪些字段是系统补的默认值，给用户看 */
  assumed?: string[];
}
```

编译函数建议放在 core，UI 只负责编辑和展示：

```ts
export interface VideoPromptCompileOptions {
  promptStyle: 'structured' | 'compact' | 'auto';
  capabilities: VideoModelCapabilities;
}

export interface VideoPromptCompileResult {
  prompt: string;
  negativePrompt?: string;
  warnings: Array<{
    code: string;      // 例如 video.warning.aspect_mismatch
    params?: Record<string, unknown>;
  }>;
  params: {
    durationSec: number;
    aspectRatio: string;
    resolution: string;
    seed?: number;
    audio: boolean;
  };
}

export function compileVideoPrompt(
  spec: VideoPromptSpec,
  options: VideoPromptCompileOptions,
): VideoPromptCompileResult;
```

实现细节：core 已经依赖 `zod` 和 `jsonrepair`。可以让 LLM 先输出 JSON 规格，用 `jsonrepair` 容错解析、`zod` 校验；校验失败就回退到“纯文本优化”路径，不要让用户卡住。

编译时的规则（对应 pet 项目的适配器/负面词做法）：

1. `structured` 输出十段式：`[STYLE] [SUBJECT] [FRAMING] [CAMERA] [BACKGROUND] [ACTION] [SECONDARY] [LOOP] [PARAMS] [AVOID]`。
2. `compact` 输出一段大白话：主体 + 动作 + 保持原图比例/配色 + 背景/机位 + 循环要求；不打时间戳。
3. `auto` 优先看适配器 `promptStylePreference`；没有就用 `structured`。
4. 如果模型不支持独立 `negativePrompt`，把 `[AVOID]` 追加到主提示词；如果支持，则单独传。
5. 如果模型不支持 `seed`，把 `seed` 标为随机，并在 UI 里禁用该输入。
6. 如果模型不支持 `camera_fixed`，不要假装能锁机位；在 warnings 里提示“该模型可能无法严格固定机位”。
7. 如果用户选了 `first_frame`/`last_frame` 但模型不支持，给出 warning，并回退为普通参考图/首帧。
8. 时长超出模型范围时，吸附到最近的支持值，并提示实际时长。

#### `pet-motion-prompt` → 通用视频规格的映射

| `pet-motion-prompt` | 通用视频规格 | 说明 |
|---|---|---|
| `clip.frames/fps` | `time.frames/fps` | 帧数/帧率；通用模式可只填时长 |
| `clip.loopSeam/playback` | `motion.loopSeam` + 播放模式 | `closed/open/mirror`；播放模式留在测试案例/未来预设层 |
| `character.description` | `subject.description` | 主体描述 |
| `character.mustKeep/mustNotChange` | `subject.mustKeep/mustNotChange` | 身份锚点 |
| `character.refs[].role` | `references[].role` | `subject/style/first_frame/last_frame` |
| `canvas.*` | `framing.*` | 通用模式只保留构图比例/占高；画布像素/基线只放测试案例/未来预设 |
| `camera.*` | `camera.*` | 机位/角度/镜头/运动 |
| `background.*` | `background.*` | 纯色/场景/键色 |
| `motion.phases[]` | `motion.beats[]` | 0–1 归一化时间轴 |
| `motion.secondary` | `motion.secondary` | 头发/尾巴/裙摆等次级运动 |
| `style.*` | `style.*` | 画风/光照/色板/负面风格 |
| `constraints.negative` | `negative[]` | 负面词 |
| `render.*` | `technical.*` | 模型/时长/比例/分辨率/seed/audio |

**MVP 建议只做 6 类字段**：`subject`、`framing`、`camera`、`motion`、`style`、`negative`；`time/technical` 由模型参数面板负责；`background` 可选。这样既能获得结构化提示词的好处，又不会让普通用户填十几个表单。

---

## 5. 代码落点清单

> 这一节是给开发者看的。非技术读者可以只看每张表的“作用”和“优先级”。

优先级说明：

- **P0**：不做就无法跑通视频模式骨架；
- **P1**：不做就没有真正的视频生成；
- **P2**：能力补齐/体验优化。

### 5.1 Core：类型与契约（P0）

| 文件 | 改动 | 作用 |
|---|---|---|
| `packages/core/src/services/prompt/types.ts` | `FunctionMode` 加 `'video'`；新增 `VideoSubMode` | 全局模式类型 |
| `packages/core/src/services/preference/global-settings.ts` | `functionMode` 加 `'video'`；新增 `videoSubMode`；更新解析白名单 | 记住上次所在模式 |
| `packages/core/src/constants/storage-keys.ts` | 新增 `VIDEO_MODELS`、`VIDEO_SUB_MODE` | 存储键统一管理 |
| `packages/core/src/services/template/types.ts` | `templateType` 加 `videoOptimize`/`videoIterate`/`videoEvaluation` | 视频模板分类 |
| `packages/core/src/services/template/static-loader.ts` | 注册视频模板类型映射 | 内置模板加载 |
| `packages/core/src/services/template/default-templates/index.ts` | 导入并注册视频模板 | 模板清单 |
| `packages/core/src/services/history/types.ts` | `PromptRecordType` 加 `videoOptimize`/`videoIterate` | 版本历史 |
| `packages/core/src/services/favorite/types.ts` | `functionMode` 加 `'video'`；`videoSubMode` | 收藏分类 |
| `packages/core/src/services/favorite/type-mapper.ts` | 记录类型 → 收藏分类的映射；白名单加 video | 收藏筛选 |
| `packages/core/src/services/favorite/storage-guards.ts` | `isFunctionMode` 白名单加 `'video'` | 旧收藏兼容/校验 |
| `packages/core/src/services/evaluation/types.ts` | `functionMode`/`EvaluationSubMode` 加视频 | 评估模式 |
| `packages/core/src/services/prompt-model/types.ts` | `PromptModeKey` 加 `'video-create'`；`PromptModeFamily` 加 `'video'`；新增 `VideoPromptContract` | 标准提示词模型 |
| `packages/core/src/services/prompt-model/session.ts` | `LEGACY_SESSION_SUB_MODE_KEYS` 加 `'video-create'` | 会话投影 |
| `packages/core/src/services/data/manager.ts` | 增加可选的 `videoModelManager`；导出/导入 `videoModels` | 数据备份 |
| `packages/core/src/services/data/workspace-session-transfer.ts` | 加视频会话键；校验视频快照 | 工作区备份 |
| `packages/core/src/constants/error-codes.ts` | 新增视频错误码 | 结构化错误 |
| `packages/core/src/index.ts` | 导出视频服务、类型、代理、工厂 | 对外 API |

### 5.2 Core：新增视频服务（P0/P1）

| 文件 | 改动 | 作用 | 优先级 |
|---|---|---|---|
| `core/src/services/video/types.ts` | 视频 Provider/Model/Config/Request/Job/Service 类型 | 契约 | P0 |
| `core/src/services/video/service.ts` | 校验、配置读取、提交、查询、取消、错误包装 | 视频服务 | P0 |
| `core/src/services/video/errors.ts` | 视频错误类型 | 错误处理 | P0 |
| `core/src/services/video/adapters/abstract-adapter.ts` | 适配器基类 | 统一流程 | P0 |
| `core/src/services/video/adapters/registry.ts` | Provider → Adapter 注册表 | 路由 | P0 |
| `core/src/services/video/adapters/mock.ts` | 测试用假适配器（返回小样本） | 单元/E2E | P0 |
| `core/src/services/video/adapters/<provider>.ts` | 真实供应商适配器（先做 1 家） | 生成 | P1 |
| `core/src/services/video/prompt-spec.ts` | `VideoPromptSpec` 类型 + zod 校验/默认值 | 结构化提示词 | P0 |
| `core/src/services/video/prompt-compiler.ts` | `structured`/`compact` 两种编译 + 能力位适配 | 提示词编译 | P0 |
| `core/src/services/video/prompt-templates.ts` | 十段式/紧凑式字符串模板 | 编译模板 | P0 |
| `core/src/services/video-model/manager.ts` | 配置 CRUD/导入导出 | 模型管理 | P0 |
| `core/src/services/video-model/defaults.ts` | 默认配置/环境变量 | 开箱即用 | P1 |
| `core/src/services/model/runtime-selection.ts` | 新增 `resolveRuntimeVideoModel` | 请求级切换模型 | P1 |
| `core/src/services/video/electron-proxy.ts` | 桌面渲染进程代理 | 桌面版 | P1 |
| `core/tests/unit/services/video/*` | 校验/轮询/取消/错误测试 | 质量 | P1 |

### 5.3 UI：模式、路由、会话（P0）

| 文件 | 改动 | 作用 |
|---|---|---|
| `ui/src/components/FunctionModeSelector.vue` | 加“视频”按钮；扩展类型；移动端防溢出 | 顶部导航 |
| `ui/src/components/app-layout/AppCoreNav.vue` | 视频子模式选择（MVP 可只显示“视频创作”或省略） | 二级导航 |
| `ui/src/components/app-layout/PromptOptimizerApp.vue` | 初始路由、路由解析、`navigateToSubModeKey`、弹窗状态 | 应用主壳 |
| `ui/src/router/index.ts` | 新增 `/video/create` 路由 | 页面入口 |
| `ui/src/router/workspaceRoutes.ts` | `video` 加入模式/子模式/默认值/正则 | 路由解析 |
| `ui/src/router/guards.ts` | 非法视频子模式重定向 | 路由守卫 |
| `ui/src/router/RootBootstrapRoute.ts` | 记住视频模式时跳转 | 启动恢复 |
| `ui/src/stores/settings/useGlobalSettings.ts` | `videoSubMode` 默认值/校验/更新 | 全局设置 |
| `ui/src/composables/mode/useFunctionMode.ts` | 支持 `'video'`；初始化白名单 | 模式状态 |
| `ui/src/composables/mode/useVideoSubMode.ts` | 新增（可从路由读取 `create`） | 子模式 |
| `ui/src/stores/session/sessionKeys.ts` | 加 `'video-create'` + `session/v1/video-create` | 会话键 |
| `ui/src/stores/session/useSessionManager.ts` | reader、key 计算、投影 map、restore switch | 会话协调 |
| `ui/src/stores/session/promptSessionProjection.ts` | 新增视频快照投影 | 标准模型 |
| `ui/src/stores/session/imageStorageMaintenance.ts` | 视频参考图纳入 GC | 防图片泄漏 |
| `ui/src/stores/session/useVideoCreateSession.ts` | 新增会话 store（参考 `useImageText2ImageSession`） | 保存/恢复 |
| `ui/src/types/services.ts` | 加 `videoModelManager`/`videoService`/`videoAdapterRegistry` | 服务注入 |
| `ui/src/composables/system/useAppInitializer.ts` | Web 创建服务；Electron 创建代理 | 启动装配 |
| `ui/src/index.ts` | 导出新组件/类型（按需） | 公共 API |

### 5.4 UI：视频工作区与模型管理（P0/P1）

| 文件 | 改动 | 作用 | 优先级 |
|---|---|---|---|
| `ui/src/components/video-mode/VideoWorkspace.vue` | 主工作区（可参考 `ImageText2ImageWorkspace.vue`，但简化） | 页面 | P0 |
| `ui/src/components/video-mode/VideoModelSelector.vue` | 视频模型下拉 | 选择模型 | P1 |
| `ui/src/components/video-mode/VideoResultPreview.vue` | `<video>` 播放器、封面、下载、过期状态 | 结果展示 | P1 |
| `ui/src/components/video-mode/VideoParametersPanel.vue` | 时长/比例/分辨率/种子/负向提示 | 参数 | P1 |
| `ui/src/components/video-mode/VideoReferenceUploader.vue` | 0～4 张参考图上传/预览/删除 | 参考图 | P0 |
| `ui/src/components/video-mode/VideoReferenceRoleSelect.vue` | 每张图选择 `subject/style/first_frame/last_frame` | 参考图角色 | P0 |
| `ui/src/components/video-mode/VideoSpecPanel.vue` | 可折叠高级规格：主体/构图/机位/动作/风格/负面 | 结构化编辑 | P0 |
| `ui/src/components/video-mode/VideoPromptStyleToggle.vue` | `structured / compact / auto` 切换 | 提示词风格 | P0 |
| `ui/src/components/video-mode/VideoPreflightWarnings.vue` | 比例/首帧/时长/能力位预检提示 | 生成前检查 | P1 |
| `ui/src/components/video-mode/VideoModeSelector.vue` | 如果未来拆子模式再用；MVP 可省略 | 子模式 | P2 |
| `ui/src/composables/video/useVideoGeneration.ts` | 提交、轮询、取消、对象 URL 清理 | 生成逻辑 | P1 |
| `ui/src/composables/video/useVideoPromptSpec.ts` | 规格编辑、校验、编译、`assumed` 展示 | 提示词规格 | P0 |
| `ui/src/composables/video/useVideoModelManager.ts` | 视频模型 CRUD/测试连接 | 模型管理 | P1 |
| `ui/src/composables/video/useVideoInputPreparation.ts` | 参考图压缩/比例预检（复用图像能力） | 上传 | P0 |
| `ui/src/components/ModelManager.vue` | 新增“视频模型”标签页 | 统一入口 | P1 |
| `ui/src/components/VideoModelManager.vue` | 视频模型列表/启停/测试/编辑 | 管理界面 | P1 |
| `ui/src/components/VideoModelEditModal.vue` | 视频模型新增/编辑 | 管理界面 | P1 |

### 5.5 UI：模板、收藏、评估、i18n（P0/P1）

| 文件 | 改动 | 作用 | 优先级 |
|---|---|---|---|
| `core/src/services/template/default-templates/` | 新增视频模板（中/英） | 优化配方 | P0 |
| `ui/src/components/TemplateManager.vue` | 模板分类/筛选加视频 | 模板管理 | P0 |
| `ui/src/components/TemplateSelect.vue` | 按视频类型过滤 | 模板选择 | P0 |
| `ui/src/components/FavoriteEditorForm.vue` | 功能模式选项加“视频” | 收藏编辑 | P1 |
| `ui/src/components/FavoriteLibraryWorkspace.vue` | 视频分类/筛选/标签 | 收藏库 | P1 |
| `ui/src/components/FavoriteDetailPanel.vue` / `FavoriteWorkspaceListItem.vue` | 视频标签/文案 | 收藏展示 | P1 |
| `ui/src/utils/favorite-mode.ts` | 归一化加 `'video'` | 兼容旧数据 | P1 |
| `ui/src/composables/app/useAppFavorite.ts` | 当前模式 → 收藏分类映射 | 收藏使用 | P1 |
| `ui/src/composables/app/useAppHistoryRestore.ts` | 历史恢复支持视频 | 历史复用 | P1 |
| `ui/src/components/evaluation/*` | 视频模式标签/提示词评估入口 | 评估 | P1/P2 |
| `ui/src/i18n/locales/en-US/video.ts` | 新增英文文案 | i18n | P0 |
| `ui/src/i18n/locales/zh-CN/video.ts` | 新增中文文案 | i18n | P0 |
| `ui/src/i18n/locales/zh-TW/video.ts` | 新增繁中文案 | i18n | P0 |
| `ui/src/i18n/index.ts`（或对应注册文件） | 注册 video 命名空间 | i18n | P0 |

### 5.6 桌面版 / 插件 / MCP（P1/P2）

| 文件 | 改动 | 作用 | 优先级 |
|---|---|---|---|
| `packages/desktop/main.js` | 创建 video 服务；注册 `video-*`/`video-model-*` IPC | 桌面主进程 | P1 |
| `packages/desktop/preload.js` | 暴露 `electronAPI.video` / `electronAPI.videoModel` | 安全桥 | P1 |
| `core/src/services/video/electron-proxy.ts` | 渲染进程代理 | 桌面 UI | P1 |
| `packages/desktop/config/*` | 如需要，增加视频请求的网络/代理配置 | 网络 | P2 |
| `packages/extension/public/manifest.json` | 默认不改；如必须直连视频 API，再评估 host 权限 | 插件 | P2 |
| `packages/mcp-server/src/index.ts` | 可选新增 `optimize-video-prompt` 工具 | MCP | P2 |

### 5.7 测试与文档（P0/P1）

| 文件 | 改动 | 作用 |
|---|---|---|
| `core/tests/unit/services/video/service.spec.ts` | 校验、提交、轮询、取消、错误 | 核心测试 |
| `core/tests/unit/services/video/adapters.spec.ts` | 适配器返回解析/能力位 | 适配器测试 |
| `core/tests/unit/services/video/prompt-spec.spec.ts` | 规格校验/默认值/`assumed` | 规格测试 |
| `core/tests/unit/services/video/prompt-compiler.spec.ts` | structured/compact/negative 追加/能力位降级 | 编译器测试 |
| `ui/tests/unit/stores/video-session.spec.ts` | 会话保存/恢复（含规格/参考图角色） | UI 测试 |
| `tests/e2e/video-mode.spec.ts` | 视频模式完整流程（mock API + 规格/风格/角色） | E2E |
| `tests/fixtures/sample.mp4` | 1 秒小样本（公共领域/自生成） | mock 结果 |
| `docs/architecture/video-mode-design.md` | 本文 | 设计记录 |

### 5.8 横向检查清单：最容易漏的联合类型

新增一级模式时，最大的坑不是“写新文件”，而是“旧文件里的固定取值列表没加 video”。建议改完后用 `rg` 全仓搜索这些关键词，逐个确认：

```powershell
rg "'basic' \| 'pro' \| 'image'|'basic' \| 'context' \| 'image'|basic.*pro.*image" packages
rg "image-text2image|image-image2image|image-multiimage" packages/core/src packages/ui/src
```

至少检查下面这些位置：

| 文件 | 需要加什么 |
|---|---|
| `core/src/services/prompt-model/mode.ts` | `PROMPT_MODE_KEYS`、`FavoriteModeCompat`、`resolvePromptModeKey`、`promptModeKeyToFavoriteMode` |
| `core/src/services/prompt-model/types.ts` | `PromptModeKey`、`PromptModeFamily`、`PromptContract`、`PromptContent`（按阶段） |
| `core/src/services/prompt-model/session.ts` | `LEGACY_SESSION_SUB_MODE_KEYS`、投影映射 |
| `core/src/services/favorite/storage-guards.ts` | `isFunctionMode` 白名单 |
| `core/src/services/favorite/type-mapper.ts` | `FunctionModeMapping`、`validateMapping`、`inferRecordTypes` |
| `core/src/services/evaluation/types.ts` | `EvaluationSubMode`、`EvaluationModeConfig` |
| `ui/src/utils/favorite-mode.ts` | 归一化白名单 |
| `ui/src/utils/favorite-workspace-apply.ts` | `FavoriteWorkspaceTargetKey`、`FavoriteWorkspaceApplySource`、`promptModeKeyToWorkspaceTargetKey` |
| `ui/src/types/workspace.ts` | `SaveFavoritePayload.prefill.functionMode` |
| `ui/src/composables/app/useAppFavorite.ts` | 当前模式/收藏模式映射 |
| `ui/src/composables/app/useAppHistoryRestore.ts` | 历史 → 工作区目标映射 |
| `ui/src/composables/prompt/useEvaluation.ts` | `functionMode` 类型断言 |
| `ui/src/composables/prompt/useEvaluationHandler.ts` | 同上 |
| `ui/src/integrations/types.ts` | 外部集成/收藏预填的 `functionMode` |
| `ui/src/components/FunctionModeSelector.vue` | props/emits 的联合类型、按钮 |
| `ui/src/stores/settings/useGlobalSettings.ts` | `isFunctionMode` 白名单、默认值、更新方法 |
| `ui/src/router/workspaceRoutes.ts` / `guards.ts` | 模式白名单、正则、默认子模式 |
| `ui/src/components/app-layout/PromptOptimizerApp.vue` | 初始路由、解析、`navigateToSubModeKey` |
| `ui/src/stores/session/promptSessionProjection.ts` | 新 store 的投影分支 |
| `core/src/services/data/workspace-session-transfer.ts` | 新会话键、校验分支 |

> 建议在 `FunctionMode` 改成联合类型后，让 TypeScript 的 `switch` 穷尽检查帮你找漏；但 `Record<...>`、`if` 字符串比较、`as` 断言不会报错，所以仍需人工搜索。

---

## 6. 分阶段实施计划

### Phase 0：决策与 API 验证（1～2 天）

**目标：** 在写正式代码前，确认“视频生成到底能不能跑通”。`pet-motion-prompt` 的客户端路径已经跑通，但它的 API 还没打通，所以这一步不能省。

要做的事：

1. 优先选 **Seedance 2.0 Fast/Flash**（你的探索项目已经按它验证了 3:4、4s、720×960、24fps、默认音频、右下角水印、无 `camera_fixed`/`frames`/`seed`/`negative_prompt` 等能力位）；备选 Gemini/Veo、Kling、Runway。
2. 用最简单的脚本/Postman 验证 API：提交任务、查询状态、拿到视频 URL；确认 API 与客户端行为是否一致。
3. 在 **Web 浏览器**里验证 CORS；在 **桌面版主进程**里验证是否能绕过。
4. 用 pet 项目的经验做一次“首帧比例”实验：720×960（3:4）vs 2:3 输入，确认角色是否被拉宽。
5. 验证“提示词能否锁住固定机位/原地动作”；大概率不能，记录结论，别把提示词当硬约束。
6. 确认音频/水印/URL 有效期/是否支持参考图/时长比例限制。
7. 保存一份真实响应 JSON，作为适配器和测试样本。

**验收标准：**

- 能在本机成功生成 1 个 4 秒、3:4、720×960 的视频；
- 能拿到可播放的 URL 或文件；
- 明确 Web/桌面/插件三端各自是否可用；
- 明确能力位、默认参数、音频/水印行为和成本；
- 明确首帧比例不正确时会发生什么。

**如果这一步失败，不要进入 Phase 2 的生成部分。** 先解决供应商/网络问题。

### Phase 1：视频模式骨架 + 结构化提示词（4～6 天）

**目标：** 用户能进入视频页面，完成“输入要求 → 结构化规格 + 优化提示词 → 迭代 → 历史 → 收藏 → 刷新恢复”，但暂时不能生成视频。

改动范围：

- 所有 P0 的 core 类型/契约；
- 路由、导航、全局设置、会话键；
- `VideoWorkspace` 的左侧提示词区域；
- `VideoPromptSpec`（MVP 先做 6 类：subject/framing/camera/motion/style/negative）；
- `structured`/`compact` 两种编译 + `auto` 选择；
- 参考图角色（subject/style/first_frame/last_frame）；
- 视频模板（2～4 个，中英）；
- 视频会话 store（提示词/规格/参考图/模型选择）；
- 收藏、历史、i18n、移动端；
- “生成视频”按钮先禁用，显示“即将上线”或“请先配置视频模型”。

**验收标准：**

- 顶部出现“视频”，点击进入 `/video/create`；
- 输入要求，能选模板/文本模型，能流式优化；
- 能切换 `structured/compact`，并看到两种输出差异；
- 参考图能选角色，提示词里能体现“图片 1 提供…，图片 2 仅提供…”；
- 能迭代、切换版本、刷新恢复；
- 历史记录里有视频类型和规格版本，能复用；
- 收藏里能选“视频”分类，能保存/使用；
- 其他三种模式完全不受影响；
- `pnpm typecheck:core`、`pnpm typecheck:ui`、core/ui 单测、locale 检查通过。

**为什么先做这一步：** 它会暴露所有“跨层遗漏”（路由、会话、收藏、备份、i18n），同时把 pet 项目最有价值的“规格化”先落地；视频 API 的不确定性留到 Phase 2。

### Phase 2：视频生成 MVP（6～9 天）

**目标：** 接入 1 家供应商，真正生成、预览、下载、取消。

改动范围：

- `video` 服务 + 适配器 + `video-model` 管理器；
- `VideoModelManager` / `VideoModelEditModal` / `VideoModelSelector`；
- 右侧参数面板 + `VideoResultPreview`；
- `VideoPreflightWarnings`：比例/首帧/时长/能力位；
- `useVideoGeneration` 轮询/取消/对象 URL 清理；
- 能力位适配：不支持 `seed/negative_prompt/camera_fixed/first_last_frame` 时隐藏或禁用；
- 生成后基础体检：时长/分辨率/比例/音频/大小/URL 过期；
- 桌面版 IPC/代理（如果 Web CORS 不通）；
- 错误码/i18n/测试。

**验收标准：**

- 能选择视频模型；模型不支持的参数被禁用/隐藏，而不是“填了没用”；
- 能设置 4 秒/3:4/720p（或通用 5 秒/16:9/720p）；
- 点击生成后能看到“提交中/排队/生成中/成功”；
- 成功后能播放、下载；音频/水印有提示；
- 能取消；
- 失败有可读错误，不出现白屏；
- 首帧比例不匹配时，生成前有警告/自动补边选项；
- 刷新后提示词/规格/参考图/参数恢复，视频结果过期提示正确；
- 不产生大体积 IndexedDB 写入；
- 桌面版能跑通（如果 Web 受限）；
- 用桌宠 `shy` 测试案例跑一次端到端（见 7.8），确认通用提示词覆盖动作/机位/背景/负面。

### Phase 3：能力补齐（6～10 天）

**目标：** 对齐基础/上下文/图像的完整基础能力，并复盘桌宠测试案例，评估是否值得做可选导出。

候选：

- 2 列视频对比；
- 提示词评估（prompt-only）；
- 视频结果评估（如供应商/模型支持视频理解）；
- 更多视频供应商；
- 收藏封面图；
- 数据备份中的视频模型/会话完整校验；
- 导出 `petmotion` 兼容的 `.yaml`（仅测试案例/高级用户；不做成通用产品预设）；
- 桌面版后处理（抽帧/抠图/QA）或外部 `petmotion` 调用；
- 插件端可用性；
- MCP `optimize-video-prompt`；
- 移动端细节/性能优化。

**验收标准：** 第 1.3 节能力矩阵中所有 ✅/◐ 项都有对应测试和手工验收记录；桌宠案例只作为回归测试，不进入通用主流程。

### 粗略工作量

| 阶段 | 1 名熟悉仓库的开发者 | 说明 |
|---|---|---|
| Phase 0 | 1～2 天 | 不含供应商额度审批 |
| Phase 1 | 4～6 天 | 跨层类型/路由/会话 + 规格编译 |
| Phase 2 | 6～9 天 | 取决于供应商 API 复杂度/CORS |
| Phase 3 | 6～10 天 | 按补齐范围浮动 |
| **MVP（0～2）** | **11～17 天** | 不含设计评审/测试环境等待 |
| **完整对齐（0～3）** | **17～27 天** | 不含供应商审批和多端实机测试 |

> 这是粗略估算，不是承诺；视频供应商的接口稳定性和 CORS 情况可能显著影响 Phase 2。

---

## 7. 验证方案

### 7.1 环境准备

项目要求 Node `^24.22.1`、pnpm `10.6.1`。当前机器 Node 为 v24.19.0，且 `pnpm` 不在 PATH；先处理：

```powershell
node -v
corepack enable
pnpm -v
pnpm install
```

如果 `corepack enable` 因 Windows 权限失败：

```powershell
npm install -g pnpm@10.6.1
```

> **动手前先备份。** 当前目录不是 Git 仓库；建议把整个 `E:\prompt-optimizer-2.15.2` 复制一份，或执行 `git init` 后先提交一次。API key 只放在本机 `.env.local`，不要提交到公开仓库。

### 7.2 自动检查

```powershell
pnpm typecheck:core
pnpm typecheck:ui
pnpm -F @prompt-optimizer/core test
pnpm -F @prompt-optimizer/ui test
pnpm check:locale
pnpm check:no-chinese-runtime
```

全量门禁（时间允许时）：

```powershell
pnpm lint
pnpm test
pnpm build
```

桌面/插件：

```powershell
pnpm build:desktop
pnpm build:ext
```

### 7.3 手工验收清单（Web）

1. `pnpm dev`，打开 `http://localhost:18181`。
2. 顶部出现“视频”；点击后地址为 `#/video/create`。
3. 输入：“一只黑猫在雨夜的霓虹街头走路，电影感，镜头跟着猫移动。”
4. 上传 2 张参考图；把第 1 张角色设为 `subject`，第 2 张设为 `style`；确认缩略图、角色下拉、删除、重新上传都正常。
5. 选择文本模型和视频模板，点击“优化提示词”；观察流式输出。
6. 切换 `structured / compact`；确认两种输出风格不同，且参考图角色在提示词里有对应描述。
7. 点击“迭代”，输入“镜头再低一点，增加雨滴细节”；确认版本链增加。
8. 刷新页面；确认提示词、规格、参考图、角色、模型选择、参数都恢复。
9. 选择视频模型；确认不支持的参数（如 seed/negative_prompt/first_last_frame）被禁用或隐藏，而不是“填了没用”。
10. 上传一张 2:3 参考图，目标设为 3:4；确认生成前出现“比例不一致/自动补边”警告，且不会拉伸原图。
11. 设置 4 秒/3:4/720p，点击“生成视频”。
12. 观察状态：提交中 → 排队 → 生成中 → 成功；确认已用时/进度显示合理。
13. 播放视频；点击下载；确认文件能打开；确认音频/水印提示符合实际。
14. 点击“取消”（在生成中）；确认状态变为已取消，不继续轮询。
15. 刷新页面；确认视频结果显示“已过期/需重新生成”，页面不崩溃。
16. 保存收藏；进入收藏页，筛选“视频”；确认能打开/使用。
17. 数据管理导出；检查 JSON 中有 `videoModels` 和 `video-create` 会话，没有视频字节。
18. 切换回基础/上下文/图像；确认原有优化、测试、历史、收藏都正常。
19. 浏览器窗口缩到 360px；确认顶部导航、参考图、视频播放器不溢出。

### 7.4 手工验收（桌面版）

1. `pnpm dev:desktop`。
2. 观察主进程日志：视频服务创建、IPC 注册无报错。
3. 走一遍“优化 → 生成 → 下载”。
4. 如果 Web 有 CORS 限制，确认桌面版能正常提交/取回。
5. 关闭再打开桌面版；确认提示词/参考图恢复，视频结果过期提示正常。
6. `pnpm build:desktop`，安装包再测一次。

### 7.5 手工验收（插件）

1. `pnpm build:ext`。
2. `chrome://extensions` → 开发者模式 → 加载 `packages/extension/dist`。
3. 点击插件图标，进入视频模式；确认提示词优化可用。
4. 尝试生成；如果 CORS/权限失败，确认有清晰提示“请使用桌面版或配置代理”，而不是白屏。
5. 确认没有新增不必要的权限提示。

### 7.6 Mock 适配器测试

不要每次测试都调用真实付费 API。新增 `MockVideoAdapter`：

- `createJob` 返回 `queued`；
- 1 秒后 `running`；
- 3 秒后 `succeeded`，返回 `tests/fixtures/sample.mp4` 的 URL；
- 支持 `cancelJob`；
- 支持模拟失败/超时；
- 支持模拟“不支持 seed/negative_prompt/first_last_frame”的能力位，用来测 UI 是否正确禁用参数。

E2E 用 Playwright 拦截真实网络，走 mock 适配器即可验证 UI 全流程。

另外加两组“编译快照”测试：

1. **structured 快照**：给定 `VideoPromptSpec`，编译结果必须包含 `[STYLE] ... [AVOID]` 十段；
2. **compact 快照**：同一 spec 输出一段大白话，不含时间戳/分段标题；
3. **能力位降级**：模型不支持 `negative_prompt` 时，负面词必须追加到正文；不支持 `seed` 时，params 里 `seed` 必须是随机/空；
4. **参考图角色**：`subject`/`style` 两张图时，prompt 必须出现“图片 1 提供角色外观；图片 2 仅提供画风”这类描述。

### 7.7 回归清单

- 基础/上下文/图像的优化、迭代、测试、历史、收藏；
- 模型管理器文本/图像标签页；
- 数据导入导出（旧备份、新备份）；
- 主题/语言切换；
- 移动端导航；
- 视频模式的 `structured/compact` 切换、参考图角色、预检警告；
- 桌面版自动更新/网络设置（如果改了主进程）；
- MCP 文本工具（如果改了 core 导出）。

### 7.8 桌宠测试案例（通用模式的“压力测试”）

目标：用 `E:\pet-motion-prompt` 的真实案例，验证通用视频模式能不能产出“足够指导模型”的提示词；**不是**要求主应用复刻桌宠后处理。

测试素材：

- `examples/characters/whale_girl/shy.yaml`
- `examples/characters/whale_girl/compiled/shy/prompt.md`
- `examples/characters/whale_girl/compiled/shy/params.json`
- `examples/characters/whale_girl/front_green.png`
- `examples/characters/whale_girl/views/front.png`、`side.png`、`back.png`

操作步骤：

1. 在视频模式输入类似：
   > 蓝发少女害羞，双手捂嘴，头低 8 度，尾巴轻摆，4 秒，3:4，固定机位，纯色绿幕背景，最后回到第一帧姿势。
2. 参考图角色：
   - `front_green.png` → `first_frame`
   - `front.png` → `subject`
   - 如有风格图 → `style`
3. 点击“优化提示词”，切换 `structured` 和 `compact`。
4. 对照 `compiled/shy/prompt.md`，检查是否覆盖：
   - 身份：发色/瞳色/服装/尾巴/不可变特征；
   - 构图：全身、主体占高、脚底基线；
   - 机位：固定、平视、无推拉摇移；
   - 背景：纯色/绿幕、无地面/阴影/渐变；
   - 动作：3–5 个 beat + settle；
   - 次级运动：头发/尾巴/裙摆；
   - 循环：首末帧姿势一致；
   - 负面：手办/水印/文字/镜头运动/换脸等。
5. 如果 Phase 2 已接入视频模型：生成 4 秒/3:4/720p，肉眼检查动作是否完整、机位是否基本稳定、角色是否明显变样。
6. 记录结果：哪些字段通用模式覆盖了，哪些必须靠桌宠后处理/专用规格，作为 Phase 3 的输入。

**通过标准：**

- 通用模式能产出覆盖 10 类信息的提示词；
- `structured` 和 `compact` 都能用，且差异符合预期；
- 参考图角色在提示词里被正确表达；
- 不要求复刻 384×512/基线/bounds.txt/抠图/QA；
- 如果模型仍不遵守固定机位/原地动作，记录为“模型能力限制”，不算通用模式失败。

---

## 8. 风险与对策

| 风险 | 表现 | 对策 |
|---|---|---|
| 视频文件过大 | IndexedDB 膨胀、页面卡死、备份巨大 | 不保存视频字节；只保存 URL/任务元数据/小封面；对象 URL 及时释放 |
| 异步任务超时/卡住 | 一直“生成中” | 总超时、退避轮询、可取消、失败可重试；页面隐藏时降频 |
| 供应商 URL 过期 | 刷新后视频打不开 | 记录 `expiresAt`；过期显示“重新生成”；下载提示尽早 |
| CORS/鉴权 | Web 端请求被浏览器拦截 | 桌面版主进程代理；自定义 baseURL/反代；插件明确提示限制 |
| 供应商 API 差异 | 换一家就要改 UI | 适配器隔离；统一 `VideoJob`/`VideoResult`；契约测试 |
| 费用失控 | 自动重试/批量生成产生费用 | 默认 1 条、5 秒；生成前确认；不自动重试；显示模型/参数 |
| 一级模式跨层遗漏 | 能进页面但保存/收藏/备份失效 | 按第 5 节清单逐项改；`rg` 搜索所有 `FunctionMode`/`image-` 分支；typecheck + 回归 |
| 备份校验器假设错误 | 导入视频会话失败/误删 | 修改 `workspace-session-transfer.ts` 的 `mode.startsWith('image-')` 分支；加视频快照测试 |
| 收藏/评估联合类型漏改 | 收藏筛选不到、评估报错 | 更新 `favorite`/`evaluation` 的所有 union、选项、i18n；旧数据 fallback |
| 顶部导航拥挤 | 移动端 5 个按钮放不下 | 小屏用下拉/横向滚动；360px 实测；必要时把 Arena 收进“更多” |
| 浏览器编解码不支持 | 视频黑屏/无法播放 | 优先 MP4/H.264；提供下载；错误提示；必要时转码（后续） |
| 插件 CSP/权限 | 视频播放/请求被拦截 | 先不改 manifest；实测 `media-src`/CORS；必要时评估 host 权限 |
| 模型不遵守“固定机位/原地不动” | 画面漂移、角色忽大忽小 | 提示词只是软约束；生成后做基础体检；把“能力位”告诉用户；不要承诺 100% 稳定 |
| 首帧比例不匹配 | 角色被拉宽/裁切（pet 项目实测约 16%） | 生成前预检；自动等比缩放+补边；绝不做拉伸 |
| 提示词锁色无效 | 生成结果偏色，用户以为“优化失败” | 不承诺颜色完全一致；提供后期校色/接受差异的说明；把颜色要求写进 spec 但标注“软约束” |
| 客户端与 API 能力不一致 | 客户端能做的参数 API 不支持 | 适配器 YAML 记录 `verified_at` + 能力位；契约测试；UI 按能力位显示 |
| 桌宠专用后处理混入通用模式 | 主应用被 ffmpeg/Python/画布契约绑死 | 只作为测试案例/外部 `petmotion`；通用视频模式只做提示词+预览 |
| 动作幅度不可控/多次重试 | 同一 spec 结果差异大 | 记录 spec/prompt/params/seed；版本对比；每次只改一个变量；管理预期 |

---

## 9. 需要你决定的问题

| # | 问题 | 推荐 | 为什么重要 |
|---|---|---|---|
| 1 | 先用哪家视频供应商？ | **Seedance 2.0 Fast/Flash 优先**（你的 `pet-motion-prompt` 已按它验证了 3:4/4s/720×960/24fps、音频/水印、能力位；API 尚未打通）；备选 Gemini/Veo、Kling、Runway | 决定适配器、参数、CORS、成本；不要同时接多家 |
| 2 | 参考图代表什么？ | MVP 提供 4 个角色：`subject/style/first_frame/last_frame`，默认 `subject`；提示词里显式写“图片 1 提供…” | 多图不声明角色会串脸/串风格；这是 pet 项目验证过的坑 |
| 3 | 生成结果要不要长期保存？ | **不保存视频字节**；只保留提示词、规格、参考图、任务元数据、可选封面 | 直接决定存储方案和数据备份大小 |
| 4 | 默认时长/比例/分辨率？ | 通用 5 秒/16:9/720p；桌宠测试案例 4 秒/3:4/480p 或 720p；1 条、无音频 | 控制成本和生成时间；测试案例的画布契约不进入通用默认值 |
| 5 | 一个工作区还是三个子模式？ | 先一个 `/video/create`；未来再拆 | 决定路由/会话/导航复杂度 |
| 6 | 插件要不要支持生成？ | 先 Web/桌面；插件只保证提示词优化，生成失败提示用桌面版 | 避免新增 host 权限和上架风险 |
| 7 | 视频结果要不要评估？ | 先做提示词评估 + 基础体检；视频结果评估 Phase 3 | 视频理解模型/成本/接口都更复杂 |
| 8 | 单次生成要不要确认费用？ | 要；首次生成前弹确认，显示模型/时长/预估费用（如果供应商提供） | 避免误点产生费用 |
| 9 | 最多几张参考图？ | 4 张 | 兼顾一致性和请求大小 |
| 10 | 是否需要音频/对白？ | MVP 不做；适配器要标明模型是否默认带音频 | 多数视频模型音频能力不统一，先保证画面 |
| 11 | 提示词输出成什么形态？ | `structured` + `compact` 两种，默认 `auto`；结构化规格可折叠 | pet 项目实测 compact 更适合动作；结构化更适合复用/校验 |
| 12 | 要不要做“结果体检”？ | MVP 做基础体检；完整 QA 放独立工具/测试案例 | 视频不确定性高；至少让用户知道问题在哪 |
| 13 | 桌宠动画怎么接？ | **只作为测试案例**；先不把“桌宠预设”做成产品功能；Phase 3 再评估是否导出 `petmotion` spec | 你的产品主线是通用视频优化；测试案例用来验证，不绑架产品结构 |

回答：
1.seedance 2.0 fast
2.角色以及出现的元素
3.不保存
4.通用
5.先只做一个
6.不支持
7.先只做提示词评估，视频评估先由人工处理
8.要
9.4张
10.不做，只限制视频本身
11.`structured` + `compact` 两种，默认 `auto`；结构化规格可折叠
12.只做基础的
13.先不考虑

---

## 10. 术语小抄

| 术语 | 一句话解释 |
|---|---|
| 一级模式 / Function Mode | 顶部导航里的 Basic / Context / Image / Video 这种大分类 |
| 工作区 / Workspace | 一个具体页面，比如 `/video/create` |
| 适配器 / Adapter | 转换插头，把统一请求转成某家 AI 的格式 |
| 异步任务 / Job | 先提交、后查询进度、最后拿结果；视频生成通常如此 |
| 轮询 / Polling | 每隔几秒问一次“好了吗” |
| 预签名 URL | 供应商给的、带临时权限和有效期的视频地址 |
| CORS | 浏览器的跨域限制；可能导致网页能打开但请求被拦截 |
| 对象 URL / Object URL | 浏览器为内存中的 Blob 生成的临时地址，用完要释放 |
| 会话快照 / Session Snapshot | 自动保存的“当前工作现场”，刷新后用它恢复 |
| 数据迁移 / Migration | 旧数据换新格式时的搬运和兼容 |
| 联合类型 / Union | 一个字段只能是几个固定值之一；加新模式时要同步所有分支 |
| i18n / 语言包 | 多语言文案表 |
| E2E | 自动走一遍完整用户流程的测试 |
| MCP | 让外部 AI 工具调用本程序能力的协议 |

---

## 附录 A：现有架构关键文件索引

| 想看什么 | 去哪里 |
|---|---|
| 应用主壳/导航 | `packages/ui/src/components/app-layout/PromptOptimizerApp.vue`、`AppCoreNav.vue` |
| 路由 | `packages/ui/src/router/index.ts`、`workspaceRoutes.ts`、`guards.ts` |
| 全局模式/设置 | `packages/ui/src/composables/mode/useFunctionMode.ts`、`stores/settings/useGlobalSettings.ts` |
| 会话管理 | `packages/ui/src/stores/session/useSessionManager.ts`、`sessionKeys.ts` |
| 图像模式参考实现 | `packages/ui/src/components/image-mode/ImageText2ImageWorkspace.vue` |
| 图像会话参考 | `packages/ui/src/stores/session/useImageText2ImageSession.ts` |
| 图像生成 composable | `packages/ui/src/composables/image/useImageGeneration.ts` |
| 图像服务/适配器 | `packages/core/src/services/image/service.ts`、`adapters/` |
| 图像模型管理 | `packages/core/src/services/image-model/manager.ts`、`ui/src/components/ImageModelManager.vue` |
| 模型管理器入口 | `packages/ui/src/components/ModelManager.vue` |
| 模板系统 | `packages/core/src/services/template/`、`ui/src/components/TemplateManager.vue` |
| 历史/收藏 | `packages/core/src/services/history/`、`favorite/` |
| 数据备份 | `packages/core/src/services/data/manager.ts`、`workspace-session-transfer.ts` |
| 桌面主进程 | `packages/desktop/main.js`、`preload.js` |
| 桌面代理模式 | `packages/core/src/services/image/electron-proxy.ts` |
| 初始化装配 | `packages/ui/src/composables/system/useAppInitializer.ts` |
| 数据备份 UI | `packages/ui/src/components/DataManager.vue`、`components/data-manager/` |

## 附录 B：命令小抄

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动 Web 开发版（`http://localhost:18181`） |
| `pnpm dev:desktop` | 启动桌面开发版 |
| `pnpm build:ext` | 构建浏览器插件到 `packages/extension/dist` |
| `pnpm typecheck:core` | 检查 core 类型 |
| `pnpm typecheck:ui` | 检查 ui 类型 |
| `pnpm -F @prompt-optimizer/core test` | 跑 core 单元测试 |
| `pnpm -F @prompt-optimizer/ui test` | 跑 ui 单元测试 |
| `pnpm check:locale` | 检查三语语言包键是否一致 |
| `pnpm check:no-chinese-runtime` | 检查运行时代码里有没有不该出现的中文文案 |
| `pnpm lint` | 代码规范/类型综合检查 |
| `pnpm test` | 跑所有单元测试 |
| `pnpm build` | 构建 Web/插件等产物 |
| `pnpm build:desktop` | 构建桌面安装包 |

---

## 附录 C：一页纸执行清单（打印用）

- [ ] Phase 0：选定供应商（建议 Seedance 2.0 Fast/Flash）；先跑桌宠案例 4s/3:4/720×960，再跑通用 5s/16:9/720p
- [ ] Phase 0：确认 Web/桌面/插件 CORS 情况
- [ ] Phase 0：确认音频/水印/URL 有效期/能力位/费用
- [ ] Phase 0：用 2:3 首帧做一次“角色变宽”实验，确认预检规则
- [ ] Phase 1：加 `video` 到 `FunctionMode`/全局设置/路由/导航
- [ ] Phase 1：加 `/video/create` 工作区 + 会话 store
- [ ] Phase 1：加视频模板（中/英）+ 模板分类
- [ ] Phase 1：加 `VideoPromptSpec`（6 类）+ `structured/compact` 编译
- [ ] Phase 1：加参考图角色（subject/style/first_frame/last_frame）
- [ ] Phase 1：加历史/收藏/评估/i18n/备份的类型分支
- [ ] Phase 1：跑通“输入 → 规格 → 优化 → 迭代 → 刷新恢复”
- [ ] Phase 2：加 VideoService/Adapter/VideoModelManager
- [ ] Phase 2：加能力位（seed/negative/camera_fixed/first_last_frame）
- [ ] Phase 2：加参数面板 + 预检警告 + 视频预览 + 下载/取消
- [ ] Phase 2：加桌面 IPC/代理（如需）
- [ ] Phase 2：跑通真实生成 + 过期提示 + 无大体积存储
- [ ] Phase 3：对比/评估/更多供应商/插件/MCP
- [ ] Phase 3：复盘桌宠测试案例，评估是否导出 `petmotion` spec
- [ ] 全量回归：基础/上下文/图像/收藏/备份/移动端

---

## 附录 D：`E:\pet-motion-prompt` 交接笔记

如果未来要把这个探索项目交给开发者继续，先看这些文件：

| 文件 | 为什么看 |
|---|---|
| `README.md` | 项目定位、用法、当前状态 |
| `AGENTS.md` | 硬规则和踩坑清单（非常有价值） |
| `docs/01-requirements.md` | 需求、数据模型、功能清单 |
| `docs/02-video-spec.md` | 十类视频参数规范、提示词写法、阈值 |
| `docs/05-turnaround-spec.md` | 三视图解析、材质/色板/比例 |
| `docs/06-progress.md` | 实测数据、踩坑、动作指标 |
| `docs/07-workflow.md` | 三条硬规则、九步流程、判定阈值 |
| `schemas/pet-clip.schema.json` | `PetClipSpec` 完整字段 |
| `examples/characters/whale_girl/shy.yaml` | 一个真实可跑的 spec |
| `examples/characters/whale_girl/compiled/shy/prompt.md` | 编译出的十段式提示词 |
| `out/doubao/REPORT.md` | Seedance 实测：循环点、基线、水印、音频、画风 |

常用命令（来自该项目的 `AGENTS.md`）：

```powershell
# 在 E:\pet-motion-prompt 下
.venv\Scripts\python.exe -m pytest -q
.venv\Scripts\python.exe -m petmotion validate examples/characters/whale_girl/shy.yaml
.venv\Scripts\python.exe -m petmotion compile examples/characters/whale_girl/shy.yaml -o examples/characters/whale_girl/compiled
.venv\Scripts\python.exe -m petmotion post <clip.mp4> -s <spec> -o out/candidates/<name> --clear-rect 545,875,720,960
.venv\Scripts\python.exe -m petmotion qa out/candidates/<name> -s <spec>
```

**交接时的三条提醒：**

1. 它是**独立 Python 程序**，不是主应用的库；不要试图在浏览器里直接 import。
2. 它的强项是“规格 + 提示词 + 后处理 + QA”，弱项是“API 未打通、只验证了 1 个角色/2 个动作、动作幅度不可控”；不要把它当成成熟视频生成引擎。
3. 最适合的复用方式是“借设计 + 导出 spec”，不是“整体搬代码”。

---

*文档结束。下一步建议：先完成 Phase 0 的供应商验证，再按 Phase 1 的 P0 清单开分支实施。*
