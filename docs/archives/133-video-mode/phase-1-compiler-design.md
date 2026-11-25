# Phase 1：视频提示词编译器设计（已确认）

> 状态：设计已确认，待实现。
> 输入：已归一化的 `VideoPromptSpec`（见 [phase-1-prompt-schema.md](./phase-1-prompt-schema.md)）+ 编译参数。
> 输出：`structured` / `compact` 提示词、可选独立负面词、解析后的参数、warning code。
> 纯函数、无 I/O、无中文文案、无随机性。

## 1. 边界

| 层 | 职责 |
| --- | --- |
| core | 段落渲染、`auto` 选择、能力位适配、参数吸附、warning code |
| ui | 传参数、展示与复制、把 code 翻译成文案 |
| 适配器 | 只负责把 `prompt / negativePrompt / params` 发出去 |

验收句：给同一 `spec + params + capabilities`，永远得到同一结果；不支持的模型能力不假装支持，所有降级都有 code。

## 2. 契约

```ts
interface VideoPromptParams {
  durationSec: number
  aspectRatio: string
  resolution: string
  /** 本产品先固定 false（已决策不做音频） */
  audio?: boolean
  seed?: number
}

interface VideoPromptCapabilities {
  durations?: number[]
  aspectRatios?: string[]
  resolutions?: string[]
  negativePrompt?: boolean
  seed?: boolean
  cameraFixed?: boolean
  promptStylePreference?: 'structured' | 'compact'
}

interface VideoPromptWarning {
  code: string
  params?: Record<string, unknown>
}

interface VideoPromptCompileResult {
  prompt: string
  /** 仅当模型支持独立负面词时返回 */
  negativePrompt?: string
  /** auto 解析后的真实风格 */
  style: 'structured' | 'compact'
  warnings: VideoPromptWarning[]
  params: {
    durationSec: number
    aspectRatio: string
    resolution: string
    audio: boolean
    seed?: number
  }
}

compileVideoPrompt(
  spec: VideoPromptSpec,
  options: {
    promptStyle: 'structured' | 'compact' | 'auto'
    params: VideoPromptParams
    capabilities?: VideoPromptCapabilities
  },
): VideoPromptCompileResult
```

- `params` 由调用方必传，编译器不内置 5s / 16:9 / 720p。
- `capabilities` 缺省时用 `GENERIC_VIDEO_CAPABILITIES`（Phase 0 实测值；未验证的能力位一律 false）。

## 3. `auto` 与保守默认

| 情况 | 结果 |
| --- | --- |
| `structured` / `compact` | 直接使用 |
| `auto` + `promptStylePreference` | 用适配器偏好 |
| `auto` + 无偏好 | `structured` |
| `negativePrompt !== true` | 负面词并入主提示词 |
| `seed !== true` | 不输出 seed |
| `cameraFixed !== true` | 不写锁定机位，只给 warning |

## 4. `structured` 段落（空段省略）

固定顺序；`[SUBJECT]` 与 `[PARAMS]` 始终存在，其余无内容则省略。

| 段 | 来源 | 渲染 |
| --- | --- | --- |
| `[STYLE]` | `style.render / lighting / palette` | `render, lighting, palette: a, b` |
| `[SUBJECT]` | `subject.description / mustKeep / mustNotChange` | `desc; keep: ...; do not change: ...` |
| `[FRAMING]` | `framing.shot / subjectHeightRatio / marginRatio` | `medium shot; subject height about 60% of the frame` |
| `[CAMERA]` | `camera.locked / angle / lens / movement` | `locked-off; eye-level; 35mm lens; slow dolly in` |
| `[BACKGROUND]` | `background.type / color / description` | `solid #101010` / `a rainy neon street` / `chroma key green` |
| `[ACTION]` | `motion.beats / rootMotion / locomotion / suspended` | `0.0-0.4: ...; 0.4-1.0: ...; in-place motion` |
| `[SECONDARY]` | `motion.secondary` | `the scarf sways slightly` |
| `[LOOP]` | `motion.loopSeam` | `seamless loop` / `open-ended` / `mirror loop` |
| `[PARAMS]` | 编译参数 | `duration: 8s; aspect ratio: 3:4; resolution: 480p; audio: off` |
| `[AVOID]` | `negative + style.negativeStyle` | 仅在不支持独立负面词时出现 |

规则：

- 百分比 `Math.round(x * 100)%`，前加 `about`。
- `locked` 与 `movement` 冲突：保留 `locked`，丢弃 `movement`，给 warning。
- beats 已在 schema 限制 24 条，结构化全部输出。
- 仅有 `rootMotion / locomotion / suspended` 时也生成 `[ACTION]`。
- `[PARAMS]` 只做描述，不替代 Phase 2 的请求参数。
- 固定连接词用英文；用户文本原样保留。

## 5. `compact` 一段式

不出现段名、时间戳、params。句子顺序：

1. 主体 + 动作（beats 合并为 `first ..., then ..., finally ...`，最多 6 条）
2. 身份锚点：`keep ...; do not change ...`
3. 构图 + 机位 + 背景
4. 风格 + 次级运动 + 循环
5. `Avoid ...`（负面词并入时）

超过 6 条 beats 才截断，并给 `video.warning.beats_truncated`；structured 不受影响。

## 6. 能力位适配

