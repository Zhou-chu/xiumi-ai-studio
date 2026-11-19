# 编辑回放：合并阶段一

把 staging 中的普通回放模型、SVG 编译器和场景编辑器接到 fork 的现行项目模型。新增模块库的「动效 / 编辑回放」，可选择场景、修改文本和素材、播放或拖动进度、保存与重新打开。画布展示成稿；「导出与发布 / 下载 HTML」可离线保留回放。这个阶段固定使用 SVG 文字，不引入旧字形存储接口、外部上传流程、旧 CI 或包依赖。公众号复制/草稿箱及秀米导出对含回放模块的文章明确拒绝；需单独适配、测试后再开放。现有非回放文章的发布行为不变。

回放作为顶层模块；不进入大型文本框。素材只接受当前管理的本地图片。回放的插入和属性编辑使用人工编辑路径，不开放给 AI 结构化操作。

验证：`pnpm exec vitest run tests/unit/replayMigration.test.ts tests/unit/historyActionAlignment.test.tsx`，现有类型、架构及构建门禁，浏览器验收 `pnpm e2e tests/e2e/replay-migration.spec.ts`。浏览器用独立数据目录，不接触用户项目或第三方服务。
