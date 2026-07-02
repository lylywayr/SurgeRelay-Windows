# Surge Relay Windows

[中文](README.md) | [English](README.en.md)

Surge Relay Windows is a Windows desktop port of Surge Relay, a tool for
organizing, converting, editing, merging, and publishing Surge modules.

This project is derived from:

- Upstream macOS project: `EEliberto/SurgeRelay-macOS`

The Windows version uses Electron and Node.js for the desktop shell and local
runtime while retaining the Surge module management workflow and Script-Hub
based conversion model.

## Features

- Windows desktop app with tray support.
- Local Web UI for module management.
- Add, edit, delete, enable, and disable source modules.
- Convert Quantumult X rewrite and Loon plugin sources to Surge modules through Script-Hub's local JavaScript engine.
- Preserve native Surge `.sgmodule` sources.
- Merge enabled modules into one combined Surge module.
- Edit converted module content locally.
- Configure module arguments.
- Save combined module output to a local Windows folder.
- Publish generated modules to a private GitHub repository.
- Optional automatic module refresh.
- Optional launch at Windows login.

Cloudflare public URL integration is intentionally not included yet.

## Download

Tagged releases are built by GitHub Actions.

- Latest release page: <https://github.com/lylywayr/SurgeRelay-Windows/releases/latest>
- Current packaged Windows zip: <https://github.com/lylywayr/SurgeRelay-Windows/releases/download/v0.1.0/SurgeRelay-Windows-v0.1.0-win32-x64.zip>

Download the Windows zip, extract it, and run:

```text
Surge Relay.exe
```

## Development

Install Node.js 20 or newer, then run:

```powershell
npm ci
npm run windows:dev
```

Create a local unpacked Windows build:

```powershell
npm run windows:package
```

The output is written to:

```text
dist-windows/Surge Relay-win32-x64
```

## Release

Create and push a version tag:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions will build a portable Windows zip and attach it to a GitHub
Release.

## GitHub Publishing Notes

Surge Relay Windows only publishes to private GitHub repositories. This matches
the upstream project's policy of avoiding public repositories as bulk module
distribution targets.

The GitHub token should have access to the target private repository. Fine
grained tokens should include repository contents read/write permission.

## License

This project is licensed under the Apache License 2.0.

Because this is a derivative work of the upstream Surge Relay macOS project,
the original license and notices are retained. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