| 条件 | 行为 | code |
| --- | --- | --- |
| 时长不在 `durations` | 吸附最近值；等距取更短 | `video.warning.duration_clamped` |
| 比例不在 `aspectRatios` | 保留原值 + 警告；**提交前拦截，不推送** | `video.warning.aspect_ratio_unsupported` |
| 分辨率不在 `resolutions` | 保留原值 + 警告；**提交前拦截，不推送** | `video.warning.resolution_unsupported` |
| 有 seed 但 `seed !== true` | 丢弃 seed + 警告 | `video.warning.seed_unsupported` |
| `locked` 但 `cameraFixed !== true` | 不写锁定机位 + 警告 | `video.warning.camera_lock_unsupported` |
| `locked` + `movement` | 保留 locked | `video.warning.camera_lock_ignores_movement` |
| compact beats > 6 | 截断 + 警告 | `video.warning.beats_truncated` |

> 比例/分辨率的“不推送”约束落在 Phase 2 的请求构建器：编译结果带 warning 时，
> 生成按钮进入预检失败状态，用户必须改成支持值才能提交。编译层不偷偷替换用户请求。

## 7. 示例

规格：

```json
{
  "subject": {
    "description": "a black cat wearing a red scarf",
    "mustKeep": ["red scarf", "green eyes"],
    "mustNotChange": ["fur pattern"]
  },
  "framing": { "shot": "medium", "subjectHeightRatio": 0.6 },
  "camera": { "locked": true, "angle": "eye_level", "lens": "35mm lens" },
  "background": { "type": "scene", "description": "a rainy neon street at night" },
  "motion": {
    "beats": [
      { "start": 0, "end": 0.4, "description": "turns its head toward the camera" },
      { "start": 0.4, "end": 1, "description": "takes one slow step forward" }
    ],
    "secondary": ["the scarf sways slightly"],
    "loopSeam": "closed"
  },
  "style": {
    "render": "cinematic 3D animation",
    "lighting": "soft rim light",
    "palette": ["teal", "warm orange"]
  },
  "negative": ["blurry", "extra limbs"]
}
```

参数：`durationSec: 7, aspectRatio: '3:4', resolution: '480p'`
能力位：`durations [4,8]`、`negativePrompt false`、`cameraFixed false`、`seed false`

### structured

```
[STYLE] cinematic 3D animation, soft rim light, palette: teal, warm orange
[SUBJECT] a black cat wearing a red scarf; keep: red scarf, green eyes; do not change: fur pattern
[FRAMING] medium shot; subject height about 60% of the frame
[CAMERA] eye-level; 35mm lens
[BACKGROUND] a rainy neon street at night
[ACTION] 0.0-0.4: turns its head toward the camera; 0.4-1.0: takes one slow step forward
[SECONDARY] the scarf sways slightly
[LOOP] seamless loop
[PARAMS] duration: 8s; aspect ratio: 3:4; resolution: 480p; audio: off
[AVOID] blurry, extra limbs
```

warnings：`duration_clamped {requested:7, actual:8}`、`camera_lock_unsupported`

### compact

```
A black cat wearing a red scarf turns its head toward the camera, then takes one slow step forward; keep the red scarf and green eyes; do not change the fur pattern. A medium shot at eye level with a 35mm lens, the subject fills about 60% of the frame, against a rainy neon street at night. Cinematic 3D animation with soft rim lighting and a teal and warm orange palette; the scarf sways slightly; seamless loop. Avoid blurry, extra limbs.
```

## 8. 文件落点

| 文件 | 内容 |
| --- | --- |
| `core/src/services/video/capabilities.ts` | `VideoPromptCapabilities` + `GENERIC_VIDEO_CAPABILITIES` |
| `core/src/services/video/prompt-templates.ts` | `renderStructured` / `renderCompact` 与段落构造 |
| `core/src/services/video/prompt-compiler.ts` | `auto`、参数吸附、负面词分流、warning 汇总 |
| `core/tests/unit/video/prompt-compiler.test.ts` | 段落快照 + 能力位矩阵 |
| `core/src/index.ts` | 导出 |

## 9. 测试矩阵

| 用例 | 断言 |
| --- | --- |
| 完整 spec + structured | 十段齐全、顺序固定 |
| 最小 spec | 只有 `[SUBJECT]` / `[PARAMS]` / 有负面词时 `[AVOID]` |
| 完整 spec + compact | 单段、无段名、无时间戳 |
| `auto` 默认 | structured |
| `auto` + 偏好 compact | compact |
| 负面词独立 | 无 `[AVOID]`，返回 `negativePrompt` |
| 负面词合并 | `[AVOID]` 含去重后的 negative + negativeStyle |
| 时长 7 + `[4,8]` | 8 + warning |
| 时长 6 + `[4,8]` | 4 + warning |
| 比例/分辨率不支持 | 原值保留 + warning |
| seed 不支持 | 参数与 `[PARAMS]` 都没有 seed + warning |
| 机位锁定不支持 | `[CAMERA]` 无 locked 文案 + warning |
| locked + movement | movement 被忽略 + warning |
| beats 7 条 + compact | 保留 6 + warning；structured 保留 7 |
| 幂等 | 连续两次输出完全一致 |

## 10. 已确认决策

| # | 问题 | 结论 |
| --- | --- | --- |
| 1 | 空段处理 | 空段省略 |
| 2 | 固定连接词语言 | 英文 |
| 3 | 比例/分辨率不支持 | 保留原值 + 警告；后续生成阶段不推送 |
| 4 | compact beats 上限 | 6 |
| 5 | 编译参数默认值 | 不内置，调用方必传 |
| 6 | 未声明能力位 | 按不支持处理 |
