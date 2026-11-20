XIUMI AI Studio, Windows x64 portable build
==========================================

Extract the entire ZIP to a writable private directory. Keep the app/ and
runtime/ directories beside XIUMI AI Studio.exe. Run the executable and open
http://127.0.0.1:5174/ in your browser. The application listens only on local
loopback. Close the console to stop it.

Node is included; launching does not require Node or pnpm on PATH. By
default new data is written under app/data. Preserve that directory
separately when updating. To use another local directory or port, set
DATA_DIR or API_PORT in the launch environment.

Offline recovery from a new “项目和素材备份” ZIP:
1. Stop the app, copy the current app/data (or your configured DATA_DIR)
   to a private snapshot, and unpack your own backup into a different
   private directory. Do not apply archive contents to the active data.
2. From the extracted portable root, in PowerShell run:
   .\runtime\node.exe .\app\scripts\restore-project-backup.mjs "D:\data-copy" "D:\unpacked-backup" "D:\restored-data"
   The last directory must not exist. The inputs are never edited.
3. After success, use the restored project-and-asset subset only with
   an explicit per-session override, for example:
   $env:DATA_DIR = 'D:\restored-data'
   & '.\XIUMI AI Studio.exe'
   Close that shell to leave the default launch unchanged.

On a same-ID project, the existing snapshot wins. A different same-ID
image stops the operation. The output does not contain settings,
credentials, history, templates, components, or custom theme files.
Keep the original data directory unchanged. This is not automatic
migration or in-app restore, and it only accepts the new backup format.

This is an unsigned portable build, not a signed installer or an automatic
desktop update. See build.json for the exact source commit/tree and hashes.
