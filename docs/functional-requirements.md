# XIUMI AI Studio 功能需求与实现清单（持续维护）

> 本文描述仓库里已经实现的产品能力、验收条件和明确边界，不是未来功能承诺。README 用于快速了解和启动；本文用于需求核对、回归测试及后续迭代。

## 1. 版本、证据与状态约定

- 文档首次核查日期：2026-11-10（UTC）。
- 应用版本：`package.json` 为 `0.1.0`；不能仅凭此版本号区分迭代。
- 本轮源码基线：fork `Zhou-chu/xiumi-ai-studio` 的 `main@9f95738f28eb39d36eb5d27283f9e587780f25a2`；已包含源仓库 `123huangcan250/xiumi-ai-studio` 的 `main@6db83fba6d4aa5ac5bb40d60c0373e0affc38231`。后续集成变更应按第 11 节更新；本文件自身提交不等于部署版本。
- 审核方法：逐项检查 UI、核心函数、服务端接口和仓库测试。没有在本轮用真实付费模型、微信公众号后台或用户 Windows 台式机验证。
- **已实现**：存在可达的界面或接口及实现路径，不意味着所有输入、外部服务或设备均已验证。
- **条件实现**：实现已存在，但需要模型服务、公众号配置、网络或手工操作。
- **部分实现**：支持指定子集，有明确不支持项。
- **未实现 / 未证明**：没有找到对应产品路径，或只有脚本而没有运行证据；不得写成可用承诺。
- 下方路径均相对仓库根目录，测试路径是可复核的证据入口，不表示本轮已执行其中每一条测试。

## 2. 产品定位与端到端流程

面向在本机制作微信公众号图文的编辑者。React 三栏编辑器维护结构化 `Doc`，Express 服务保存本机数据，HTML 编译器负责微信输出。不是秀米官方客户端，也不是公众号自动群发工具。

主要流程：

1. 新建 / 打开项目，或导入文稿、公众号正文。
2. 准备照片与描述；选择内置版式、AI 设计或已有模板模块。
3. 在画布调整内容、图片、顺序和主题；必要时审阅 AI 修改建议。
4. 自动保存项目、手工保存重要版本；手机宽度预览。
5. 导出文件、复制富文本、准备秀米导入包，或确认后创建公众号草稿。
6. 在真实秀米 / 微信后台检查效果，由用户完成最终发布。

离线规则排版不要求 AI Key；实际调用 AI、抓取网页和微信图片上传需要网络。浏览器界面依赖本地 API，不能把静态 HTML 页面当作完整离线编辑器。

## 3. 文档、项目与编辑器

### FR-01 项目与本机持久化｜已实现

- 文档包含 ID、标题、作者、摘要、主题及覆盖值、独立公众号封面、模块列表和时间戳。
- 启动读取最近更新的项目；无项目时创建空白项目。
- 项目列表可打开、新建空白项目、删除非当前项目；删除有明确确认提示。不是回收站操作。
- 修改后约 1.2 秒触发自动保存，工具栏展示未保存 / 保存中 / 已保存 / 保存失败；Ctrl/Cmd+S 可主动保存。保存状态不是云同步状态。
- 数据保存在服务端数据目录。默认是仓库 `data/`，部署可通过数据目录配置与代码发布目录分离。
- 验收：编辑并等待保存后重载项目应保留内容；API 保存失败不能显示“已保存”；切换项目不得把旧保存结果冒充新项目已保存。
- 证据：`src/editor/store.ts`、`src/editor/LeftPanel.tsx`、`src/App.tsx`、`server/store.ts`、`server/index.ts`；`tests/unit/store.test.ts`、`tests/unit/server.test.ts`。

### FR-02 历史版本与撤销｜已实现

- 编辑会话支持撤销 / 重做，Ctrl/Cmd+Z、Ctrl/Cmd+Y 及 Shift+Ctrl/Cmd+Z；输入框和富文本正在输入时不由全局快捷键抢占。
- “历史版本”允许输入说明并手工保存快照、查看和恢复；每个项目保留最近 50 个快照，超出后移除旧快照。
- 恢复历史版本属于可撤销编辑；普通自动保存不等于每次都生成历史快照。
- 弹窗打开时全局编辑快捷键不操作背后文档；离开存在未保存状态的页面时请求浏览器提示。
- 不承诺浏览器崩溃恢复、跨设备版本合并、多人冲突解决或无限历史。
- 证据：`src/editor/Toolbar.tsx`、`src/editor/store.ts`、`src/App.tsx`；`tests/unit/editing-ux.test.ts`、`tests/e2e/editing-ux.spec.ts`。

### FR-03 模块画布与数据模型｜已实现

实际 `BlockType` 共 **18 种**：13 种基础模块 + 原文 HTML + 4 种套件模块。README 的“13 种”不能用来统计整个模型。

