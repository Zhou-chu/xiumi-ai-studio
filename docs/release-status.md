# Xiumi fork 交付状态（2026-11-14）

本页是当前状态入口；早期审计和阶段报告保留历史数值，不代表当前失败或通过。

## 已合入与待合入

- fork main：`f1b28d5c06f9fd0a6b68539a3a61b50409c2bc3a`，PR #13 已合并。Node 22.19.0 与 24 的完整 CI 均通过：[run 43564252614](https://github.com/Zhou-chu/xiumi-ai-studio/actions/runs/43564252614)。
- 当前 PR #14：修正 SonarCloud 自动分析的 SOURCE/TEST 分类，保留全部 120 个 JS/TS 生产文件及生产 PowerShell；测试仍参与分析，并非删除。范围审计已加入双 Node CI。尚未合并，旧 PR 合成提交 Node 24 因全页 networkidle 等待超时；现已改成精确版本响应完成，并用持续无关请求先红后绿验证，所有原恢复/保存/撤销断言保留。最新候选完整 CI 待读回，不能用旧 push 绿灯替代。
- 原仓库 [PR #4](https://github.com/123huangcan250/xiumi-ai-studio/pull/4) 已更新至 `a56b5589`，保留上游回放/打包/备份并回应十项反馈。587 单测、43 开发 E2E、25 打包验证、43 打包 E2E 为该不同候选的结果，不能替代 fork 验收。远端 CI [43568192694](https://github.com/Zhou-chu/xiumi-ai-studio/actions/runs/43568192694) 的 Node 22.19/24 已全部通过。
- 全套新编辑式 UI 向原仓贡献仍需兼容整合，不能把 PR #4 的可靠性更新说成全部 UI 已贡献。

## 已合入功能和证据

FR-24—FR-30 的红绿整块审阅、防过期/撤销保护、自然语言图片入库、选择同步、Ctrl/Cmd 多选、文字字体字号/B/I/U/颜色和图片拖拽均已包含于上述 main。导入 HTML 支持受控 editorial/chapters 重排；复杂区块作为原子保留并说明，不能安全拆解时拒绝，不承诺任意重做。

共用 `docs/design/shared-ui.md` 与产品 `DESIGN.md` 约束黑白编辑式外壳、本地中文字体、可读字号、黑灰扩散背景和柔和浮层；文稿/导出不继承应用主题。视觉证据位于 `visual-evidence`，含 1440×900、1024×768、390×844 同内容对照及弹窗/失败状态。

fork 已验证：1290 单测、134 E2E；全 120 个生产 JS/TS 源文件（含 scripts/templates）语句 97.05%、分支 92.22%、函数 97.39%、行 98.44%，四项门槛 90.01%。PowerShell 20 项测试，211/215 命令覆盖 98.14%，没有伪造其不支持的指标。真实 DeepSeek 浏览器 live gate 与模拟模型 E2E 分开记录，密钥未写入交付报告。见 `docs/qa/expanded-source-coverage.json`、`docs/qa/resource-final-gate.json` 及 `docs/qa/live/model-gate.json`。

## Sonar：本机与云端分开

本机精确 `8c42163`（与合并 main 生产树相同）Overall Gate OK；MQR 维护/可靠/安全均 A，开放项 0，综合覆盖 95.4%。历史 41 项为 20 Fixed、20 经逐项证据复核的 False Positive、1 Accepted。

S5693 的 30 MiB 上传阈值由用户明确选择保留并接受具体残余风险，不是误报或风险消除。磁盘流式上传、并发门禁、DOCX 实际解压预算、图片输入/输出预算和失败清理见资源预算报告。硬杀临时残留、全业务 RSS/总 CPU 时间未完全封顶，不隐瞒这些限制。

Cloud main `f1b28d5` 的 Gate OK 仅使用新代码门槛；A/A/A 是 legacy ratings，不是完整 MQR 清零。实际仍有 31 项可靠性/可维护性影响（20 项 UI 上下文报告、11 项测试报告），安全影响 0；自动分析不导入覆盖率。PR #14 分类修复是否关闭旧测试项必须在 main 重新分析后读回。Cloud 的 20 项 UI 处置尚待明确批准，未发表说明或改状态。不能声称 Cloud 全量验收已通过。

## 与上游反馈的适用差异

fork 已含最低 Node 矩阵、强度拒绝指导、端到端建议取消、行级富文本空格和同源设置保留。fork 的所选模块严格 update-only/多选边界是当前产品契约；不照搬上游默认 filter 和相邻插入。上游 20 秒头部/60 秒正文分阶段预算与不可变导出计划是后续可移植项，目前 fork 仍用原抓取总时限及重复预检，不将未移植功能写为已完成。上游独有 portable runtime/replay/backup 不能整文件覆盖回 fork。

## 未覆盖与部署边界

原 5174 实例和用户数据没有被替换。真实微信发布、外网全部 CDN、真机触摸和屏幕阅读器未全面验收；浏览器模拟窄屏不等于真机。保留已知大 chunk 构建提示及开发依赖 advisory；没有宣称零风险或所有平台兼容。后续合并、CI、Cloud 读回结果应更新本页，不改历史报告来制造全绿。
