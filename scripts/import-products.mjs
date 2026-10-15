import { readFile } from "node:fs/promises";
import { openStore } from "../server/store.js";
import { importCatalog, parseCatalog } from "../server/catalog.js";

async function readInput() {
  const path = process.argv[2];
  if (path && path !== "-") return readFile(path, "utf8");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 5 * 1024 * 1024) throw new Error("카탈로그 파일은 5MB 이하여야 합니다.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const text = await readInput();
parseCatalog(text);
const db = await openStore(process.env.DATABASE_URL);
try {
  console.log(JSON.stringify(await importCatalog(db, text)));
} finally {
  await db.close();
}