| 类型 | 可编辑内容 / 形式 |
| --- | --- |
| cover 封面 | 引题、标题、副标题、信息、图片；自动 / 大图 / 色带 / 极简 |
| heading 章节标题 | 序号、标题、副标题；编号 / 竖线 / 胶囊 / 下划线 |
| paragraph 正文 | 富文本、对齐方式 |
| card 卡片 | 标题、富文本；边框 / 底色 / 强调 |
| quote 引言 | 引语、来源；引号 / 竖线 / 居中 |
| imageText 图文分栏 | 图片、标题、富文本、左右位置 |
| image 单图 | 图片、图注；通栏 / 相框 / 圆角 |
| gallery 相册 | 图片列表、1–3 列、图注 |
| timeline 时间轴 | 多条时间、标题、说明 |
| table 数据表 | 表头、数据行、说明 |
| profile 人物 | 照片、姓名、身份、简介 |
| divider 分割 | 线 / 点 / 装饰 / 留白 |
| ending 结尾 | 文本、署名、备注、可选图片 |
| html 原文片段 | 清洗后 HTML、标签、来源；文字和图片槽位编辑 |
| box 大型文本框 | 标题、标签、子模块；铭牌 / 线框 / 浅底 |
| carousel 轮播 | 图片与逐图图注、比例；露出下一张 / 整张 |
| frame 图片框 | 图片、图注、标签；三色框 / 电路角 / 车票 |
| photos 多图 | 双 / 三 / 四图、等分或重点图布局、比例、逐图图注 |

- 左栏点击或拖拽插入模块，画布选中后显示属性；支持复制、删除、排序及容器内外移动。
- `box` 可容纳其他模块，但不允许嵌套 `box`；将文本框拖到文本框里会转为放在外层后面。
- 素材拖到已有图片或空槽只替换对应图片；拖到其他位置可插入单图。固定图片位已满时提示，不静默丢弃。
- 套件有“清华电机·德国”配套主题；空图片位用于编辑，不应当作真实图片导出。
- 手机预览使用 375px iframe，是浏览器模拟，不是真机微信认证。
- 证据：`src/core/types.ts`、`src/core/blocks.ts`、`src/core/tree.ts`、`src/core/kit.ts`、`src/editor/Canvas.tsx`、`src/editor/PropsForm.tsx`、`src/App.tsx`；`tests/unit/kit.test.ts`、`tests/e2e/kit.spec.ts`。

### FR-04 富文本与原文局部编辑｜已实现 / 部分实现

- 正文类模块双击进入 tiptap 编辑，支持加粗、斜体、下划线、高亮、主题色、列表、对齐和链接。
- 导入 HTML 以槽位方式修改文字、替换图片，尽量维持结构和内联样式；支持拆开大模块及点选其中局部来收藏组件。
- 富文本编辑中的组件插入可定位在光标所在段落后；插入不是简单把整篇文章追加在尾部。
- 图片、相册、多图、轮播、相框可双击编辑独立图注 / 标签；封面、标题、引言、人物、结尾、时间轴、表格、文本框也支持各自文字字段。保留模块预览、原图片引用和布局，修改即时进入保存链，可撤销；“完成” / Escape 只关闭编辑，不撤销内容。嵌套双击不同时打开父框。
- 封面主标题有独立 `titleAlign`：跟随版式 / 左 / 中 / 右，可在右栏或双击编辑框设置；不连带改变副标题、标签、日期、图片和装饰。AI 修改相同字段仍需接受建议。
- 原文文字槽位支持左 / 中 / 右 / 两端对齐；固定位置的图形 / SVG 文字不开放对齐。段落属性对齐同步富文本节点，防止旧节点样式压过模块设置。
- HTML 槽位编辑不是任意网页 DOM 编辑器，不能承诺所有第三方嵌套结构都完整可编辑；图片像素内的文字不是独立字段，不能通过图注编辑改变。
- 验收：修改文字不误覆盖同模块其他槽位；替换图片保持其他图片不变；拆分后内容仍完整且可撤销。
- 证据：`src/editor/RichEditor.tsx`、`src/core/richtext.ts`、`src/core/slots.ts`、`src/core/fragments.ts`、`src/editor/componentActions.ts`；`tests/unit/slots.test.ts`、`tests/unit/editing-ux.test.ts`、`tests/e2e/components.spec.ts`；补充证据：`src/core/blockTextEditing.ts`、`src/editor/BlockTextEditor.tsx`、`src/editor/CoverTitleAlignment.tsx`、`tests/unit/textControls.test.ts`、`tests/e2e/block-text-editing.spec.ts`、`tests/e2e/cover-alignment.spec.ts`。

## 4. 导入、写作与排版

