# Sonar 可访问性逐项核实（基线 4f807b2）

本报告不批量关闭 issue、不修改规则。22项逐项区分语义加固与需正式审阅的误报；未声称屏幕阅读器硬件实测。修改仅 Canvas 两处语义属性，保留全部事件保护。

## 21e320b0-853e-488e-8de9-6b1457437203
- 位置：`src/editor/BlockTextEditor.tsx:17`，`typescript:S6848`（原始报告行号）。
- 判定：保留，事件保护容器。
- 依据：实际编辑控件为 textarea/input/button。外层阻止 click/doubleclick 冒泡，Escape 完成并还原选择按钮焦点，不提供自身点击动作。button 化会嵌套交互控件。
- 回归证据：canvasKeyboardAccess.test.tsx；canvas-keyboard-accessibility.spec.ts。

## a4743892-5b16-478c-967d-ff98fc431c5e
- 位置：`src/editor/Canvas.tsx:113`，`typescript:S6848`（原始报告行号）。
- 判定：保留，编辑外壳。
- 依据：click 只 stopPropagation，防编辑操作被画布当作取消选择；真实 textbox 与原生工具按钮各自可聚焦。
- 回归证据：canvas-keyboard-accessibility.spec.ts。

## dacb21ff-831e-4b06-885a-54c956dabf90
- 位置：`src/editor/Canvas.tsx:125`，`typescript:S6852`（原始报告行号）。
- 判定：加固显式焦点契约。
- 依据：contentEditable 已是原生可编辑焦点入口，并非证实原先无法聚焦。补 tabIndex=0 明确 Tab 契约，真实浏览器由完成按钮 Tab 进入编辑区。
- 回归证据：canvasKeyboardAccess.test.tsx；canvas-keyboard-accessibility.spec.ts。

## 49a76937-ef3a-46c0-babc-ba356988418b
- 位置：`src/editor/Canvas.tsx:205`，`typescript:S6848`（原始报告行号）。
- 判定：保留，片段选择外壳。
- 依据：只阻止父画布取消选择；实际操作在原生前/后片段及取消按钮。
- 回归证据：canvas-keyboard-accessibility.spec.ts。

## d455ba9e-c8f6-4529-bbb4-041aedbbcc3c
- 位置：`src/editor/Canvas.tsx:206`，`typescript:S6848`（原始报告行号）。
- 判定：补具名 group。
- 依据：导航按钮作为同组，显式 role=group / 原文片段选择；方向键/Home/End 已导航片段。非 toolbar 模式，不冒称 roving tab。
- 回归证据：canvasKeyboardAccess.test.tsx；canvas-keyboard-accessibility.spec.ts。

## e515d902-4f0c-4dc2-9a4e-f637cb2e1541
- 位置：`src/editor/Canvas.tsx:221`，`typescript:S6848`（原始报告行号）。
- 判定：保留，作品指针选择等效路径。
- 依据：动态 HTML 片段预览保留点击选择；等效键盘由前/后片段、上下/Home/End、扩大/缩小、收藏和取消按钮完成。不可把嵌入作品包成按钮。
- 回归证据：canvasKeyboardAccess.test.tsx；canvas-keyboard-accessibility.spec.ts。

## 5a53abac-e6a3-4be4-9d8f-d27fb9d4200d
- 位置：`src/editor/Canvas.tsx:284`，`typescript:S6848`（原始报告行号）。
- 判定：保留，错误反馈外壳。
- 依据：阻止内部删除/撤销按钮点击传播为文稿选择；自身无动作。
- 回归证据：canvasDom.test.tsx。

## 2402fff7-2ec4-4420-8d40-62973adf8592
- 位置：`src/editor/Canvas.tsx:414`，`typescript:S6848`（原始报告行号）。
- 判定：保留，工具按钮保护。
- 依据：各操作均原生具名button；外壳stopPropagation防按钮操作误触文稿选择。
- 回归证据：canvasKeyboardAccess.test.tsx；canvas-keyboard-accessibility.spec.ts。

