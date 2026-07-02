# Surge Relay Windows

[English](README.md) | [中文](README.zh-CN.md)

Surge Relay Windows 是 Surge Relay 的 Windows 桌面移植版，用于集中管理、
转换、编辑、合并和发布 Surge 模块。

本项目派生自：

- 上游 macOS 项目：`EEliberto/SurgeRelay-macOS`

Windows 版使用 Electron 和 Node.js 实现桌面外壳与本地运行时，同时保留
Surge 模块管理流程以及基于 Script-Hub 的本地转换模型。

## 功能

- Windows 桌面应用，支持托盘。
- 本地 Web UI 管理模块。
- 添加、编辑、删除、启用和停用来源模块。
- 通过 Script-Hub 本地 JavaScript 引擎，将 Quantumult X rewrite 和 Loon
  plugin 来源转换为 Surge 模块。
- 支持原生 Surge `.sgmodule` 来源。
- 将启用的模块合并为一个总 Surge 模块。
- 本地编辑转换后的模块内容。
- 配置模块参数。
- 将总模块保存到本地 Windows 文件夹。
- 将生成的模块发布到私有 GitHub 仓库。
- 可选定时自动刷新模块。
- 可选 Windows 开机启动。

Cloudflare 公共地址联动暂未包含。

## 下载

带版本标签的 release 会由 GitHub Actions 自动构建。前往仓库 Releases 页面
下载最新 Windows zip，解压后运行：

```text
Surge Relay.exe
```

## 开发

安装 Node.js 20 或更高版本，然后运行：

```powershell
npm ci
npm run windows:dev
```

创建本地未打包安装器的 Windows 构建：

```powershell
npm run windows:package
```

输出目录：

```text
dist-windows/Surge Relay-win32-x64
```

## 发布

创建并推送版本标签：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions 会构建 portable Windows zip，并自动附加到 GitHub Release。

## GitHub 发布说明

Surge Relay Windows 只允许发布到私有 GitHub 仓库。这与上游项目策略一致，
用于避免公开仓库被批量滥用为模块分发目标。

GitHub Token 需要能够访问目标私有仓库。细粒度 token 应包含 repository
contents 读写权限。

## 许可证

本项目使用 Apache License 2.0。

由于本项目是 Surge Relay macOS 上游项目的派生作品，原始许可证和声明会
继续保留。参见 [LICENSE](LICENSE) 和
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
