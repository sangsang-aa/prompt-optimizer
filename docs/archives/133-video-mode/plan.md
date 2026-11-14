# 133-video-mode - 阶段计划

设计依据：[video-mode-design.md](../../architecture/video-mode-design.md)（§6 分阶段实施计划）。

## 阶段状态

| 阶段 | 目标 | 状态 | 交付物 | 验收 |
| --- | --- | --- | --- | --- |
| Phase 0 | 供应商与 API 验证；环境可用 | 🔄 进行中 | 一份真实响应 JSON、能力位确认 | 本机能生成 1 条 4s/3:4 视频；Web/桌面可用性结论 |
| Phase 1 | 模式骨架 + 结构化提示词（不接生成） | ⬜ 未开始 | `VideoPromptSpec`、`structured/compact` 编译、路由/会话/历史/收藏/i18n | 能进 `/video/create`，刷新不丢，其它三模式不受影响 |
| Phase 2 | 接入 Seedance 2.0 Fast 生成 | ⬜ 未开始 | VideoService/Adapter/ModelManager、参数面板、预览/下载/取消 | 提交→排队→生成→成功；失败可读；无大体积写入 |
| Phase 3 | 能力补齐 | ⬜ 未开始 | 对比、提示词评估、桌面完善 | 能力矩阵 ✅/◐ 项均有验证记录 |

## Phase 0 检查项

- [x] Node 版本对齐（`E:\tools\node-v24.22.3-win-x64`，`pnpm@10.6.1`）
- [x] `pnpm typecheck:core` / `typecheck:ui` 基线为绿（UI 需先构建 core）
- [x] `pnpm check:locale` / `check:no-chinese-runtime` 通过
- [ ] Seedance API 提交/查询/下载跑通，保存响应样本
- [ ] 确认能力位：`cameraFixed / frames / seed / negativePrompt / firstLastFrame / audioDefault`
- [ ] 确认默认时长、比例、分辨率与计费方式
- [ ] Web 端 CORS 结论（不通则走桌面主进程代理）

## Phase 1 交付顺序（最小垂直切片）

1. `FunctionMode` 加 `video` + 全局设置 + 存储键
2. 路由 `/video/create` + 守卫 + 启动恢复
3. 会话键 `session/v1/video-create` + 空壳 store
4. 空壳 `VideoWorkspace` + i18n 三语
5. `VideoPromptSpec` + 编译器（core 单测）
6. 模板、历史、收藏、备份的类型分支

每步完成后必须跑：

```powershell
pnpm typecheck:core
pnpm typecheck:ui
pnpm test:unit
pnpm check:locale
pnpm check:no-chinese-runtime
```

## 门禁（提交前）

| 命令 | 作用 |
| --- | --- |
| `pnpm lint` | UI/MCP lint + core/ui/web/extension typecheck |
| `pnpm test:unit` | 全仓单测 |
| `pnpm check:locale` | 中/英/繁键一致 |
| `pnpm check:no-chinese-runtime` | 运行时代码无中文文案 |
| `pnpm test:e2e:gate:replay` | 主流程 E2E（replay，不调用真实 API） |