## 430bf194-6881-4499-a205-bc51025f603f
- 位置：`src/editor/Canvas.tsx:571`，`typescript:S6848`（原始报告行号）。
- 判定：保留，空白取消及拖入边界。
- 依据：空白点击取消选择有全局Escape等效（App useShortcuts）；块内显式选择按钮已支持Enter/Space/Ctrl/Cmd，photoDrag处理真实拖入。容器button会破坏文章与嵌套控件语义。
- 回归证据：canvas-keyboard-accessibility.spec.ts；selection同步既有回归。

## f35f613b-dddb-49cc-a8b8-be09119698c1
- 位置：`src/editor/HtmlTypographyControls.tsx:70`，`typescript:S6848`（原始报告行号）。
- 判定：保留，快捷键隔离。
- 依据：子元素为具名select/input/button。外壳阻止字体控件键盘事件触发全局编辑快捷键，不是可操作元素。
- 回归证据：htmlTypographyDom.test.tsx。

## 971f1138-6985-4708-a917-dac1ac85950f
- 位置：`src/editor/ImageResize.tsx:62`，`typescript:S6848`（原始报告行号）。
- 判定：保留，缩放操作保护。
- 依据：真实handle是原生button，支持方向键/Shift/Escape；外壳仅stopPropagation防画布取消/删除。
- 回归证据：imageResizeDom.test.tsx。

## 3d20857e-42f0-48b6-897b-64a7cd5b9980
- 位置：`src/editor/InlineReview.tsx:90`，`typescript:S6848`（原始报告行号）。
- 判定：保留，审阅事件隔离。
- 依据：外壳拦截审阅区域事件，避免Delete/Backspace删除原稿或点击改写选区；真实接受/拒绝/定位为原生button，建议预览内容inert，不能把包装层变成button或移除保护。
- 回归证据：inlineReviewDom.test.tsx wrapper variants；inline-review.spec.ts Delete/Backspace、Escape、导出隔离。

## dd156474-6763-48df-a7af-b550cd1caf2d
- 位置：`src/editor/InlineReview.tsx:91`，`typescript:S6848`（原始报告行号）。
- 判定：保留，审阅事件隔离。
- 依据：外壳拦截审阅区域事件，避免Delete/Backspace删除原稿或点击改写选区；真实接受/拒绝/定位为原生button，建议预览内容inert，不能把包装层变成button或移除保护。
- 回归证据：inlineReviewDom.test.tsx wrapper variants；inline-review.spec.ts Delete/Backspace、Escape、导出隔离。

## ce720a30-9e9c-4638-a318-7201cbab001c
- 位置：`src/editor/InlineReview.tsx:96`，`typescript:S6848`（原始报告行号）。
- 判定：保留，审阅事件隔离。
- 依据：外壳拦截审阅区域事件，避免Delete/Backspace删除原稿或点击改写选区；真实接受/拒绝/定位为原生button，建议预览内容inert，不能把包装层变成button或移除保护。
- 回归证据：inlineReviewDom.test.tsx wrapper variants；inline-review.spec.ts Delete/Backspace、Escape、导出隔离。

## abaab5c3-5d5b-4b2a-887d-1fff51c65e28
- 位置：`src/editor/InlineReview.tsx:102`，`typescript:S6848`（原始报告行号）。
- 判定：保留，审阅事件隔离。
- 依据：外壳拦截审阅区域事件，避免Delete/Backspace删除原稿或点击改写选区；真实接受/拒绝/定位为原生button，建议预览内容inert，不能把包装层变成button或移除保护。
- 回归证据：inlineReviewDom.test.tsx wrapper variants；inline-review.spec.ts Delete/Backspace、Escape、导出隔离。

## d985e5b5-246a-4a88-a2a9-5d7a9a974cbf
- 位置：`src/editor/InlineReview.tsx:104`，`typescript:S6848`（原始报告行号）。
- 判定：保留，审阅事件隔离。
- 依据：外壳拦截审阅区域事件，避免Delete/Backspace删除原稿或点击改写选区；真实接受/拒绝/定位为原生button，建议预览内容inert，不能把包装层变成button或移除保护。
- 回归证据：inlineReviewDom.test.tsx wrapper variants；inline-review.spec.ts Delete/Backspace、Escape、导出隔离。

