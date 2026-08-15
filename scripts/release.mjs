import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const rawArguments = process.argv.slice(2);
const dryRun = rawArguments.includes("dry-run") || rawArguments.includes("--dry-run");
const versionArgument = rawArguments.find((argument) => argument !== "dry-run" && argument !== "--dry-run") || "patch";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const detail = options.capture ? (result.stderr || result.stdout || "").trim() : "";
    throw new Error(`${command} ${args.join(" ")} 执行失败（退出码 ${result.status}）${detail ? `：${detail}` : ""}`);
  }
  return result;
}

function resolveVersion(current, requested) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) throw new Error(`package.json 中的版本号无效：${current}`);
  if (/^\d+\.\d+\.\d+$/.test(requested)) return requested;
  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  if (requested === "major") return `${major + 1}.0.0`;
  if (requested === "minor") return `${major}.${minor + 1}.0`;
  if (requested === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error("版本参数必须是 patch、minor、major 或 x.y.z 格式的具体版本号。");
}

function replaceExactly(content, pattern, replacement, fileName) {
  const matches = content.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(`${fileName} 中预期替换 1 处版本号，实际找到 ${matches?.length || 0} 处。`);
  }
  return content.replace(pattern, replacement);
}

async function updateVersions(version) {
  const packagePath = path.join(projectRoot, "package.json");
  const packageLockPath = path.join(projectRoot, "package-lock.json");
  const tauriConfigPath = path.join(projectRoot, "src-tauri", "tauri.conf.json");
  const cargoTomlPath = path.join(projectRoot, "src-tauri", "Cargo.toml");
  const cargoLockPath = path.join(projectRoot, "src-tauri", "Cargo.lock");

  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  packageJson.version = version;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  const packageLock = JSON.parse(await readFile(packageLockPath, "utf8"));
  packageLock.version = version;
  packageLock.packages[""].version = version;
  await writeFile(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`, "utf8");

  const tauriConfig = await readFile(tauriConfigPath, "utf8");
  await writeFile(
    tauriConfigPath,
    replaceExactly(tauriConfig, /"version": "[^"]+"/g, `"version": "${version}"`, "tauri.conf.json"),
    "utf8",
  );

  const cargoToml = await readFile(cargoTomlPath, "utf8");
  await writeFile(
    cargoTomlPath,
    replaceExactly(cargoToml, /^version = "[^"]+"$/gm, `version = "${version}"`, "Cargo.toml"),
    "utf8",
  );

  const cargoLock = await readFile(cargoLockPath, "utf8");
  await writeFile(
    cargoLockPath,
    replaceExactly(
      cargoLock,
      /(?<=\[\[package\]\]\r?\nname = "framecut"\r?\n)version = "[^"]+"/g,
      `version = "${version}"`,
      "Cargo.lock",
    ),
    "utf8",
  );
}

const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const nextVersion = resolveVersion(packageJson.version, versionArgument);
const tag = `v${nextVersion}`;
const branch = run("git", ["branch", "--show-current"], { capture: true }).stdout.trim();
if (!branch) throw new Error("当前处于 detached HEAD，无法执行发布。");
if (nextVersion === packageJson.version) throw new Error(`目标版本 ${nextVersion} 与当前版本相同。`);
if (run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], { capture: true, allowFailure: true }).status === 0) {
  throw new Error(`本地标签 ${tag} 已存在。`);
}

console.log(`准备发布 ${packageJson.version} -> ${nextVersion}（分支 ${branch}）`);
console.log("[1/6] 验证前端构建...");
if (!process.env.npm_execpath) throw new Error("请通过 npm run release 执行发布命令。");
run(process.execPath, [process.env.npm_execpath, "run", "build"]);
console.log("[2/6] 验证 Rust 测试...");
run("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"]);

if (dryRun) {
  console.log(`[dry-run] 验证通过；实际执行将提交全部改动、发布 ${tag} 并推送分支与全部标签。`);
  process.exit(0);
}

console.log("[3/6] 提交当前全部改动...");
run("git", ["add", "-A"]);
const hasChanges = run("git", ["diff", "--cached", "--quiet"], { allowFailure: true }).status !== 0;
if (hasChanges) run("git", ["commit", "-m", `chore: prepare release ${tag}`]);
else console.log("当前没有待提交改动，跳过准备提交。");

console.log(`[4/6] 同步版本号并创建 ${tag}...`);
await updateVersions(nextVersion);
run("git", ["add", "package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json"]);
run("git", ["commit", "-m", `chore: release ${tag}`]);
run("git", ["tag", "-a", tag, "-m", `FrameCut ${tag}`]);

console.log(`[5/6] 推送分支 ${branch}...`);
run("git", ["push", "origin", branch]);
console.log("[6/6] 推送全部标签...");
run("git", ["push", "origin", "--tags"]);
console.log(`发布完成：${tag}`);
