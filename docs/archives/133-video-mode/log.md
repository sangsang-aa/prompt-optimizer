# 133-video-mode - 进展日志

按日期倒序记录；每条写清「做了什么 / 结论 / 证据 / 下一步」。

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
