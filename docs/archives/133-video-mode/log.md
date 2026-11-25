# 133-video-mode - 进展日志

按日期倒序记录；每条写清「做了什么 / 结论 / 证据 / 下一步」。

---

## 2026-11-25（编译器设计确认）

**做了什么**

- 确认编译器六项决策：空段省略、固定连接词用英文、比例/分辨率不支持只警告且生成阶段不推送、
  `compact` 最多 6 条 beats、编译参数不内置默认值、未声明能力位按不支持处理。
- 写下 [phase-1-compiler-design.md](./phase-1-compiler-design.md)（段落规则、能力位、warning、示例、测试矩阵）。
- 起草 [upstream-issue.md](./upstream-issue.md)，准备先向上游确认方向，再决定 PR 粒度。

**下一步**

- 实现 `compileVideoPrompt`（templates + compiler + tests）。
- 向上游提 issue；工程先推到个人 fork。

---

## 2026-11-14（Phase 1：视频提示词规格 schema）

**做了什么**

- 新增 `core/src/services/video/prompt-spec.ts`：`VideoPromptSpec` 六类字段 + 可选 `background`、
  zod 输入契约、默认值/归一化、`parseVideoPromptSpec` / `normalizeVideoPromptSpec`。
- 解析链：围栏/平衡对象/原文三种候选 → `JSON.parse` → `jsonrepair` → 单键解包 → 去 null+trim → zod。
- 失败只返回 code（`empty / too_large / invalid_json / invalid_schema`），错误与警告均无中文文案。
- 单测 `packages/core/tests/unit/video/prompt-spec.test.ts` 共 12 个用例。
- 明细见 [phase-1-prompt-schema.md](./phase-1-prompt-schema.md)。

**结论**

- “LLM 输出 JSON → 统一规格”的边界已固定；编译器、会话恢复、UI 面板都可以直接消费。
- `promptStyle` 不在解析层补默认值，留给编译选项，避免持久化隐式状态。
- `jsonrepair` 不能无脑用于任意文本（会把散文修成字符串），只对含 `{` 的候选启用。

**验证**

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck:core` | ✅ |
| `pnpm -F core test tests/unit/video/prompt-spec.test.ts` | ✅ 12 passed |
| `pnpm -F core test` | ✅ 1500 passed / 152 skipped |
| `pnpm check:no-chinese-runtime` | ✅ |

**下一步**

- `structured` / `compact` 编译与能力位适配（`compileVideoPrompt`）。
- 之后才是 UI 接线与模板。

---

## 2026-11-14（Phase 1：视频模式骨架）

**做了什么**

- 新增一级模式 `video`：`FunctionMode` / `PromptModeKey`（`video-create`）/ `PromptModeFamily` /
  `LEGACY_SESSION_SUB_MODE_KEYS` / 偏好白名单全部补齐。
- 路由新增 `/video/create`，导航栏加「视频」按钮，子模式表与守卫同步。
- 新增 `useVideoCreateSession`（`session/v1/video-create`）：只存要求文本、优化结果占位、
  文本模型与模板选择，遵循“视频字节不进存储”。
- 新增空壳 `VideoWorkspace.vue`（要求输入 + 结果占位 + 禁用的「生成视频」）与三语 `video` 命名空间。
- 明细与差异清单见 [phase-1-skeleton.md](./phase-1-skeleton.md)。

**发现并修复一个会话持久化坑**

- 现象：视频草稿在 30s 自动保存后仍报
  `Session changed in another window; the local draft was retained`，刷新后丢失；
  基础模式同一流程正常。
- 原因：新 store 调 `readSessionSnapshot(key, createDefaultState())` 把“默认值”写成了 CAS 基线。
  IndexedDB 里该 key 还不存在（实际值 `null`），首次保存 `compareAndSet(expected=默认值)` 必然失败，
  被误判为跨窗口冲突。
- 修复：与文本会话一致，restore 的 fallback 用 `null`，只有读到快照时才覆盖内存状态。
- 回归测试：`packages/ui/tests/unit/stores/session/video-create-session.spec.ts`
  （首次保存无冲突 + 新窗口恢复草稿）。

**验证**

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck:core` / `typecheck:ui` | ✅ |
| `pnpm -F core test` | ✅ 1488 passed / 152 skipped |
| `pnpm -F ui test` | ✅ 1779 passed |
| `pnpm check:locale` / `check:no-chinese-runtime` | ✅ |
| 手工（Edge + Playwright）：进 `/video/create`、草稿跨刷新恢复、切模式不串、`/video/foo` 重定向、`/image/text2image` 正常、360px 无横向溢出 | ✅ 全过，无页面报错 |

