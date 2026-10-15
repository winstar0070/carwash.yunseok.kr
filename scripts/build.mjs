import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const file of ["index.html", "404.html", "_headers", "pwa.js", "sw.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "backup.js", "backup-data.js", "catalog-picker.js", "catalog-data.js", "config.js"]) {
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
for (const file of ["backup.js", "sync.js", "catalog-picker.js"]) {
  const output = await build({ entryPoints: [file], outfile: file, write: false, bundle: true, format: "esm", target: ["safari16", "chrome109"], minify: true });
  await publishScript(file, output.outputFiles[0].contents);
}
await publishScript("config.js", process.env.CARWASH_API_BASE
  ? `window.CARWASH_API_BASE = ${JSON.stringify(process.env.CARWASH_API_BASE)};\n`
  : await readFile("config.js"));
await publishScript("pwa.js", await readFile("pwa.js"));

let html = await readFile("index.html", "utf8");
let worker = await readFile("sw.js", "utf8");
for (const [source, path] of assets) {
  html = html.replace(`src="${source}"`, `src="${path}"`);
  worker = worker.replace(`"${source}"`, JSON.stringify(path));
}
const fingerprint = hash(html + worker);
worker = worker.replace(/const CACHE_NAME = "([^"]+)";/, (_, name) => `const CACHE_NAME = "${name}-${fingerprint}";`);
await writeFile("dist/index.html", html);
await writeFile("dist/sw.js", worker);
