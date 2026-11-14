# Node generator isolation and coverage

Base: ac86d8e. The two existing Node scripts now export `generateSamples(outputDir)` and `generateXiumiProbe({ outputDir, samplesDir, templatesDir })`. Importing them performs no filesystem I/O. CLI defaults remain `samples/` and `DATA_DIR/compat-probe` (or repository `data/compat-probe`). The probe no longer imports `server/store`, so library import cannot initialize user data directories. Destructive probe output cannot contain either input directory or be a filesystem root.

## Evidence

- Before refactoring, the original CLI behavior was characterized in a disposable copied checkout, using a synthetic template and real Sharp image generation: 1/1 passed.
- After refactoring: 5/5 tests passed. They verify CLI output, pure imports, 10 real JPEG files and metadata, Markdown structure, SVG/carousel/template selection, image-format variants, absent optional templates, restricted cleanup, invalid output paths and observable filesystem/image failures.
- Tests never read real user templates/data, never fetch embedded image URLs, and never run deployment/install scripts. All filesystem integration uses unique temporary roots and real compiler/Sharp implementations.
- Scoped ESLint and full TypeScript checking passed.

## Coverage

`vitest.scripts.coverage.config.ts` is an additive proposal: existing src/server sources plus scripts, with unchanged 90.01% thresholds. Shared coverage configuration is untouched.

Targeted run with this expanded denominator:

| Source | Lines | Functions | Statements | Branches |
|---|---:|---:|---:|---:|
| make-sample.ts | 96.29% | 100% | 96.87% | 95% |
| make-xiumi-probe.ts | 92.53% | 96% | 93.33% | 92.10% |

The targeted coverage command correctly fails global thresholds because it runs only these tests while keeping the full application denominator. This is not a claim of full-project coverage. CLI subprocesses are behavior-tested, but their execution is not counted in this Vitest process coverage; the uncovered CLI lines remain in the denominator.

Integration must combine this extension with template-generator/browser-script coverage and separately measured PowerShell coverage. Configuration/test/generated data files must be classified transparently, not silently removed to improve metrics.
