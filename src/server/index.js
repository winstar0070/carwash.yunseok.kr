import { serve } from "@hono/node-server";
import { openStore } from "./store.js";
import { createApp } from "./app.js";
import { startMaintenance } from "./maintenance.js";

const origin = process.env.ORIGIN || "http://localhost:8766";
const rpID = process.env.RP_ID || "localhost";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = await openStore(process.env.DATABASE_URL);
const app = createApp(db, { origin, rpID });
const stopMaintenance = startMaintenance(db);
const server = serve({ port: Number(process.env.PORT || 8787), hostname: "0.0.0.0", fetch: (request, env) => app(request, env.incoming.socket.remoteAddress || "local") });
const stop = () => server.close(async () => { await stopMaintenance(); await db.close(); process.exit(0); });
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
