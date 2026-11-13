# Integrated candidate verification ledger

This is an in-progress ledger, not a release approval.

- Baseline committed candidate: c961c78. New work is not deployed to port 5174.
- Initial integrated check: lint/typecheck passed; 866 unit tests passed.
- First full browser run: 118/122 passed. Failures identified: transient Windows atomic-index rename, extracted prompt whitespace, selected-scope context leaking summaries, and one obsolete summary-context assertion. Fixes are being incorporated, not hidden with retries or weaker assertions.
- Independent review found and fixed colored-background loss during HTML restructuring, base-index versus cumulative-index insertion mismatch, 300-character slot truncation before whole-slot replacement, stale crop callbacks, and unhandled rich-copy promise failures.
- Targeted red/green review and layout browser run: 19/19 passed before later safety fixes; must rerun on final frozen source.
- Code smell scan: 83 warnings, 0 errors. This is not zero technical debt; historical complexity remains in editor/store/compiler and the route factory. All-source quality gate is separate from normal lint.
- Credential-pattern scan: 606 tracked/unignored files inspected; no sk-prefixed credential matches. This is a bounded pattern check, not a comprehensive security certification.
- A full coverage run performed while concurrent agents were modifying tests is invalid as final evidence. Final measurement must run after source freeze, with all src + server included and all four metrics >=90%.
- Real model browser gate is prepared separately in tests/live; it must not be described as passed before execution. Synthetic E2E provider responses are explicitly identified in tests.

## 冻结候选最终技术验证

- 2026-11-13 UTC：lint、TypeScript、997项单元测试全部通过。
- 全部104个src/server文件纳入，未通过排除未导入业务文件缩小分母：语句96.84%（9264/9566）、分支91.82%（7298/7948）、函数97.30%（2528/2598）、行98.32%（7062/7182）。完整计数与源码哈希见 integrated-coverage.json。
- 正式构建通过；仍有主JS分包超过500KB提示，未伪装消除。
- 122/122完整Chromium回归通过（6.5分钟），关闭自动更新快照。原四个失败均经定位修复后重跑；涉及素材索引、prompt原字节、单选数据范围与更新后的更严格断言。
- Windows PowerShell与PowerShell 7部署保护测试均通过。
- Code smell扫描83项warning、0error。这不是90分。用户新增的“评分>90”需要原生工具口径及可用许可，目前未测，不能将本项写为通过。
- 台式机可见Chromium使用现有真实DeepSeek/deepseek-flash运行live gate：实际返回HTML chapters结构操作，审阅接受、保存、刷新成功；随后单选编辑仅返回所选模块。配置凭据文件哈希未变。完整非敏感结果见live/model-gate.json。
- 5176隔离预览已更新；原5174及main未替换。后续发布还受新增评分要求约束。

### 用户可检查的视觉证据

- visual-evidence/block-review/chinese-desktop.png、chinese-phone.png：完整红原模块、下方绿建议、右上接受/拒绝。
- 同目录desktop/tablet/phone的light/dark截图：多尺寸真实长文及状态。
- visual-evidence/live-gate-layout.png与live-gate-after.png：真实模型提案及保存后的分章结果。
- visual-evidence/text-typography/：字体、字号与手机工具栏。
- before旧气泡截图仅用于被替代交互的历史对照；不得冒称所有操作数量完全相同的像素差异实验。原主题改造的同内容基线沿用既有before/after验收记录。

### 明确限制

硬件触摸与屏幕阅读器尚未实机验收；外部CDN全网可用性未保证。复杂HTML岛保持原子并明确告知，非任意结构或图片内文字重绘。生成180秒总时限仍存在，设置更高输出token不代表无限生成时长；其他业务路由各自输入上限仍需按用途解释。真实API证据与模拟提供商E2E分开记录。
