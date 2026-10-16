import test from "node:test";
import assert from "node:assert/strict";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("Pages build publishes only runtime assets and removes stale private files", async () => {
  const directory = await mkdtemp(join(process.env.CARWASH_TEST_TEMP_DIR || tmpdir(), "carwash-build-"));
  try {
    for (const file of ["index.html", "404.html", "_headers", "pwa.js", "sw.js", "manifest.webmanifest", "icons", "backup-data.js", "catalog-picker.js", "catalog-data.js", "config.js", "sync.js", "vault-sync.js", "scripts/build.mjs", "package.json", "compose.yaml", ".env.example", "server", "migrations"]) {
      try { await lstat(join(root, file)); } catch (error) { if (error.code === "ENOENT" && file === "404.html") continue; throw error; }
      await mkdir(dirname(join(directory, file)), { recursive: true });
      await cp(join(root, file), join(directory, file), { recursive: true });
    }
    await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
    await mkdir(join(directory, "dist/server"), { recursive: true });
    await writeFile(join(directory, "dist/.env.example"), "STALE_PRIVATE_CANARY");
    await writeFile(join(directory, "dist/server/private.js"), "STALE_SOURCE_CANARY");
    await writeFile(join(directory, ".env"), "FAKE_SECRET_CANARY");
    await writeFile(join(directory, "icons/.env"), "NESTED_PRIVATE_CANARY");
    const env = { ...process.env };
    delete env.CARWASH_API_BASE;
    const build = () => {
      const result = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: directory, env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    };
    build();
    const entries = await readdir(join(directory, "dist"), { recursive: true });
    const files = [];
    for (const entry of entries) {
      const info = await lstat(join(directory, "dist", entry));
      assert.equal(info.isSymbolicLink(), false, `Public output must not contain symlinks: ${entry}`);
      if (info.isFile()) files.push(entry);
    }
    const versioned = files.filter(file => /^assets\/(sync|catalog-picker|config|pwa)-[a-f0-9]{16}\.js$/.test(file));
    assert.equal(versioned.length, 4, "Client bundles and API config must have immutable URLs");
    assert.deepEqual(files.filter(file => !versioned.includes(file)).sort(), ["404.html", "_headers", "catalog-picker.js", "catalog-data.js", "config.js", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "index.html", "manifest.webmanifest", "pwa.js", "sw.js", "sync.js"].sort());
    const html = await readFile(join(directory, "dist/index.html"), "utf8");
    const sw = await readFile(join(directory, "dist/sw.js"), "utf8");
    for (const file of versioned) {
      assert.ok(html.includes(`src="/${file}"`));
      assert.ok(sw.includes(`"/${file}"`), `Offline cache must contain ${file}`);
      assert.doesNotMatch(await readFile(join(directory, "dist", file), "utf8"), /from\s*["']@simplewebauthn\//);
    }
    for (const file of ["config.js", "sync.js", "catalog-picker.js", "pwa.js"]) assert.ok(!html.includes(`src="/${file}"`));
    assert.equal(await readFile(join(directory, "dist/config.js"), "utf8"), 'window.CARWASH_API_BASE = "https://carwash-api.yunseok.kr/api";\n');
    assert.doesNotMatch(await readFile(join(directory, "dist/sync.js"), "utf8"), /from\s*["']@simplewebauthn\//);
    const manifest = JSON.parse(await readFile(join(directory, "dist/manifest.webmanifest"), "utf8"));
    for (const icon of manifest.icons) assert.ok(files.includes(icon.src.replace(/^\//, "")));

    env.CARWASH_API_BASE = "http://localhost:8787/api";
    build();
    assert.equal(await readFile(join(directory, "dist/config.js"), "utf8"), 'window.CARWASH_API_BASE = "http://localhost:8787/api";\n');
    const updatedHTML = await readFile(join(directory, "dist/index.html"), "utf8");
    const updatedSW = await readFile(join(directory, "dist/sw.js"), "utf8");
    assert.notEqual(updatedHTML.match(/assets\/config-[a-f0-9]+\.js/)[0], html.match(/assets\/config-[a-f0-9]+\.js/)[0]);
    assert.notEqual(updatedSW.match(/const CACHE_NAME = (.*);/)[1], sw.match(/const CACHE_NAME = (.*);/)[1]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