### FR-05 文稿导入｜部分实现

- 支持 `.docx`、`.md`、`.markdown`、`.txt` 和直接粘贴文案。Word 经 mammoth 转成语义 HTML，再转换为 Markdown；内嵌图片保存到素材库。
- 支持标题、段落、列表、表格和图片的基础提取；Word 无一级标题时把首个适合的段落当标题。
- 损坏或无法解析的 `.docx` 返回中文错误，提示文件损坏、加密或格式不符，不把底层解压异常作为正常导入结果。
- 当前 Word 转换会把 h3–h6 压到二级 Markdown 标题，不能宣称 Word 多级样式或分页版式无损保留。
- 旧 `.doc`、PDF、PPT、OCR、任意网页附件不是该导入接口的支持格式。编辑器 JSON 可导出，但未提供对称的 JSON 文件导入 UI。
- 请求上传限制：每文件 30 MiB，最多 50 文件；实际导入接口只接收一个文稿。
- 证据：`server/importer.ts`、`server/index.ts`、`src/editor/ImportWizard.tsx`；`tests/unit/import.test.ts`。

### FR-06 公众号正文导入｜条件实现 / 部分实现

- 工具栏“导入推文”提供文章链接抓取或粘贴正文；导入前必须勾选使用权 / 授权确认。
- 保留样式：清洗 HTML 并拆成原文片段；识别标题、来源等，保留可支持的内联样式，可附带保存模板和提取主题。
- 重新排版：提取标题、段落、图片、引语、表格，进入排版向导；允许的微信 / 秀米图床图片可下载到本机。
- 视频、音频、小程序卡片等不支持，使用提示替代。抓取受文章访问控制、反爬、网络、大小限制影响；单张图片下载失败不等于整篇图片已本地化。
- 不提供登录绕过、付费内容解锁、公众号后台账号托管或版权授权判断。
- 验收：未勾选授权不能导入；危险脚本不进入渲染；原始来源可追溯；抓取失败可改用粘贴。
- 证据：`src/editor/ArticleImport.tsx`、`src/core/wxImport.ts`、`src/core/sanitize.ts`、`server/net.ts`；`tests/unit/import.test.ts`、`tests/unit/fetchBoundaries.test.ts`、`tests/e2e/features.spec.ts`。

### FR-07 规则与 AI 排版｜已实现 + 条件实现

- 未启用 AI 时，用规则解析文稿并生成三套内置方案：叙事长文、信息卡片、图集故事；可选择主题并预览。
- 启用 AI 后先抽取文稿结构，再请求最多三套设计；设计描述配色、字体、字号行距、模块风格和章节布局，由本地结构化编译逻辑构建文档，不直接执行模型 HTML。
- 可填风格要求、重新设计。结构抽取失败回退规则解析；设计失败仍可使用内置方案。
- “三套 AI 方案”是请求目标：返回结果取最多三套，不保证上游每次恰好返回三套。
- 选择方案后形成可继续手工编辑的项目，不直接上传或发布。
- 证据：`src/editor/ImportWizard.tsx`、`src/core/outline.ts`、`src/core/layouts.ts`、`src/core/aiDesign.ts`、`server/ai.ts`；`tests/unit/aiDesign.test.ts`、`tests/e2e/acceptance.spec.ts`、`tests/e2e/features.spec.ts`。

### FR-08 AI 文案与按照片描述补充｜条件实现

- 输入活动描述，选择文风、篇幅、标题级数及补充要求，生成 Markdown 文案；支持编辑、按意见改写、填入排版正文。
- 检查套话和待补充标记。提示词要求不编造未提供事实，但不能代替用户核实内容。
- 照片有文字描述时，排版前可询问是否据此补充文案；呈现变更和检查结果，可接受或还原。保护用于定位照片的指定句子。
- **照片理解依据是文件名与用户文字描述，不是视觉识图。** 当前接口没有把照片像素作为多模态输入传给模型。
- 证据：`src/editor/Copywriter.tsx`、`src/editor/ImportWizard.tsx`、`src/core/copy.ts`、`src/core/enrich.ts`、`server/index.ts`；`tests/unit/enrich.test.ts`、`tests/e2e/enrich.spec.ts`。

### FR-09 模板套用与照片安排｜已实现 + 条件实现

