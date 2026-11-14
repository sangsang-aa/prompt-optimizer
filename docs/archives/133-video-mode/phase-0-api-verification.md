# Phase 0：火山方舟视频 API 验证记录

> 日期：2026-11-14　模型：`doubao-seedance-2-0-fast-260128`　结果：**打通**

## 1. 结论

| 项 | 结果 |
| --- | --- |
| 提交 | ✅ `POST /api/v3/contents/generations/tasks` → 返回任务 `id` |
| 轮询 | ✅ `GET /api/v3/contents/generations/tasks/{id}`，状态 `queued → running → succeeded` |
| 下载 | ✅ `content.video_url` 是带签名的 TOS 直链，可直接 `fetch` |
| 耗时 | 提交到成功约 **84 秒**（4s / 480p / 文生视频） |
| 计费 | 本次 `usage.completion_tokens = 39891` |
| 产物 | 4.04s、560×752、24fps、H.264、**无音轨**、**无水印**、0.75 MB |

实测产物与文档一致：`480p + 3:4 → 560×752`。`generate_audio:false` 生效（ffprobe 只有一条 video stream），`watermark:false` 生效。

## 2. 接口契约（实测）

**创建任务**

```http
POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
Authorization: Bearer <ARK_API_KEY>
Content-Type: application/json
```

```json
{
  "model": "doubao-seedance-2-0-fast-260128",
  "content": [{ "type": "text", "text": "……" }],
  "ratio": "3:4",
  "resolution": "480p",
  "duration": 4,
  "generate_audio": false,
  "watermark": false
}
```

响应只有 `{ "id": "cgt-..." }`（样本：`samples/create-task.json`）。

**查询任务**

```json
{
  "id": "cgt-...",
  "model": "doubao-seedance-2-0-fast-260128",
  "status": "succeeded",
  "content": { "video_url": "<签名 URL，24h 有效>" },
  "usage": { "completion_tokens": 39891, "total_tokens": 39891 },
  "created_at": 1794633850,
  "updated_at": 1794633933,
  "seed": 52296,
  "resolution": "480p",
  "ratio": "3:4",
  "duration": 4,
  "framespersecond": 24,
  "generate_audio": false,
  "output_format": "mp4"
}
```

（样本：`samples/task-succeeded.json`，签名 URL 已替换为占位符。）

注意：`seed` 虽然会**返回**，但 2.0 系列**不接受传入**，只能用于记录，不能用于复现。

## 3. 能力位（以官方文档 + 实测为准）

| 参数 | Seedance 2.0 Fast | 视频模式的处理 |
| --- | --- | --- |
| `resolution` | `480p` / `720p` | 不提供 1080p |
| `ratio` | 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive | 默认 16:9，测试案例 3:4 |
| `duration` | `[4, 15]` 或 `-1` | 最短 4s；UI 用滑杆/枚举 |
| `generate_audio` | 默认 `true` | 必须显式 `false` |
| `watermark` | 默认 `false` | 与客户端不同，这里默认无 |
| `seed` | ❌ 不支持（仅 1.0） | 隐藏输入，只展示返回的 seed |
| `camera_fixed` | ❌ 不支持（仅 1.0） | 不能承诺锁机位 |
| `frames` | ❌ 不支持（仅 1.0） | 只能整数秒 |
| `first_frame` / `last_frame` | ✅ `role` 字段 | 图生首尾帧可用 |
| `reference_image` | ✅ 1～9 张 | 多图参考可用（`role: reference_image`） |

## 4. 对实现的影响

1. **状态机**：`queued/running/succeeded/failed/expired`，轮询间隔 5s 起，实测 84s 内完成；设计文档里的 10–15 分钟超时是安全上限。
2. **URL 有效期**：签名 24 小时（`X-Tos-Expires=86400`）。会话里记 `expiresAt`，过期显示“结果已过期”。
3. **体积**：4s / 480p ≈ **0.75 MB**。720p 会更大，但都远小于“不能进 IndexedDB”的量级——仍然按决策不落库。
4. **参考图**：走 `image_url.url` 的 Base64（`data:image/png;base64,...`）或公网 URL；请求体 ≤ 64 MB，单图 ≤ 30 MB。
5. **错误处理**：鉴权失败返回 `{ error: { code: "AuthenticationError", message, type: "Unauthorized" } }`，要映射成结构化错误码。

## 5. 环境备注

- Node：仓库要求 `^24.22.1`，机器自带 `v24.19.0`，本次用 `E:\tools\node-v24.22.3-win-x64`。
- 复现命令：

```powershell
$env:PATH = "E:\tools\node-v24.22.3-win-x64;" + $env:PATH
node scripts/video-phase0-check.mjs --ratio 3:4 --resolution 480p --duration 4 `
  --out "$env:TEMP\video-phase0\first.mp4" --json "$env:TEMP\video-phase0\first.json"
```

key 从 `.env.local` 或 `ARK_API_KEY` 读取，不入库。
