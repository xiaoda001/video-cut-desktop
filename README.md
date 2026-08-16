# FrameCut

FrameCut 是一个基于 Tauri 2、React 19、SQLite 和 FFmpeg 的本地视频批量裁剪桌面应用。应用只创建一个主窗口，使用 Hash Router 在视频项目库与编辑页面之间导航。

## 功能

- 批量导入 MP4、MOV、MKV、AVI、WebM、M4V 视频
- 每个视频独立项目目录，保留原文件并自动生成首帧封面
- 按平均秒数切分完整视频，或按开始/结束秒数提取单个区间
- 点击片段播放、双击最大化、导出所选片段
- SQLite 保存项目、片段和设置
- 可配置默认平均裁剪秒数与新项目存储目录

## FFmpeg 安装流程

Windows 安装包会内置 FFmpeg，不在应用首次启动时联网下载：

1. 构建 NSIS 安装包前，`npm run prepare:ffmpeg` 下载约 33 MB 的 Essentials 7z 并校验 SHA-256。
2. 7z 文件作为资源打入安装程序。
3. 用户安装时，NSIS `POSTINSTALL` 钩子调用 FrameCut 的命令行解压模式。
4. 只安装 `ffmpeg.exe` 和 `ffprobe.exe` 到应用目录的 `ffmpeg/bin`，然后删除 7z。
5. 卸载应用时一并删除 FFmpeg 目录。

下载来源：

- `https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.7z`
- `https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.7z.sha256`

macOS、Linux 以及开发模式从系统 `PATH` 或以下环境变量查找工具：

```powershell
$env:FRAMECUT_FFMPEG = "D:\tools\ffmpeg\bin\ffmpeg.exe"
$env:FRAMECUT_FFPROBE = "D:\tools\ffmpeg\bin\ffprobe.exe"
```

## 开发和构建

需要 Node.js 20+、Rust 1.77+ 和当前操作系统对应的 Tauri 平台依赖。macOS 和 Linux 还需要预先安装 FFmpeg，并确保 `ffmpeg`、`ffprobe` 位于系统 `PATH`。

```powershell
npm install
npm run tauri dev
```

在当前操作系统生成安装包（Windows 为 NSIS，macOS 为 DMG，Linux 为 DEB/AppImage）：

```powershell
npm run tauri build
```

推送 `v*` 版本标签后，GitHub Actions 会同时启动 Windows、macOS 和 Linux 三个平台的构建，并把安装包上传到同一个草稿 Release。

> 修改项目存储位置只影响之后显示和导入的项目库，不会自动移动旧目录中的项目文件。