- 模板模块 / 收藏组件有标准角色，例如封面、不同级别标题、段落、大型容器、单双多图、轮播、分割和署名；可查看、更正自动识别结果。
- 允许从多个模板及组件选择素材，但同一标准角色只选择一个模块用于本次组装。
- 按文案标题层级和段落顺序替换模块槽位；缺少正文模块时可使用大型容器。标题级数超出模块能力时提示补齐或减少级数。
- 照片可分组、指定版式、指定放在某句话之后。同一位置拥挤时选择逐张、组合或提供 AI 要求；找不到锚点、缺版式等先进入问题确认。
- 先执行固定位置，其余有文字描述且启用 AI 时请求安排；失败时回退章节分配。无 AI 也能完成规则路径。
- 组装不保证任意第三方 HTML 槽位都能推断正确；缺素材、缺角色和组装警告应人工处理。
- 证据：`src/core/roles.ts`、`src/core/assemble.ts`、`src/core/photoPlan.ts`、`src/core/templateFill.ts`、`src/editor/KitPicker.tsx`、`src/editor/PhotoPlanner.tsx`、`src/editor/PlanIssues.tsx`；`tests/unit/assemble.test.ts`、`tests/unit/photos.test.ts`、`tests/unit/templateFill.test.ts`、`tests/e2e/features.spec.ts`。

## 5. AI 配置和安全审阅

### FR-10 模型配置与模型发现｜条件实现

- 保存多套配置、切换当前配置、测试连接；支持 OpenAI 兼容 Chat Completions 和 Anthropic Messages 两种协议。服务商品牌预设不是所有模型已验证兼容的保证。
- 配置包含名称、Base URL、密钥、模型 ID、JSON 模式、可选上下文窗口、最大输出、思考强度及高级额外 JSON 参数；`.env` 配置作为只读配置项。
- 点击“从服务商获取模型列表”后，立即显示可滚动的“可用模型”列表；点击条目填写模型 ID，以及上游实际提供的上下文窗口、最大输出、思考强度列表。仍允许手工填写未列出的模型。Anthropic 最多请求 5 页、每页 limit=1000，其他接口一次列表请求；解析还受有效条目数量上限约束，不保证列全模型。列表只代表服务端返回 ID，不能保证账户有调用权限。
- 获取期间显示状态；空结果和错误显示文字提示，可重试或手工填写。切换配置、地址、协议或密钥会清除列表并忽略旧请求结果，防止其他配置的模型列表覆盖当前配置。切换模型会清除旧思考强度，需要按新模型支持情况填写。
- 只采纳上游真实返回的上下文 / 思考元数据；缺失值不按模型名猜测。上下文窗口目前仅记录，**不会自动分块、截断或扩充上下文**。
- 最大输出配置用于限制单次输出 token 上限；上下文窗口仍不负责自动截断。高级额外参数必须是 JSON 对象，只接受未被保护的服务商扩展字段，不能覆盖模型、消息、工具、流式设置、输出上限、温度、思考强度或 JSON 模式。
- 可手动点击“检测思考强度”发出一系列短请求，可能产生费用；不是后台自动检测。请求被接受只证明该配置下参数可用，不证明实际推理效果、模型质量或完整能力。失败 / 不支持结果保留供检查，不静默换强度。
- 思考强度作为字符串传参：OpenAI 使用 `reasoning_effort` / `max_completion_tokens`，Anthropic 使用 `output_config.effort` / `max_tokens`；设置强度时不发送 temperature。专有 thinking 开关、预算参数未自动适配。
- 密钥保存于本机服务端 `settings.json`，返回浏览器的是打码值；这不是加密密钥保险库。更换服务 origin 或接口协议需重新输入密钥。
- 模型调用会把请求相关文稿、摘要、指令或描述发送给配置的服务商；“本机编辑”不意味着 AI 内容完全不离开本机。
- 证据：`server/settings.ts`、`server/ai.ts`、`src/editor/AiSettingsModal.tsx`；`tests/unit/settings.test.ts`、`tests/unit/aiProfiles.test.ts`、`tests/unit/aiModels.test.ts`、`tests/unit/aiWireSafety.test.ts`、`tests/unit/aiSettingsUi.test.ts`、`tests/e2e/ai-issues.spec.ts`。详见 [模型能力与边界](ai-models-and-selection.md)。

### FR-11 AI 设计助手与选中模块范围｜条件实现

- 自然语言生成操作建议，操作模型包含 `insert`、`update`、`remove`、`move`、`setTheme`、`setMeta`。
- 存在选中模块且未手动选择全文时，默认范围为“仅选中模块”；没有选中模块时界面与请求为全文，可显式切换范围。选中范围只允许该模块的 update，服务端拒绝插入、删除、移动、主题和跨模块修改。
- 显式“生成修改建议”时，选中模块完整内容与其他模块的短摘要一起发送；嵌套模块仍按确切 ID 限制 update。此范围不是只发送选中块的数据隔离，且不允许因为结构嵌套就修改父容器或其他子块。自动输入建议的数据范围另见 FR-20。
- 建议展示差异，可预览、逐条或全部接受 / 拒绝；接受后可撤销；请求期间文档已变化时拒用旧结果。
- HTML 原文用文字槽位修改；“选中”是模块，不是任意字符范围。规则快捷动作独立针对文档，不应当认为它们受 AI 的选中范围限制。
- 离线规则动作：拆分长段落、提炼金句为引言、章节间加分割、重排章节序号，同样走建议审阅。
- 证据：`server/aiEdit.ts`、`src/core/ops.ts`、`src/core/quickActions.ts`、`src/editor/RightPanel.tsx`；`tests/unit/aiSelection.test.ts`、`tests/unit/quickActions.test.ts`、`tests/e2e/ai-issues.spec.ts`。