## 91a7e920-cdbc-4420-b062-b23f9b67590e
- 位置：`src/editor/InlineReview.tsx:121`，`typescript:S6848`（原始报告行号）。
- 判定：保留，审阅事件隔离。
- 依据：外壳拦截审阅区域事件，避免Delete/Backspace删除原稿或点击改写选区；真实接受/拒绝/定位为原生button，建议预览内容inert，不能把包装层变成button或移除保护。
- 回归证据：inlineReviewDom.test.tsx wrapper variants；inline-review.spec.ts Delete/Backspace、Escape、导出隔离。

## 1fab548d-e79b-49df-ab23-34405c0b7f16
- 位置：`src/editor/Modal.tsx:47`，`typescript:S6848`（原始报告行号）。
- 判定：保留，模态背景关闭等效路径。
- 依据：鼠标遮罩仅target===currentTarget关闭，原生关闭按钮及顶层Escape等效；mask不是按钮，不应抢焦点或包住dialog的button语义。
- 回归证据：modalEditableFocus.test.tsx；modelPicker.test.ts。

## 1a166198-4c55-45c3-9417-d7d5e48de0ca
- 位置：`src/editor/ModelPicker.tsx:65`，`typescript:S6848`（原始报告行号）。
- 判定：保留，复合控件事件委托。
- 依据：键盘由可聚焦trigger和listbox冒泡至父容器，父无Tab停点；Escape、方向键、Home/End、Enter/Space均已处理。搬handler仅为隐藏告警没有行为价值，本次未改。
- 回归证据：modelPicker.test.ts；model-picker.spec.ts。

## bae5f7e8-ab9a-4d1d-ae11-92759c9fd9a4
- 位置：`src/editor/ModelPicker.tsx:76`，`typescript:S6852`（原始报告行号）。
- 判定：保留，aria-activedescendant焦点模式。
- 依据：DOM焦点固定listbox（tabIndex=0），active descendant引用option id；option不各自Tab，鼠标mousedown.preventDefault保留list焦点，点击选择回trigger。逐项加Tab会破坏此标准复合控件模式。
- 回归证据：modelPicker.test.ts 新虚拟焦点/外移测试；model-picker.spec.ts。

## 1b86fa5e-1a32-4ed7-8d05-91160bb2df28
- 位置：`src/editor/RichEditor.tsx:72`，`typescript:S6848`（原始报告行号）。
- 判定：保留，编辑外壳。
- 依据：仅阻止点击冒泡，实际编辑焦点由Tiptap/ProseMirror contenteditable承载，工具按钮和表单为原生控件。
- 回归证据：richEditorDom.test.tsx。

## 4bb79e72-25dc-419d-876d-ed77e54e6100
- 位置：`src/editor/RichEditor.tsx:73`，`typescript:S6848`（原始报告行号）。
- 判定：保留，工具栏快捷键隔离。
- 依据：子原生select/input/button可键盘操作；keydown.stopPropagation防选区与全局删除快捷键冲突。不能将包围输入的工具栏变button。
- 回归证据：richEditorDom.test.tsx。

## 本轮验证
- 新Canvas语义契约测试先红：tabindex为空，而非0；实现后通过。
- 7个定向DOM文件55/55通过；另字体控件DOM 11/11通过，合计66项。完整TypeScript检查及本轮变更ESLint通过。
- 独立5373/5374、独立合成data-e2e：25/25浏览器通过（53.9秒）。包含真实Tab进入HTML编辑区、Ctrl/Cmd选择、方向键片段导航、手机触摸模拟、模型虚拟焦点/40项滚动、审阅Delete/Backspace保护及导出隔离。
- 不移动handler隐藏告警；不为option添加Tab；未改变作品HTML、预览inert、拖放或焦点trap。
- 未实测屏幕阅读器/真机触摸；未在此独立树重跑全仓或Sonar。剩余20项需依据上列issueKey正式逐条审阅，不宣称已被扫描器消除。
