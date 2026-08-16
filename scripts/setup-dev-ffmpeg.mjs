import { spawn, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

if (process.platform !== "win32") {
  const available = ["ffmpeg", "ffprobe"].every((tool) =>
    spawnSync(tool, ["-version"], { stdio: "ignore" }).status === 0
  );
  if (!available) {
    throw new Error("macOS/Linux 开发环境需要先安装 FFmpeg，并确保 ffmpeg 和 ffprobe 位于系统 PATH。");
  }
  console.log("已检测到系统 FFmpeg，继续启动开发环境。");
  process.exit(0);
}

const projectRoot = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(projectRoot, "src-tauri", "Cargo.toml");
const archivePath = path.join(
  projectRoot,
  "src-tauri",
  "resources",
  "ffmpeg-release-essentials.7z",
);
const executablePath = path.join(
  projectRoot,
  "src-tauri",
  "target",
  "debug",
  "framecut.exe",
);
const ffmpegBinPath = path.join(
  projectRoot,
  "src-tauri",
  "target",
  "debug",
  "ffmpeg",
  "bin",
);
const ffmpegPath = path.join(ffmpegBinPath, "ffmpeg.exe");
const ffprobePath = path.join(ffmpegBinPath, "ffprobe.exe");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      windowsHide: true,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason = signal ? `信号 ${signal}` : `退出码 ${code}`;
      reject(new Error(`${command} 执行失败（${reason}）`));
    });
  });
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (await exists(archivePath)) {
  console.log(`[1/3] 使用已有 FFmpeg 压缩包：${archivePath}`);
} else {
  console.log("[1/3] 下载 FFmpeg 压缩包...");
  await run(process.execPath, [path.join(projectRoot, "scripts", "prepare-ffmpeg.mjs")]);
}

if ((await exists(ffmpegPath)) && (await exists(ffprobePath))) {
  console.log(`开发环境 FFmpeg 已存在：${ffmpegBinPath}`);
  process.exit(0);
}

console.log("[2/3] 编译 FrameCut 开发程序...");
await run("cargo", ["build", "--manifest-path", manifestPath]);

console.log("[3/3] 解压 FFmpeg 到开发程序目录...");
await run(executablePath, ["--install-ffmpeg", archivePath, ffmpegBinPath]);

if (!(await exists(ffmpegPath)) || !(await exists(ffprobePath))) {
  throw new Error("解压命令已结束，但没有找到 ffmpeg.exe 或 ffprobe.exe。");
}

console.log(`开发环境 FFmpeg 准备完成：${ffmpegBinPath}`);