## 6. 模板、组件、主题与素材

### FR-12 模板与组件复用｜已实现

- 当前模块可收藏为组件；记录名称、标签、标准角色和来源，支持检索、角色 / 类别 / 色系筛选，点击或拖入画布。
- 原文局部可拆分收藏；插入可统一到当前文档配色。收藏组件不等于修改来源模板。
- 模板可保存模块集合和主题，插入当前项目或建立新项目；可修改模板名称和角色映射、删除模板。
- 组件仅本机保存，未提供组件市场、分享链接或专门的组件库导出。项目 JSON 含有文章模块，不是可携带全部素材与密钥的备份包。
- 证据：`src/core/components.ts`、`src/editor/ComponentLibrary.tsx`、`src/editor/CollectModal.tsx`、`src/editor/TemplateModules.tsx`、`server/components.ts`；`tests/unit/components.test.ts`、`tests/e2e/components.spec.ts`。

### FR-13 主题与参考风格｜已实现 / 部分实现

- 内置清华紫、科技蓝、人文暖色、极简杂志、青春活力、清华电机·德国六套主题；可调整主色等颜色、字号、行距、字距、段落 / 模块间距和圆角，另存自定义主题。
- 原生模块的“跟随主题”样式由主题控制；原文 HTML 保留原内联样式，不能承诺全篇任意 HTML 自动统一换肤。
- 有权使用的参考文章可抓取或粘贴 HTML，提取颜色、字号、行距等数值及装饰倾向，生成主题；样本不足时提示。
- 这是规则式样式统计，不是训练专属模型、像素级复刻或自动获得版权许可。
- 证据：`src/core/themes.ts`、`src/core/styleExtract.ts`、`src/core/recolor.ts`、`src/editor/RightPanel.tsx`；`tests/unit/core.test.ts`。

### FR-14 素材与封面｜已实现 / 部分实现

- 上传自动按 EXIF 纠正方向，最长边限制为 2400px；带透明通道的部分格式转 PNG，其他转 JPEG。GIF 仅保留第一帧，不支持保留动画。
- 裁剪另存新素材，不覆盖原图；按需生成尺寸 / 比例变体并缓存，可利用 sharp attention 策略裁切主体。
- 封面设计器输出 900×383 图像，文章元数据封面独立于正文 cover 模块。
- 删除素材前提示引用模块可能失效；没有自动引用保护、回收站或远程素材长期可用保证。
- 证据：`server/assets.ts`、`src/editor/CropModal.tsx`、`src/editor/CoverDesigner.tsx`、`src/core/photos.ts`；`tests/unit/photos.test.ts`、`tests/e2e/acceptance.spec.ts`。

## 7. 导出、秀米与公众号草稿

### FR-15 文件和富文本导出｜已实现 / 条件实现

- 输出 Markdown、编辑器 JSON、带内嵌图片的独立 HTML；Markdown / JSON 不自动打包本机素材，跨电脑搬迁需另行处理图片。
- 富文本剪贴板支持内嵌图片、上传微信图床、原图链接三种模式及浏览器兼容回退。
- 编译后展示 HTML 长度和静态兼容警告。内嵌 base64 是否被真实微信后台转存未被该自动化测试证明；localhost 链接不能供微信用户访问。
- 微信图床模式需要公众号配置，会上传正文图片；不能描述成纯本地复制。
- 证据：`src/core/compiler.ts`、`src/core/exporters.ts`、`src/core/copy.ts`、`src/editor/wechatOutput.ts`、`src/editor/Toolbar.tsx`；`tests/unit/core.test.ts`、`tests/e2e/acceptance.spec.ts`。

### FR-16 秀米导入准备｜已实现 / 条件实现

