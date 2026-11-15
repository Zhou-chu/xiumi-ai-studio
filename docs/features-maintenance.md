# 功能维护入口

功能状态、需求编号和未完成项统一维护在 [持续功能需求与实现清单](./functional-requirements.md)。主分支交付背景见[交付状态](https://github.com/Zhou-chu/xiumi-ai-studio/blob/9d7493487713ec1a07dea313062ccbe67e6e3fb4/docs/release-status.md)。这里不重复维护一份功能状态表。[共同规范](../UIdesign.md)与 [Xiumi 产品设计入口](../DESIGN.md)说明设计约束。

## 独立分支的验收边界

| 快照 | 已核实的证据 |
| --- | --- |
| 隔离候选 `428e13ae` | [Linux 严格单元覆盖门禁](https://github.com/Zhou-chu/xiumi-ai-studio/actions/runs/43676652644)和 [Windows 源码 CI（Node 22.19 / 24）](https://github.com/Zhou-chu/xiumi-ai-studio/actions/runs/43676652655)均通过。[独立 Windows 打包验证](https://github.com/Zhou-chu/xiumi-ai-studio/actions/runs/43677545508)检出该精确源码，25 项验证及 102 项打包浏览器测试通过。 |
| 独立质量候选 `9d2149a` | AI 模型目录解析及选择器键盘逻辑整理。[Windows 源码 CI（Node 22.19 / 24）](https://github.com/Zhou-chu/xiumi-ai-studio/actions/runs/43680745061)通过；不沿用上一行的安装包验收。 |

以上是分支验证，不是发布或部署。未取得该质量快照的正式 SonarQube/SonarCloud 门禁结果，也未验证真实用户台式机安装或部署。离线/合成测试不代表外部 AI 服务或微信真机验收。
