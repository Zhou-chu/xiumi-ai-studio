# Module dependency architecture

Run `pnpm quality:architecture` after the normal frozen install. The Windows
Node 24 CI matrix runs it as an error gate, independent of the browser suite.

The pinned Dependency Cruiser scans production `src/` and `server/` modules
with the project's TypeScript resolver, including pre-compilation imports and
re-exports. It does not recurse into external npm packages. Rules forbid:

- core imports from editor;
- browser source imports from server implementation;
- circular project module dependencies;
- unresolved relative imports in these production modules.

The initial baseline covers six findings on fork main `bb593be`: two
browser-to-server type imports and four cycle reports. An exception records
only its rule, exact resolved import endpoints and, for a cycle, its path.
A new violation or stale exception fails the gate. When a violation is fixed,
remove only its obsolete entry in the same change. Don't regenerate the
baseline to accommodate new violations; fix the dependency direction instead.