- 无本地图片且未超限时下载 HTML 文本；有本地图片或需多份导入时下载 ZIP 包，按说明在秀米手工替换图片或顺序导入。
- 长文按项目内置安全阈值 120,000 字符拆分（HTML 实体按一个字符计数），尽量在模块 / 子结构边界切开并保留外层标签；多份输出为编号 TXT 加说明的 ZIP。阈值来自项目对秀米行为的经验记录，不是秀米官方稳定契约。
- 界面在多份导出前确认，取消发生在任何微信上传前；仍不可拆分且超限的单段、SVG 等会阻止下载，并提示手工拆分或改用通用 HTML，不静默截断。图片上传后最终 HTML 也会再检查。
- 配置微信接口后可先上传本地图片，再下载使用微信图床地址的 HTML；只上传图片，不创建草稿，不群发。
- 提示内嵌图片、背景图及本地背景图限制：秀米不接受内嵌图片；背景图可能可显示但不可单独选中编辑；未配图床时本地背景图无法按普通图片替换。
- 没有直接调用秀米账号发布 / 同步的自动化接口；秀米导入和后续微信同步由用户操作。
- 证据：`src/core/xiumiExport.ts`、`src/editor/wechatOutput.ts`、`src/editor/Toolbar.tsx`；`tests/unit/regressions.test.ts`、`tests/unit/xiumiLimits.test.ts`、`tests/e2e/xiumi-limits.spec.ts`；[兼容探测说明](05-xiumi-compat-probe.md)。

### FR-17 创建公众号草稿｜条件实现

- 需要 `WECHAT_APPID`、`WECHAT_APPSECRET`、微信侧权限 / IP 白名单及网络可用。
- 导出弹窗显示配置状态；草稿确认页展示标题、作者、摘要、封面，用户勾选并确认后上传图片、封面和草稿正文。
- 校验标题、封面、摘要与正文长度；当前正文 HTML 达到 20,000 字符会阻止草稿流程。服务端还校验显式 `confirm: true`。
- 返回草稿 `media_id` 后用户去后台检查并手工发布。没有群发、定时发布、阅读数据分析或多公众号管理承诺。
- 证据：`server/wechat.ts`、`server/index.ts`、`src/editor/Toolbar.tsx`；`tests/unit/core.test.ts`、`tests/unit/server.test.ts`；[真实后台验收清单](03-wechat-compat-test.md)。

## 8. 运行、安全和部署边界

### FR-18 本机运行与 Windows 更新脚本｜已实现；真实部署另行核实

- Node 要求 ≥22.19，推荐 Node 24；使用 pnpm。开发 Web 5173 / API 5174；生产构建后由服务端提供页面。
- API 绑定 `127.0.0.1`。仓库没有完整用户登录、租户隔离或公网访问控制，不能直接暴露到公网当作安全的多人服务。
- Windows 部署脚本轮询 main 的成功 push CI，按提交保存发布目录，候选版本用独立端口 / 数据冒烟后切换；有进程归属检查和失败回退。
- 安装脚本创建当前登录用户的计划任务；代码回退不回退用户数据。无自动数据迁移或灾难恢复服务。
- CI 定义存在不证明用户电脑已安装任务、应用在线或远程域名可访问。外网、Tunnel、Access、域名白名单不是本清单中的已交付能力。
- 证据：`.github/workflows/ci.yml`、`deploy/desktop.ps1`、`deploy/install-desktop.ps1`、`deploy/test-desktop.ps1`、`server/index.ts`；[桌面部署说明](desktop-deployment.md)。

安全相关已存在措施：路径 ID 校验、HTML 清洗、受限图片域名抓取、远程地址 / 重定向 / 响应大小边界、模型密钥 origin 约束、显式草稿确认。它们不是安全审计证明，也不等于身份认证。不要把含 `.env`、`data/settings.json` 或私人素材的目录上传到公开仓库。

### FR-19 画布缩放与侧栏宽度｜已实现（来自上游）

- 只缩放中间文章，不放大整个工具栏 / 侧栏；50%–200%，按钮、Ctrl/Cmd 加减 / 0、Ctrl+滚轮调整，重置为 100%。
- 左右侧栏支持拖动分隔线、方向键微调（Shift 加大步长）、双击恢复默认。左栏约束 200–560px，右栏 240–640px，并按可用空间尽量给文章留宽度。
- 缩放与侧栏宽度记录在当前浏览器 localStorage，不是项目属性或跨设备同步；窗口变窄时显示宽度自适应但不覆盖用户保存的偏好。存储不可用时只能在当前页面保持。
- 缩放不改变导出文档字体 / 宽度；拖拽定位需按缩放后几何正确命中模块。
- 证据：`src/editor/Workspace.tsx`、`src/editor/zoom.ts`、`src/editor/Canvas.tsx`、`tests/unit/layout.test.ts`、`tests/e2e/workspace.spec.ts`。

### FR-20 上下文 AI 输入建议｜条件实现（fork 增量）

