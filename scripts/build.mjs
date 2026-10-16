import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const file of ["index.html", "404.html", "_headers", "pwa.js", "sw.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "catalog-picker.js", "catalog-data.js", "config.js"]) {
  await mkdir(dirname(`dist/${file}`), { recursive: true });
  await cp(file, `dist/${file}`);
}
const hash = content => createHash("sha256").update(content).digest("hex").slice(0, 16);
const assets = new Map();
await mkdir("dist/assets", { recursive: true });
async function publishScript(file, content) {
  const path = `/assets/${file.replace(/\.js$/, "")}-${hash(content)}.js`;
  await writeFile(`dist${path}`, content);
  await writeFile(`dist/${file}`, content); // Existing installed clients may still use the old URLs.
  assets.set(`/${file}`, path);
}
for (const file of ["sync.js", "catalog-picker.js"]) {
  const output = await build({ entryPoints: [file], outfile: file, write: false, bundle: true, format: "esm", target: ["safari16", "chrome109"], minify: true });
  await publishScript(file, output.outputFiles[0].contents);
}
await publishScript("config.js", process.env.CARWASH_API_BASE
  ? `window.CARWASH_API_BASE = ${JSON.stringify(process.env.CARWASH_API_BASE)};\n`
  : await readFile("config.js"));
await publishScript("pwa.js", await readFile("pwa.js"));

let html = await readFile("index.html", "utf8");
let commit = process.env.CF_PAGES_COMMIT_SHA;
if (!commit) {
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    // Source archives may not contain Git metadata.
  }
}
const buildVersion = /^[a-f0-9]{40,64}$/i.test(commit || "")
  ? ` · 빌드 <span title="커밋 ${commit}">${commit.slice(0, 7)}</span>`
  : " · 빌드 개발";
html = html.replace('<span id="build-version"></span>', `<span id="build-version">${buildVersion}</span>`);
let worker = await readFile("sw.js", "utf8");
for (const [source, path] of assets) {
  html = html.replace(`src="${source}"`, `src="${path}"`);
  worker = worker.replace(`"${source}"`, JSON.stringify(path));
}
const fingerprint = hash(html + worker);
worker = worker.replace(/const CACHE_NAME = "([^"]+)";/, (_, name) => `const CACHE_NAME = "${name}-${fingerprint}";`);
await writeFile("dist/index.html", html);
await writeFile("dist/sw.js", worker);