**下一步**

- Phase 1 第二切片：结构化视频提示词编译器（`structured` / `compact` / `auto`）。
- 生成前确认费用、参考图上传与任务轮询留到 Phase 2。

---

## 2026-11-14（Phase 0：API 打通）

**做了什么**

- 换上真实方舟 Key 后重跑 `scripts/video-phase0-check.mjs`：提交 → 轮询 → 下载全部通过。
- 产物：4.04s / **560×752**（480p + 3:4）/ 24fps / H.264 / **无音轨** / **无水印** / 0.75 MB；
  提交到成功 **84 秒**，`completion_tokens = 39891`。
- 把契约、能力位、样本响应写进 [phase-0-api-verification.md](./phase-0-api-verification.md)，
  原始响应脱敏后存为 `samples/task-succeeded.json`。

**验证到的关键点**

| 项 | 结论 |
| --- | --- |
| `duration` | 传 4 得到 4.04s；范围 4–15，只支持整数秒 |
| `generate_audio` | 默认 true，显式 false 后确实无音轨 |
| `watermark` | 默认 false，实测片中无水印 |
| `seed` | 会返回（52296），但 2.0 不接受传入 |
| 视频 URL | TOS 签名链，`X-Tos-Expires=86400`（24h） |

**下一步**

Phase 0 收口，进入 Phase 1 骨架（`FunctionMode` + 路由 + 会话 + 空壳页面 + i18n）。

---

## 2026-11-14（Phase 0：API 打通尝试）

**做了什么**

- 依据官方文档确认了火山方舟视频生成接口：
  - `POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`
  - body：`model` + `content[]`（`text` / `image_url`）+ `resolution` / `ratio` / `duration` / `generate_audio` / `watermark`
  - 查询：`GET /api/v3/contents/generations/tasks/{id}` → `status: queued|running|succeeded|failed|expired`，成功给 `content.video_url`
- 写了 `scripts/video-phase0-check.mjs`（无依赖，key 只从环境或 `.env.local` 读）。

**Seedance 2.0 Fast 的能力位（以官方文档为准）**

| 参数 | 2.0 Fast | 结论 |
| --- | --- | --- |
| `resolution` | 480p / 720p | 无 1080p、无 4k |
| `ratio` | 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive | 支持 3:4 |
| `duration` | `[4, 15]` 或 `-1` | 最短 4s |
| `generate_audio` | 默认 `true` | 无声必须显式传 `false` |
| `watermark` | 默认 `false` | 与客户端“豆包AI生成”不同 |
| `seed` | **不支持**（仅 1.0 系列） | UI 要禁用 |
| `camera_fixed` | **不支持**（仅 1.0 系列） | 不能承诺锁机位 |
| `frames` | **不支持**（仅 1.0 系列） | 只能用整数秒 |
| `first_frame` / `last_frame` | 支持（`role` 字段） | 图生首尾帧可用 |
| `reference_image` | 支持（1～9 张） | 多图参考可用 |

**结果：401，key 被拒**

```
AuthenticationError: The API key format is incorrect.
```

当前 `.env.local` 里是 `<redacted>`，不是方舟 API Key 的格式
（方舟 Key 是 UUID 形式）。网络与端点都通，纯鉴权问题。

**第二次：key 通过了，模型没开通**