- AI 面板启用“自动生成输入建议”、已配置模型、文稿非空且输入框空白时，按当前文稿 / 范围生成一条灰字指令。默认开启，可关闭并保存到当前浏览器；该开关与用户手工生成修改建议分开。
- Tab 或点击只把建议填入输入框，不自动提交、不改正文；Escape 忽略，用户手输不会被覆盖。随后仍需“生成修改建议”及逐条 / 全部接受。
- 1.5 秒防抖，当前页面建议请求开始间隔至少 30 秒、单请求串行、内存最多 20 条缓存；切换 AI 设置清缓存。失败不自动无限重试，允许直接输入。
- 选中范围只发送该模块的文本上下文，全文模式发送文章文本结构；剥离图片文件 / 地址，不做视觉理解。请求发往当前配置的模型，可能产生 API 费用；不是本地规则占位文字。
- 离开上下文会忽略过期结果，但已经发出的服务端请求未必被取消，因此不能把关闭面板或开关解释成撤回已发送数据 / 费用。
- 证据：`src/editor/RightPanel.tsx`、`src/editor/SuggestionInput.tsx`、`src/editor/suggestionPreference.ts`、`src/editor/suggestionQueue.ts`、`server/aiSuggestion.ts`、`tests/unit/aiSuggestion.test.ts`、`tests/unit/suggestionQueue.test.ts`、`tests/e2e/input-suggestions.spec.ts`。

## 9. 尚未实现或不应对外宣称的能力

| 能力 | 当前边界 |
| --- | --- |
| 团队协作 / 账号 / 权限 | 本机单用户形态，没有协作冲突协议或账户权限系统 |
| 自动备份 / 云同步 / 素材完整搬迁 | 本机文件持久化；需自行备份完整数据目录 |
| 富文本字符级 AI 定点改写 | 只支持模块范围与 HTML 槽位 |
| 自动视觉识图 / OCR / AI 生图 | 当前照片处理和 AI 安排基于文件与文字描述 |
| 模型能力自动完整识别 | 有限分页、可选元数据与手动探测，配置值不等于真实支持 |
| 任意复杂 Word / 公众号页面无损转换 | 支持语义 / 可清洗 HTML 子集，视频等替代提示 |
| 自动登录秀米并同步微信 | 仅提供导出包 / 图床准备，后续用户操作 |
| 微信直接群发 / 定时发布 | 仅创建草稿，没有群发实现 |
| 任意浏览器 / 微信客户端像素一致 | 静态校验和浏览器回归不替代真实平台验收 |
| 台式机已部署、已公网可用 | 必须另查最终版本、进程、任务和访问控制实况 |

## 10. 回归验收与验证记录

