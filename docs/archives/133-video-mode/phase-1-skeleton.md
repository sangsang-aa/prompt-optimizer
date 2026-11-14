# Phase 1：视频模式骨架（第一切片）

> 目标：点「视频」能进 `/video/create`，输入能存草稿，刷新能恢复，其它三个模式不受影响。
> 不含：提示词优化、参考图、规格编译、生成、历史/收藏/评估/备份的视频专属行为。

## 1. 实际改动

### core（5 个文件）

| 文件 | 改动 |
| --- | --- |
| `services/prompt/types.ts` | `FunctionMode` 加 `'video'`；新增 `VideoSubMode = 'create'` |
| `services/prompt-model/types.ts` | `PromptModeKey` 加 `'video-create'`；`PromptModeFamily` 加 `'video'`；新增 `VideoPromptContract` 并入 `PromptContract` |
| `services/prompt-model/mode.ts` | `PROMPT_MODE_KEYS`、`FavoriteModeCompat`、`LegacyPromptModeInput`、`resolvePromptModeKey`、`promptModeKeyToFavoriteMode`、`createPromptContract` 全部分支补齐 |
| `services/prompt-model/session.ts` | `LEGACY_SESSION_SUB_MODE_KEYS` 加 `'video-create'`；legacy ⇄ prompt mode 映射补齐 |
| `services/preference/global-settings.ts` | `functionMode` 类型与解析白名单加 `'video'` |
| `services/data/workspace-session-transfer.ts` | 备份校验：`video-create` 与 image 模式一样校验 `originalPrompt` 字段 |

### ui（14 个文件）

| 文件 | 改动 |
| --- | --- |
| `router/index.ts` | 新增 `/video/create` → `VideoWorkspace.vue`（懒加载） |
| `router/workspaceRoutes.ts` | 子模式白名单/模式表/正则/默认子模式加 video |
| `router/guards.ts` | 非法 `/video/*` 重定向到 `/video/create` |
| `components/FunctionModeSelector.vue` | 新增「视频」按钮与联合类型 |
| `components/app-layout/AppCoreNav.vue` | 从 `/video` 解析出 `video` 模式；默认子模式 `create` |
| `components/app-layout/PromptOptimizerApp.vue` | 初始路由、`videoSubMode` 解析、session readers 注入 |
| `stores/session/sessionKeys.ts` | `'video-create'` + `session/v1/video-create` |
| `stores/session/useVideoCreateSession.ts` | **新增** 最小会话 store（restore/save，复用共享持久化助手） |
| `stores/session/useSessionManager.ts` | readers 类型、活动 key、projection map、restore 分支 |
| `stores/session/promptSessionProjection.ts` | store map 类型 + video 快照投影 |
| `composables/mode/useFunctionMode.ts`、`stores/settings/useGlobalSettings.ts` | 模式类型/白名单加 video |
| `composables/app/useAppFavorite.ts`、`components/SaveFavoriteDialog.vue`、`components/FavoriteEditorForm.vue` | 收藏相关联合类型放宽到 video（视频收藏本身留到后续切片） |
| `components/video-mode/VideoWorkspace.vue` | **新增** 空壳页面：要求输入框 + 结果占位 + 禁用的「生成视频」 |
| `i18n/locales/{zh-CN,en-US,zh-TW}/video.ts` + 三个 `index.ts` | 新增 `video` 命名空间并注册；`nav.videoMode` |

> 与计划的差异：计划里没算到收藏相关的两处联合类型（`SaveFavoriteDialog`、`FavoriteEditorForm`）和备份校验器，
> 它们是 `typecheck` 直接报出来的遗漏，属于设计文档 §5.8 说的“联合类型清单”。

## 2. 数据契约

```ts
FunctionMode = 'basic' | 'pro' | 'image' | 'video' | 'arena'
PromptModeKey += 'video-create'
PromptModeFamily += 'video'
sessionKey = 'session/v1/video-create'

VideoCreateSessionState = {
  originalPrompt: string
  optimizedPrompt: string
  selectedTextModelKey: string
  selectedTemplateId: string | null
  lastActiveAt: number
}
```

兼容：
- 新 key 只增不改；旧备份没有 `video-create` 时导出/导入照常。
- `video-create` 的备份校验按 `originalPrompt`（与图像模式同形），不是文本模式的 `prompt`。
- 收藏暂不支持视频：`functionMode === 'video'` 时收藏流程按“无可绑定会话”处理（不会写错分类）。

## 3. 验证

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck:core` | ✅ |
| `pnpm typecheck:ui` | ✅ |
| `pnpm -F core test` | ✅ 1488 passed / 152 skipped |
| `pnpm -F ui test` | ✅ 1779 passed |
| `pnpm check:locale` | ✅ |
| `pnpm check:no-chinese-runtime` | ✅ |

为适配新增的第 9 个工作区，更新了 4 个测试的计数与 fixture：
`session-manager.spec`（8→9）、`session-manager-save.spec`（8→9、9→10）、
`workspace-session-transfer.test`（8→9 + video 快照）、`backup-integrity-roundtrip.spec`（video 快照）。
这些是“模式数量变化”的必然结果，不是放宽断言。

新增回归测试 `packages/ui/tests/unit/stores/session/video-create-session.spec.ts`：
首次保存不得误报跨窗口冲突；第二个窗口能恢复草稿。

## 4. 手工验收（Edge + Playwright，1280×800 / 360×780）

| 路径 | 结果 |
| --- | --- |
| 直接访问 `/#/video/create` | 页面渲染，导航显示「基础 / 上下文 / 图像 / 视频 / 竞技场」 |
| 输入草稿 → 等 30s 自动保存 → 刷新 | 草稿原文恢复 |
| 切到基础写草稿 → 刷新 → 回视频 | 基础草稿恢复，视频草稿仍在，互不覆盖 |
| 访问 `/#/video/not-a-mode` | 重定向到 `/#/video/create` |
| 访问 `/#/image/text2image` | 正常渲染，模式未被视频影响 |
| 360px 宽 | `scrollWidth - innerWidth = 0`，无横向滚动 |

页面无 JS 报错。

## 5. 验收中修复的问题

首版 `useVideoCreateSession.restoreSession` 把 `createDefaultVideoCreateState()` 作为
`readSessionSnapshot` 的 fallback，导致 CAS 基线是“默认对象”而存储里是 `null`。
首次自动保存因此被判定为跨窗口冲突（`Session changed in another window`），草稿刷新即丢失。
改为与文本会话相同的 `null` fallback（只有读到快照才覆盖状态）后恢复正常，并补了回归测试。

## 6. 已知遗留

- 「生成视频」按钮禁用，页面仅占位（Phase 2）。
- 收藏/历史/评估没有 video 专属行为；收藏会退化为基础模式（已注释说明）。
- 视频参考图、参数、任务元数据尚未进入会话（后续切片）。
