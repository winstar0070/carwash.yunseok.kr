import { cp, mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });
for (const file of ["index.html", "_headers", "pwa.js", "sw.js", "manifest.webmanifest", "icons", "backup.js", "backup-data.js", "config.js"]) {
  await cp(file, `dist/${file}`, { recursive: true });
}
await build({ entryPoints: ["sync.js"], outfile: "dist/sync.js", bundle: true, format: "esm", target: ["safari16", "chrome109"], minify: true });
if (process.env.CARWASH_API_BASE) await writeFile("dist/config.js", `window.CARWASH_API_BASE = ${JSON.stringify(process.env.CARWASH_API_BASE)};\n`);
