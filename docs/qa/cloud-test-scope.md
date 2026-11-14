# Cloud automatic-analysis source/test classification

Base: own main f1b28d5c06f9fd0a6b68539a3a61b50409c2bc3a.

Official reference: https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/automatic-analysis#additional-analysis-configuration

Automatic analysis supports `.sonarcloud.properties`, including `sonar.sources`, `sonar.tests`, and source/test exclusions/inclusions. It ignores `sonar-project.properties`. The documented Java-specific limitations do not apply to this TypeScript project. This patch uses only actual paths, no wildcard assumptions. Automatic analysis does not ingest coverage; the independently verified full-source LCOV gate remains separate.

The source list inventories every tracked top-level entry except `tests`, including root executable configurations, `scripts`, `deploy`, samples, documentation, and workflow files. Analyzer language/default filters still determine which of these files are supported. `tests` and the executable deployment test `deploy/test-desktop.ps1` become TEST. The latter is excluded only from SOURCE to avoid duplicate indexing; it is not removed from analysis. Production `deploy/desktop.ps1` and `deploy/install-desktop.ps1` remain SOURCE. No product file, gate, rule, profile, issue state, or coverage threshold changes.

Reproduce from the checkout after staging new files:

```sh
node --test tests/quality/sonar-scope.test.mjs
```

This lightweight audit examines tracked paths, requires every tracked file to belong to exactly one initial scope, checks every declared root exists, verifies all 120 measured production JS/TS files remain SOURCE, and checks PowerShell plus test-harness classification. New top-level entries require the explicit source inventory to be updated, and the test will flag omissions.

Expected follow-up, not yet verified: scan the exact resulting commit with Cloud automatic analysis and read back classification/issues. The 11 existing test mock/harness reports may be removed by correct TEST classification; this is not guaranteed in advance. The 20 separately reviewed UI accessibility findings are not affected by this scope patch. No issue is marked fixed or false-positive by this change.
