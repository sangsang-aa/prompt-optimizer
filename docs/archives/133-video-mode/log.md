# 133-video-mode - 进展日志

按日期倒序记录；每条写清「做了什么 / 结论 / 证据 / 下一步」。

---

## 2026-11-14

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

**下一步**

1. 对齐 Node 版本，跑通 `pnpm typecheck:core` 作为绿色基线。
2. 拆 Phase 1 第一个垂直切片（类型 + 路由 + 会话 + 空壳页面 + i18n）。
