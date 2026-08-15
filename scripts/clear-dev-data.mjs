import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const appIdentifier = "com.framecut.desktop";

function dataRoots() {
  if (process.platform === "win32") {
    const roots = [process.env.APPDATA, process.env.LOCALAPPDATA];
    if (roots.some((root) => !root)) {
      throw new Error("无法定位 Windows 应用数据目录（APPDATA/LOCALAPPDATA）。");
    }
    return roots;
  }

  if (process.platform === "darwin") {
    return [path.join(os.homedir(), "Library", "Application Support")];
  }

  return [process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")];
}

const targets = [...new Set(dataRoots().map((root) => path.resolve(root, appIdentifier)))];

for (const target of targets) {
  const parent = path.dirname(target);
  if (path.basename(target) !== appIdentifier || target === parent) {
    throw new Error(`拒绝清理非预期路径：${target}`);
  }

  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  });
  console.log(`已清理：${target}`);
}

console.log("FrameCut 开发环境缓存及默认应用数据已清空。请重新启动应用。");
