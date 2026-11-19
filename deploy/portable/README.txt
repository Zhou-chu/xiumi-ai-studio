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

This is an unsigned portable build, not a signed installer or an automatic
desktop update. See build.json for the exact source commit/tree and hashes.
