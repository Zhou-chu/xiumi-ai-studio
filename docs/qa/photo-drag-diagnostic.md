# 可选：照片拖换诊断

历史隔离分支的 `34a74f9`（仅诊断）和 `701d9774`（先启动原生拖拽，再滚动到目标）
解释了一个 Windows 测试片段。该分支的 GitHub Actions 运行 `43624308451`
在旧版项目上观察到 mousedown 和 mouseup 分居不同滚动位置，没有原生
dragstart/dragover/drop。此结果是历史复现，不说明当前候选也会失败。

默认 Playwright 命令没有改 CI、动作、成功提示或“两张照片恰好互换”的断言。
诊断只覆盖测试自产的同一组三张图，测试前可设置：

- `XIUMI_PHOTO_DRAG_DIAGNOSTIC=observe`：保留默认 `dragTo` 加被动事件观察。
- `XIUMI_PHOTO_DRAG_DIAGNOSTIC=native`：按下后轻移启动原生拖拽，确认来自
  第一个槽位，滚动到目标，确认目标上收到 dragover 和 drop，
  再执行原样的内容断言。不用合成 DragEvent、DataTransfer 或动作重试。

PowerShell 示例：

```powershell
$env:XIUMI_PHOTO_DRAG_DIAGNOSTIC = 'observe'
pnpm e2e tests/e2e/features.spec.ts --update-snapshots=none
Remove-Item Env:XIUMI_PHOTO_DRAG_DIAGNOSTIC
```

JSON 附件最多 120 个事件：仅阶段、前三张照片的序号、目标序号、坐标、滚动位置、
是否出现已知传输类型及丢弃计数。没有图片字节、URL、文本、原始传输数据或用户信息。
观察器被动注册并在结束后卸载；附件失败不改测试结果。未声明在当前版本上完成 Windows 实测。

旧分支 `701d9774` 的诊断专用 Windows 运行 `43625016572` 通过 4/4；
它验证了先在原图触发拖拽、再滚动、最后放到不同目标的受控手势。
这是旧提交的诊断记录，不替代当前提交的 Node 双版本 CI 或真实 EXE 运行。
