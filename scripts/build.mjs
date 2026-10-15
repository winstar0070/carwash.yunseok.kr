import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const file of ["index.html", "404.html", "_headers", "pwa.js", "sw.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "backup.js", "backup-data.js", "catalog-picker.js", "catalog-data.js", "config.js"]) {
  await mkdir(dirname(`dist/${file}`), { recursive: true });
  await cp(file, `dist/${file}`);
}
await build({ entryPoints: ["sync.js"], outfile: "dist/sync.js", bundle: true, format: "esm", target: ["safari16", "chrome109"], minify: true });
if (process.env.CARWASH_API_BASE) await writeFile("dist/config.js", `window.CARWASH_API_BASE = ${JSON.stringify(process.env.CARWASH_API_BASE)};\n`);
