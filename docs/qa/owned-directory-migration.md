# Owned portable directory migration (text projects)

This is an intentionally narrow part of upstream directory migration, not a full restoration tool. A Windows portable application owner can set the process environment variable `XIUMI_LEGACY_MIGRATION_SOURCE` to an absolute local old checkout or its data directory before launching the executable. The ordinary web runtime is not enabled by that variable alone. The browser never sends or receives the path. Open 项目和素材备份 → 从本机旧目录迁移文字项目 → 检测已配置旧目录.

Detection reads bounded regular files, displays exact counts and does not write. Confirming applies once to the originally detected source version. Changed source data or a redirected target invalidates the preview; local destination records that arrive late are skipped without being overwritten. It uses the same text qualification and project writer as ZIP restore. It never reads the contents of .env or settings, nor migrates histories, images, design records, components, or credentials. Back up before migrating. The portable checks preserve portable path/file identity checks but are not an atomic defense against a concurrent process with hostile write access to the owner-selected directory tree.

Hosted integration:
- `pnpm exec vitest run tests/unit/legacyDirectoryMigrationRoute.test.ts tests/unit/legacyDirectorySnapshot.test.ts`
- Built browser, in an isolated test-owned data root and genuine upstream fixture: `pnpm build && pnpm e2e --config tests/owned-browser/playwright.config.ts`. This is separate from the ordinary dev proxy by design.