### 可执行的基础验证

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm sample
pnpm e2e --update-snapshots=none
```

Windows 另外运行 `powershell -NoProfile -File deploy/test-desktop.ps1` 和 `pwsh -NoProfile -File deploy/test-desktop.ps1`。当前截图基线包含 Windows 平台标记，其他操作系统执行不能靠重生成基线来掩盖差异。

最低人工回归：

1. 新建项目，加入正文 / 图片 / 文本框，编辑、移动、撤销、保存、重开。
2. 导入含标题与图片的文稿，分别走无 AI 规则排版和模板套用。
3. 导入已获授权正文，改字、换图、拆分、收藏、重复插入并检查原样式。
4. 使用测试模型验证局部范围不跨模块、全文范围可审阅、请求期间改文档会拒用旧建议。
5. 图片裁剪另存、封面生成、各类导出及图片包中的文件引用一致。
6. 在真正的秀米和微信后台检查图片、轮播、背景、宽度、间距；记录客户端和截图。
7. 配置真实公众号时，显式确认仅创建测试草稿，核对返回结果，绝不把自动化 mock 当作真实发布验收。

历史验证：`e5ca86e` 基线在 Linux 本地的 lint、类型检查、22 文件 266 单测和构建通过；这些数字不能用于新基线。当前 `9f95738` 基线本轮复用已有依赖运行 ESLint、TypeScript、Vitest 和 Vite：lint、类型检查、34 文件 351 单测与构建通过；仅有大于 500 kB 的 chunk 警告。文档路径和相对链接全部存在，`git diff --check` 通过；未在本文审计中重新执行 E2E、Windows 脚本、真实模型或微信公众号请求。仓库测试中存在 mock AI 和模拟外部响应，它们证明请求、校验和 UI 流程，不证明真实供应商质量、延迟或计费。后续验证应记录：提交 SHA、命令、环境、通过 / 失败 / 未运行、失败原因和证据链接。

## 11. 持续维护规则

1. **功能改动同 PR 更新本文。** 新增、改变或删除 UI、接口、数据字段、外部依赖及失败行为时，更新对应 FR，不能只更新 README。
2. 保留稳定 FR 编号；新增能力分配新编号，不因排序改变复用旧编号。删除功能标明移除版本与替代方式。
3. 每项必须写入口、输入、结果、边界和证据；只出现按钮 / 类型 / 提示词不足以证明端到端可用。
4. 更新源码基线到已经审核的代码提交，列出并行集成提交；对尚未合并分支单独标“待合并”，不能混入 main 已实现能力。
5. 发布前按第 10 节记录最终合并代码验证，外部服务与设备实测独立记录，不能用 CI 成功替代部署健康检查。
6. 发现文档与实现冲突时，先标注差异并核对源码和测试，再决定修代码还是修需求；不要为迎合旧描述虚构功能。
7. 不在文档记录真实 API Key、微信密钥、私人文稿或原始用户数据。验证可用脱敏配置和仓库测试夹具。

### 维护记录

| 日期 | 源码基线 | 更新范围 | 验证性质 |
| --- | --- | --- | --- |
| 2026-11-10 | `c5dfec0` | 首版：18 类模块、编辑与导入、AI / 模板 / 照片、素材与主题、导出与部署边界 | 源码与测试路径审计；命令结果见本轮 PR |
| 2026-11-10 | `e5ca86e` | FR-10 更新为已合并的可见模型列表、获取状态与过期响应保护；不含尚未合并的图片模块双击编辑和输入建议 | 重新核对 main 源码，重新执行 lint / 类型 / 单测 / 构建 |

| 2026-11-10 | fork `9f95738` / upstream `6db83fba` | 补齐活跃上游能力与 fork PR #5–8，新增 FR-19 / FR-20 和来源差异矩阵 | 本轮 lint / 类型 / 351 单测 / 构建通过；未重新执行 E2E 或生产部署 |


## 12. 源仓库与 fork 的来源核对

本次通过远端 main 引用及本地源码核对：源仓库 main 为 [6db83fba](https://github.com/123huangcan250/xiumi-ai-studio/commit/6db83fba6d4aa5ac5bb40d60c0373e0affc38231)，fork main 为 [9f95738f](https://github.com/Zhou-chu/xiumi-ai-studio/commit/9f95738f28eb39d36eb5d27283f9e587780f25a2)。这是检查时的快照，不表示上游未来不会继续更新。本文按 fork 实现写验收条件，不能反向宣称所有 fork 增量已存在于源仓库。

| 变更来源 | 原文档覆盖情况 | 本轮对应需求与差异 |
| --- | --- | --- |
| 上游 `87ef509`：文章缩放、侧栏调整与持久化 | 未记录 | 新增 FR-19；仅影响编辑视图 |
| 上游 `87ef509`：文字槽位 / 段落对齐 | 仅笼统写富文本对齐 | FR-04 明确槽位级控制、固定图形限制及节点样式同步 |
| 上游 `87ef509`：模型发现与能力参数、输出上限、额外请求参数、强度探测 | FR-10 停在旧版单页、上下文和强度 | FR-10 修正分页、最大输出、高级参数、手动付费探测；fork 保留 origin 密钥约束和额外参数保护 |
| 上游 `87ef509`：选中模块上下文 | FR-11 旧描述仍是全文背景 | FR-11 更新完整选中块加其他块摘要；fork 保留服务端确切 ID 的 update-only 限制 |
| 上游 `6db83fba`：秀米长文分包 | 未记录 | FR-16 增加阈值、分段 ZIP、按序手工导入；fork 额外拒绝不可拆超限内容，并在任何上传前确认 |
| fork PR #5：双击图注 / 结构化文字 | 未记录 | FR-04；只能编辑独立字段，不改图片像素 |
| fork PR #6：上下文输入建议 | 未记录 | 新增 FR-20；自动模型请求有费用，采纳不等于提交修改 |
| fork PR #7：封面主标题对齐 | 未记录 | FR-04；只动主标题，保留其他内容 |
| fork PR #8 集成保护：损坏 Word 中文错误、模型线协议与秀米安全检查 | 未记录 | FR-05 / FR-10 / FR-16 与相应回归测试 |
| fork 的 Windows CI/CD 与安全补强 | 已记录基础能力 | FR-18 保留；不是源仓库已经部署的功能，不把 fork 私有部署流程贡献到无关上游 PR |

上游相关提交：[87ef509](https://github.com/123huangcan250/xiumi-ai-studio/commit/87ef509)、[6db83fba](https://github.com/123huangcan250/xiumi-ai-studio/commit/6db83fba6d4aa5ac5bb40d60c0373e0affc38231)。fork 同步入口：[PR #8](https://github.com/Zhou-chu/xiumi-ai-studio/pull/8)。本功能文档的维护入口是 [fork PR #4](https://github.com/Zhou-chu/xiumi-ai-studio/pull/4)，不等于另一个源仓库中同编号的贡献 PR。

部署状态必须独立核验：源码合入 main、CI 成功和本文更新均不证明生产台式机已经切换版本；用户保存中的项目与待部署版本应由部署记录确认。
