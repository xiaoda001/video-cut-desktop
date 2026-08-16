import { readFile } from "node:fs/promises";

const releaseTag = process.env.RELEASE_TAG;
if (!releaseTag) throw new Error("RELEASE_TAG is required.");

const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const expectedTag = `v${config.version}`;

if (releaseTag !== expectedTag) {
  throw new Error(`Tag ${releaseTag} does not match application version ${expectedTag}.`);
}

console.log(`Release tag ${releaseTag} matches the application version.`);
