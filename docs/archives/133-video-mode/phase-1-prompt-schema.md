# Phase 1：视频提示词规格 schema 与容错解析

> 范围：只做 `VideoPromptSpec` 的类型/schema/归一化/解析，不做编译、不接 UI、不调模型。
> 目的：先把“LLM 输出 JSON → 可信的统一规格”这条边界钉死，后续编译器和会话恢复都复用它。

## 1. 新增内容

| 文件 | 作用 |
| --- | --- |
| `packages/core/src/services/video/prompt-spec.ts` | 规格类型、zod 输入契约、归一化、`parseVideoPromptSpec` / `normalizeVideoPromptSpec` |
| `packages/core/tests/unit/video/prompt-spec.test.ts` | 12 个用例：正常解析、围栏/尾逗号修复、包装解包、清洗、夹取、默认值、超长截断、深嵌套、失败分支 |
| `packages/core/src/index.ts` | 导出 `./services/video/prompt-spec` |

运行时无中文：错误/警告只给 code，文案由 UI i18n 负责。

## 2. 数据契约

```ts
type VideoPromptStyle = 'structured' | 'compact' | 'auto'

interface VideoPromptSpec {
  subject:  { description: string; mustKeep?: string[]; mustNotChange?: string[] }
  framing:  { shot?: 'wide'|'full'|'medium'|'close_up'|'extreme_close_up'; subjectHeightRatio?: number; marginRatio?: number }
  camera:   { locked?: boolean; angle?: 'eye_level'|'low'|'high'|'top'|'dutch'; lens?: string; movement?: string }
  motion:   { beats?: Array<{ start: number; end: number; description: string }>; secondary?: string[]
              rootMotion?: 'in_place'|'translate'; loopSeam?: 'closed'|'open'|'mirror'
              locomotion?: boolean; suspended?: boolean }
  style:    { render?: string; lighting?: string; palette?: string[]; negativeStyle?: string[] }
  background?: { type: 'solid'|'scene'|'chroma'; color?: string; description?: string }
  negative: string[]
  promptStyle?: VideoPromptStyle
  assumed?: string[]
}
```

- `framing` / `camera` / `motion` / `style` 归一化后**始终存在**（可为空对象），消费方不用判空。
- `negative` 始终是数组。
- `background` 仅在输入出现时保留。
- 时长/比例/分辨率/seed/audio 不进 spec，留给编译参数与参数面板。

## 3. 解析流程

```
raw ──size/empty 检查──> 候选提取 ──> JSON.parse ──失败──> jsonrepair
                                   │
                                   └─> 解包单键包装 ─> 去 null / trim ─> zod ─> 归一化
```

- 候选顺序：围栏代码块 → 从首个 `{` 开始的平衡对象 → 原文。
- `jsonrepair` 只处理包含 `{` 的候选，避免把普通散文“修”成 JSON 字符串。
- 单键包装（如 `{ "videoPromptSpec": { ... } }`）自动解包。
- 任何失败都不抛异常，返回 `{ ok: false, code }`。

### 错误码

| code | 触发条件 |
| --- | --- |
| `video.spec.error.empty` | 输入不是字符串或全空白 |
| `video.spec.error.too_large` | 超过 64 KB |
| `video.spec.error.invalid_json` | 没有可解析的 JSON 对象 |
| `video.spec.error.invalid_schema` | JSON 可解析但规格不合法（缺 `subject.description`、枚举值错误等） |

### 警告码

| code | 含义 |
| --- | --- |
| `video.spec.warning.repaired` | 使用了围栏/断句截取、解包或 jsonrepair，结果可信但经过修复 |

## 4. 归一化规则

| 项 | 规则 |
| --- | --- |
| 字符串 | 统一 trim；空串丢弃 |
| 列表 | trim、忽略大小写去重、丢弃空项、上限 24 |
| `subject.description` | 必填；trim 后为空视为 schema 失败 |
| 比例字段 | 夹到 0–1 |
| `motion.beats` | 夹到 0–1；`end <= start` 丢弃；按 start 排序；上限 24 |
| `background.type` | 缺省为 `scene`，并在 `assumed` 记 `background.type` |
| 未知字段 | 丢弃（zod strip） |
| `null` | 对象里的 null 字段丢弃；数组里的 null 项丢弃 |
| 超长文本 | 单个文本截到 2000 字符，列表项截到 400 字符 |
| 嵌套深度 | 超过 32 层的未知结构丢弃，避免深嵌套输入拖垮递归 |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck:core` | ✅ |
| `pnpm -F core test tests/unit/video/prompt-spec.test.ts` | ✅ 12 passed |
| `pnpm -F core test` | ✅ 1500 passed / 152 skipped |
| `pnpm check:no-chinese-runtime` | ✅ |

## 6. 暂不做

- `structured` / `compact` 两种编译与能力位降级（下一步）。
- `GENERIC_VIDEO_CAPABILITIES` 与 warning 的能力位部分。
- UI 接线、模板、会话字段。
- `promptStyle` 的默认值不在解析层补，交给编译选项决定，避免持久化出隐式状态。