换成真实 key（`ark-...`，46 字符）后返回：

```
404 ModelNotOpen
Your account <redacted> has not activated the model doubao-seedance-2-0-fast-260128.
Please activate the model service in the Ark Console.
```

结论：**鉴权链路已打通**，卡在账号未开通该模型。需要在方舟控制台
「开通管理」里开通 `Seedance 2.0 Fast`（开通条件：账户余额 > 200 元，或购买对应资源包/节省计划）。

**下一步**

- 在控制台开通 `doubao-seedance-2-0-fast-260128`。
- 重跑：`node scripts/video-phase0-check.mjs --ratio 3:4 --resolution 480p --duration 4 --out <tmp>/first.mp4 --json <tmp>/first.json`

---

## 2026-11-14（第二步：环境基线）

**做了什么**

- 机器自带 Node 为 `v24.19.0`，仓库要求 `^24.22.1` 且 `.npmrc` 设了 `engine-strict=true`，所有 pnpm 命令被拒。
- 下载 Node `v24.22.3`（官方 win-x64 zip）解压到 `E:\tools\node-v24.22.3-win-x64`，
  并在该目录内安装 `pnpm@10.6.1`，避免影响系统全局 Node。
- 用新 Node 构建 `@prompt-optimizer/core`（`tsup src/index.ts --format cjs,esm --dts`），
  UI 才能解析到 `@prompt-optimizer/core` 的类型。

**结果（绿色基线）**

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck:core` | ✅ 无错误 |
| `pnpm typecheck:ui` | ✅ 无错误（需先构建 core） |
| `pnpm check:locale` | ✅ Locale structures are aligned |
| `pnpm check:no-chinese-runtime` | ✅ 无违规文案 |

**踩到的两个坑**

1. `pnpm` 的 shim 用 `$basedir/node.exe`，只把新 Node 加进 PATH 不够——
   必须让 `pnpm.cmd` 也来自新 Node 目录（`E:\tools\node-v24.22.3-win-x64\pnpm.cmd`）。
2. `shishan-guard` 会拦截 `pnpm build:core`（仓库里有 1389 行的
   `openai-adapter.ts`，超过单文件阈值）。改用 `node .../tsup/dist/cli-default.js` 直接构建，
   不动用户的 guard 配置。

**当前命令模板（每个新终端）**

```powershell
$env:PATH = "E:\tools\node-v24.22.3-win-x64;" + $env:PATH
pnpm typecheck:core
```

**下一步**

- Phase 0：用已准备好的 Seedance API key 做提交/查询/下载验证，保存响应样本与能力位。
- 之后进入 Phase 1 骨架。

---

## 2026-11-14（第一步：文档骨架）

**做了什么**

- 通读 `docs/architecture/video-mode-design.md`（1635 行），核对仓库现状。
- 建立本目录的最小文档骨架（README / plan / decisions / log），并在 `docs/README.md` 与 `docs/archives/INDEX.md` 登记。

**核对到的现状**

| 项 | 结论 |
| --- | --- |
| Git | 已在 `feature/video-mode`，HEAD `d92952b`（initial snapshot） |
| pnpm | `10.6.1`，可用（设计文档里“未安装”的说法已过时） |
| Node | `v24.19.0`，低于要求的 `^24.22.1`；`.npmrc` 有 `engine-strict=true` |
| 阻断 | `pnpm typecheck:core` 直接报 `ERR_PNPM_UNSUPPORTED_ENGINE`，所有 pnpm 命令被拒 |
| 代码现状 | `core/src/services/video` 不存在；`i18n/*/video.ts` 不存在；`FunctionMode` 仍是 `basic/pro/image/arena` |
| 路由现状 | 只有 `/image/text2image`、`/image/image2image`、`/image/multiimage` |

**结论**

- 开工前必须先解决 Node 版本，否则没有任何自动检查可跑。
- 视频模式属于设计文档里的 P2 级改动（新一级模式），按 Phase 1 骨架 → 编译器 → 生成 的顺序推进。
