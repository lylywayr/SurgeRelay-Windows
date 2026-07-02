# Surge Relay Windows Prototype

This is a first-pass Windows desktop shell for the existing Surge Relay web UI.

It intentionally does not replace the macOS app. The current goal is to prove
that the UI and local management flow can run inside a Windows desktop app.

## Run

Install Node.js LTS first, then run:

```powershell
npm install
npm run windows:dev
```

## What Works

- Starts an Electron desktop window.
- Serves the existing `SurgeRelay/WebResources` UI from a local HTTP server.
- Persists module records under Electron's user data directory.
- Supports adding, editing, deleting, enabling, disabling, previewing, and
  basic updating of modules.
- Downloads native Surge module sources and stores them as local preview data.

## Still To Port

- The full Script-Hub conversion engine from Swift/JavaScriptCore to Node/V8.
- GitHub private repository publishing.
- Cloudflare URL validation and publishing integration.
- Windows tray menu polish, start-at-login, auto-update, and installer signing.
- Migration of existing macOS/iCloud configuration paths to Windows/OneDrive or
  user-selected folders.
