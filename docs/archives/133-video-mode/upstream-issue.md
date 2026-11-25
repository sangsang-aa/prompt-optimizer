# 上游 Issue 草稿（视频模式）

> 用途：向 `linshenkx/prompt-optimizer` 提 feature issue，先确认方向是否被接受，再决定 PR 粒度。
> 状态：草稿。仓库与分支已填入，可直接复制到上游 issue。

## 标题

`[Feature] 新增 Video 一级模式：结构化视频提示词 + Seedance 2.0 Fast 生成`

## 正文

### 背景

Prompt Optimizer 目前覆盖 Basic / Context / Image，但视频提示词的写法与图像差异很大：镜头、时长、
主体一致性、动作节奏都会影响结果，直接复用图像模式效果不稳定。希望新增一级模式 **Video**，
把“视频要求 → 结构化提示词 → 生成预览”做成一条完整链路。

### 提议

新增一级模式 `video`（工作区 `/video/create`）：

1. 用户输入视频要求，可选 0–4 张参考图（角色 / 风格 / 首帧 / 末帧）。
2. 文本模型先产出 `VideoPromptSpec`（JSON 规格），校验失败自动回退纯文本优化，不阻塞用户。
3. 编译器输出两种风格：
   - `structured`：十段式（STYLE / SUBJECT / FRAMING / CAMERA / BACKGROUND / ACTION / SECONDARY / LOOP / PARAMS / AVOID）；
   - `compact`：一段大白话，适合动作类；
   - 默认 `auto`，优先适配器偏好，否则 `structured`。
4. 接入 1 家视频供应商做生成预览：**火山方舟 Seedance 2.0 Fast**（`doubao-seedance-2-0-fast-260128`）。
5. 生成前确认费用；不做自动重试。

### 范围（MVP）

- 路由、导航、全局设置、会话键、i18n（中/英/繁）。
- 视频提示词规格、两种编译风格、能力位降级与 warning code。
- 视频模型管理、参数面板、任务轮询、预览/下载/取消。
- 历史、收藏、备份、评估按现有模式对齐（视频结果只评估提示词）。

### 明确不做

- 不保存视频字节：只留临时 URL / `expiresAt` / 封面，不进 IndexedDB、不进备份。
- 不把 API Key 写入程序：只从环境变量或用户配置读取。
- 插件端不支持生成，只保证提示词优化。
- 不做音频/对白。
- 不自动重试（按次计费）。

### 对现有架构的影响

- 新增一级模式属于跨层改动（预计 30–40 个文件），主要是联合类型、路由、会话投影、i18n、收藏/备份白名单。
- 会话新增 `session/v1/video-create`；旧备份缺少该键时保持兼容。
- 新增 `core/src/services/video/*`（规格、编译器、服务、适配器）与 `video-model` 管理器。
- UI 新增 `components/video-mode/*`，不改动现有三个模式的行为。

### 当前进展

- 已完成 Phase 0：Seedance API 提交 → 轮询 → 下载实测通过（4s / 3:4 / 480p，84 秒，无音轨、无水印）。
- 已完成 Phase 1 骨架：模式、路由、导航、会话、空壳工作区、三语 i18n；typecheck 与单测全绿。
- 已完成 `VideoPromptSpec` schema 与容错解析，以及编译器设计（含能力位降级规则）。
- 代码在个人仓库（公开）：`https://github.com/sangsang-aa/prompt-optimizer`，分支 `feature/video-mode`。
- 详细设计与实施记录：[video-mode-design.md](https://github.com/sangsang-aa/prompt-optimizer/blob/feature/video-mode/docs/architecture/video-mode-design.md)、[133-video-mode](https://github.com/sangsang-aa/prompt-optimizer/tree/feature/video-mode/docs/archives/133-video-mode)。

### 验证方式

- `pnpm typecheck:core` / `pnpm typecheck:ui`
- `pnpm -F core test` / `pnpm -F ui test`
- `pnpm check:locale` / `pnpm check:no-chinese-runtime`
- 手工：进入 `/video/create`、刷新恢复、模式互不影响、非法子路由重定向、360px 窄屏。

### 想请维护者确认

1. 是否接受新增一级模式的方向？还是希望先做成 Image 模式下的一个子模式 / 独立应用？
2. 如果接受，PR 粒度希望怎么切：骨架 → 编译器 → 生成，三个独立 PR 是否合适？
3. 视频供应商适配是否需要 feature flag 或默认关闭，避免影响现有用户？
4. 文档应放在 `docs/architecture/` 还是先留在 `docs/archives/`？

---

## 提交检查清单

- [x] 仓库与分支已填入
- [ ] 附 1 张 `/video/create` 截图（可选）
- [ ] 确认不包含任何 API Key、`.env.local`、真实响应中的签名 URL
- [ ] 若维护者倾向小步提交，先只发骨架 PR
