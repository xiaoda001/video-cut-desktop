import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import path from "node:path";

if (process.platform !== "win32") {
  throw new Error("Bundled FFmpeg preparation is only used by the Windows installer. macOS and Linux use FFmpeg from the system PATH.");
}

const archiveAliasUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.7z";
const checksumUrl = `${archiveAliasUrl}.sha256`;
const versionUrl = `${archiveAliasUrl}.ver`;
const resourceDir = path.resolve("src-tauri/resources");
const archivePath = path.join(resourceDir, "ffmpeg-release-essentials.7z");
const temporaryPath = `${archivePath}.part`;

async function sha256(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function downloadWithCurl(url, outputPath, resume = false) {
  await new Promise((resolve, reject) => {
    const args = ["-L", "--fail", "--retry", "3", "--connect-timeout", "20"];
    if (resume) args.push("--continue-at", "-");
    args.push("--output", outputPath, url);
    const child = spawn("curl", args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`curl 下载失败，退出码 ${code}`)));
  });
}

await mkdir(resourceDir, { recursive: true });
const checksumPath = path.join(resourceDir, "ffmpeg-release-essentials.7z.sha256.part");
await downloadWithCurl(checksumUrl, checksumPath);
const expected = (await readFile(checksumPath, "utf8")).trim().split(/\s+/)[0].toLowerCase();
await rm(checksumPath, { force: true });
if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("FFmpeg 下载源返回了无效的 SHA-256 校验值");

const versionPath = path.join(resourceDir, "ffmpeg-release-essentials.7z.ver.part");
await downloadWithCurl(versionUrl, versionPath);
const version = (await readFile(versionPath, "utf8")).trim();
await rm(versionPath, { force: true });
if (!/^[0-9]+(?:\.[0-9]+)+$/.test(version)) throw new Error("FFmpeg 下载源返回了无效的版本号");
const githubArchiveUrl = `https://github.com/GyanD/codexffmpeg/releases/download/${version}/ffmpeg-${version}-essentials_build.7z`;

try {
  if (await sha256(archivePath) === expected) {
    console.log("FFmpeg 7z 已存在且校验通过，跳过下载");
    process.exit(0);
  }
} catch { /* 文件不存在或不可读时重新下载 */ }

console.log(`正在从官方 GitHub 镜像下载 FFmpeg 7z：${githubArchiveUrl}`);
try {
  await downloadWithCurl(githubArchiveUrl, temporaryPath, true);
} catch (error) {
  console.warn(`GitHub 镜像下载失败，回退到 gyan.dev：${error.message}`);
  await downloadWithCurl(archiveAliasUrl, temporaryPath, true);
}
const actual = await sha256(temporaryPath);
if (actual !== expected) {
  await rm(temporaryPath, { force: true });
  throw new Error("FFmpeg 7z SHA-256 校验失败，下载文件已删除");
}
await rm(archivePath, { force: true });
await rename(temporaryPath, archivePath);
console.log(`FFmpeg 7z 已准备完成：${archivePath}`);
