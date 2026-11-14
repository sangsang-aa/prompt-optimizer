# 133-video-mode - 视频模式（Video Mode）

## 概述

在 Basic / Context / Image 之外新增一级模式 **Video**：输入视频要求（可选 0～4 张参考图）→ 优化成结构化视频提示词 → 选择视频模型生成短片预览。生成结果只保留在本次会话，视频字节不进数据库。

本目录**只放视频功能的开发过程记录**（计划、决策、进展、验收、复盘）。
完整架构分析、文件清单与风险表在 [video-mode-design.md](../../architecture/video-mode-design.md)，本目录不重复正文，只做索引与增量。

## 时间线

| 项 | 值 |
| --- | --- |
| 开始 | 2026-11-14 |
| 完成 | — |
| 状态 | 🔄 Phase 0（环境与供应商验证） |
| 分支 | `feature/video-mode` |

## 文档清单

- [x] `README.md` - 总览与分类规则（本文件）
- [x] `plan.md` - 阶段计划与当前状态
- [x] `decisions.md` - 已确认决策与边界
- [x] `log.md` - 按日期的进展记录
- [ ] `phase-1-skeleton.md` - Phase 1 骨架实施记录（开工后补）
- [ ] `phase-2-generation.md` - Phase 2 生成链路实施记录
- [ ] `verification.md` - 自动检查 + 手工验收证据
- [ ] `experience.md` - 经验总结（完工后写）

## 影响范围

- 包：`@prompt-optimizer/core`、`@prompt-optimizer/ui`、`@prompt-optimizer/web`、`@prompt-optimizer/desktop`
- 暂不动：`extension`、`mcp-server`（Phase 3 再评估）
- 新增一级模式属 P2 级改动：跨 30–40 个文件，主要集中在联合类型、路由、会话、i18n

## 文档归类规则（完工后执行）

| 内容 | 去处 |
| --- | --- |
| 最终架构与接口契约 | `docs/architecture/video-mode-*.md` |
| 面向后续开发者的操作指南 | `docs/developer/` |
| 本次开发的决策、日志、验收证据 | 保留在本目录（归档，不再改动） |
| 复盘与可复用经验 | 本目录 `experience.md` + `docs/archives/INDEX.md` 索引 |

一句话：**过程留在这里，结论进 architecture/developer，索引两边都登记。**
