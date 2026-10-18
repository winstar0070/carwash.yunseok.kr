import { createHash, randomBytes, randomUUID } from "node:crypto";
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { parseBackup } from "../backup-data.js";
import { listCatalog, getCatalogProduct } from "./catalog.js";

class ApiError extends Error {
  constructor(status, message, retryAfter) { super(message); this.status = status; this.retryAfter = retryAfter; }
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const encode = (bytes) => Buffer.from(bytes).toString("base64url");
const decode = (value) => new Uint8Array(Buffer.from(value, "base64url"));

export function createApp(db, { origin, rpID }) {
  const frontend = new URL(origin);
  if (frontend.hostname !== rpID && !frontend.hostname.endsWith(`.${rpID}`)) throw new Error("RP_ID must match the frontend domain");
  if (frontend.protocol !== "https:" && frontend.hostname !== "localhost") throw new Error("HTTPS is required outside localhost");
  const secure = frontend.protocol === "https:";
  const cookie = (name, value, age) => `${name}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
  const readCookie = (request, name) => (request.headers.get("cookie") || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || "";
  const session = async (request) => {
    const value = readCookie(request, "carwash_session");
    return value ? (await db.get("SELECT vault_id FROM sessions WHERE token_hash = ? AND expires_at > ?", hash(value), Date.now()))?.vault_id : null;
  };
  const requireSession = async (request) => {
    const id = await session(request);
    if (!id) throw new ApiError(401, "패스키로 보관함을 먼저 열어 주세요.");
    return id;
  };
  // Cookies are shared by tabs; bind each account operation to the caller's intent.
  const requireTarget = (expected, actual) => {
    if (expected === undefined) throw new ApiError(428, "새로고침 후 보관함을 다시 열어 주세요. 변경사항은 기기에 남아 있습니다.");
    if (expected !== actual) throw new ApiError(401, "다른 탭에서 보관함이 바뀌었습니다. 사용할 보관함을 다시 열어 주세요.");
  };
  const response = (data, status = 200, cookies = []) => {
    const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Vary": "Origin", "X-Content-Type-Options": "nosniff" });
    for (const value of cookies) headers.append("Set-Cookie", value);
    return new Response(JSON.stringify(data), { status, headers });
  };
  const createSession = async (vaultID) => {
    const value = token();
    (await db.run("INSERT INTO sessions VALUES (?, ?, ?)", hash(value), vaultID, Date.now() + 30 * 86400000));
    return cookie("carwash_session", value, 30 * 86400);
  };
  const issueChallenge = async (kind, vaultID, challenge) => {
    const value = token();
    (await db.run("INSERT INTO challenges VALUES (?, ?, ?, ?, ?)", hash(value), kind, vaultID, challenge, Date.now() + 300000));
    return cookie("carwash_flow", value, 300);
  };
  const consumeChallenge = async (request, kind) => {
    const value = readCookie(request, "carwash_flow");
    const row = (await db.get("DELETE FROM challenges WHERE token_hash = ? RETURNING *", hash(value)));
    if (!row || row.kind !== kind || row.expires_at < Date.now()) throw new ApiError(400, "인증 요청이 만료되었어요. 다시 시도해 주세요.");
    return row;
  };
  const transaction = (callback) => db.transaction(callback);
  const issueRecovery = async (id) => {
    const code = randomBytes(32).toString("hex");
    (await db.run("UPDATE vaults SET recovery_hash = ? WHERE id = ?", hash(code), id));
    return code.match(/.{1,8}/g).join("-");
  };
  const limit = async (request, path, address) => {
    const bucket = hash(`${address}:${Math.floor(Date.now() / 60000)}:${path}`);
    const row = (await db.get("INSERT INTO rate_limits VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = rate_limits.count + 1 RETURNING count", bucket, Date.now() + 120000));
    if (row.count > (path === "/api/recover" ? 5 : 40)) throw new ApiError(429, "요청이 많아요. 잠시 후 다시 시도해 주세요.");
  };
  // PostgreSQL makes these budgets shared across processes and restarts.
  const registrationBudget = async (scope, maximum, windowMs) => {
    const now = Date.now();
    const end = (Math.floor(now / windowMs) + 1) * windowMs;
    const bucket = hash(`registration:${scope}:${Math.floor(now / windowMs)}`);
    const row = await db.get("INSERT INTO rate_limits VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = rate_limits.count + 1 WHERE rate_limits.count < ? RETURNING count", bucket, end + windowMs, maximum);
    if (!row) throw new ApiError(429, "패스키 등록 한도에 도달했어요. 잠시 후 다시 시도해 주세요.", Math.max(1, Math.ceil((end - now) / 1000)));
  };
  const readBody = async (request) => {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ApiError(415, "JSON 요청이 필요합니다.");
    const reader = request.body?.getReader();
    if (!reader) return {};
    const chunks = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 131072) { await reader.cancel(); throw new ApiError(413, "요청 데이터가 너무 큽니다."); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new ApiError(400, "올바른 JSON을 보내 주세요."); }
  };

  return async function fetch(request, address = "local") {
    const path = new URL(request.url).pathname;
    try {
      if (request.headers.has("origin") && request.headers.get("origin") !== origin) throw new ApiError(403, "허용되지 않은 출처입니다.");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" } });
      if (path === "/api/health" && request.method === "GET") return response({ ok: true });
      if (path === "/api/products" || path.startsWith("/api/products/")) {
        if (request.method !== "GET") throw new ApiError(405, "공용 제품 카탈로그는 조회만 가능합니다.");
        if (path === "/api/products") return response(await listCatalog(db, { picker: new URL(request.url).searchParams.get("view") === "picker" }));
        const product = await getCatalogProduct(db, path.slice("/api/products/".length));
        if (!product) throw new ApiError(404, "제품을 찾을 수 없습니다.");
        return response(product);
      }
      if (request.method === "GET") {
        const id = await requireSession(request);
        if (path === "/api/session") return response({ vaultId: id, passkeys: (await db.get("SELECT count(*) AS count FROM credentials WHERE vault_id = ?", id)).count });
        if (path === "/api/presets") {
          requireTarget(new URL(request.url).searchParams.get("vaultId") ?? undefined, id);
          const row = (await db.get("SELECT presets, revision FROM vaults WHERE id = ?", id));
          return response({ vaultId: id, presets: JSON.parse(row.presets), revision: row.revision });
        }
      }
      if (!["POST", "PUT"].includes(request.method)) throw new ApiError(404, "요청을 찾을 수 없습니다.");
      if (request.headers.get("origin") !== origin) throw new ApiError(403, "요청 출처를 확인할 수 없습니다.");
      await limit(request, path, address);
      const body = await readBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "요청 형식을 확인해 주세요.");

      if (path === "/api/register/options" && request.method === "POST") {
        const existing = await session(request);
        requireTarget(body.vaultId, existing || null);
        await registrationBudget(`options:ip:${address}`, 10, 3600000);
        await registrationBudget("options:global", 100, 3600000);
        const id = existing || randomUUID();
        const credentials = (await db.all("SELECT id, transports FROM credentials WHERE vault_id = ?", id));
        if (credentials.length >= 10) throw new ApiError(400, "패스키는 최대 10개까지 등록할 수 있습니다.");
        const options = await generateRegistrationOptions({ rpName: "세차 계산기", rpID, userID: new TextEncoder().encode(id), userName: `보관함 ${id.slice(0, 8)}`, attestationType: "none", authenticatorSelection: { residentKey: "required", userVerification: "required" }, supportedAlgorithmIDs: [-7, -257], excludeCredentials: credentials.map((row) => ({ id: row.id, transports: JSON.parse(row.transports) })) });
        return response({ options, vaultId: existing || null }, 200, [await issueChallenge(existing ? "add" : "register", id, options.challenge)]);
      }
      if (path === "/api/register/verify" && request.method === "POST") {
        const flowToken = readCookie(request, "carwash_flow");
        const flow = (await db.get("DELETE FROM challenges WHERE token_hash = ? RETURNING *", hash(flowToken)));
        if (!flow || !["register", "add"].includes(flow.kind) || flow.expires_at < Date.now()) throw new ApiError(400, "인증 요청이 만료되었습니다.");
        requireTarget(body.vaultId, flow.kind === "add" ? flow.vault_id : null);
        requireTarget(body.vaultId, await session(request) || null);
        if (flow.kind === "add" && await session(request) !== flow.vault_id) throw new ApiError(401, "보관함을 다시 열어 주세요.");
        let verification;
        try { verification = await verifyRegistrationResponse({ response: body, expectedChallenge: flow.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true }); }
        catch { throw new ApiError(400, "패스키 등록을 확인하지 못했어요. 다시 시도해 주세요."); }
        if (!verification.verified || !verification.registrationInfo) throw new ApiError(400, "패스키를 확인하지 못했습니다.");
        const credential = verification.registrationInfo.credential;
        let recoveryCode;
        const sessionCookie = await transaction(async () => {
          if (flow.kind === "register") {
            await registrationBudget("vaults:global", 100, 86400000);
            await registrationBudget(`vaults:ip:${address}`, 5, 86400000);
            (await db.run("INSERT INTO vaults(id, created_at) VALUES (?, ?)", flow.vault_id, Date.now()));
            recoveryCode = await issueRecovery(flow.vault_id);
          } else {
            await db.get("SELECT id FROM vaults WHERE id = ? FOR UPDATE", flow.vault_id);
            if (await session(request) !== flow.vault_id) throw new ApiError(401, "보관함을 다시 열어 주세요.");
            const count = await db.get("SELECT count(*) AS count FROM credentials WHERE vault_id = ?", flow.vault_id);
            if (Number(count.count) >= 10) throw new ApiError(400, "패스키는 최대 10개까지 등록할 수 있습니다.");
          }
          (await db.run("INSERT INTO credentials VALUES (?, ?, ?, ?, ?, ?)", credential.id, flow.vault_id, encode(credential.publicKey), credential.counter, JSON.stringify(credential.transports || []), Date.now()));
          return createSession(flow.vault_id);
        });
        return response({ vaultId: flow.vault_id, recoveryCode }, 200, [sessionCookie, cookie("carwash_flow", "", 0)]);
      }
      if (path === "/api/login/options" && request.method === "POST") {
        const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
        return response({ options }, 200, [await issueChallenge("login", null, options.challenge)]);
      }
      if (path === "/api/login/verify" && request.method === "POST") {
        const flow = await consumeChallenge(request, "login");
        if (typeof body.id !== "string") throw new ApiError(400, "패스키를 확인하지 못했습니다.");
        const credential = (await db.get("SELECT * FROM credentials WHERE id = ?", body.id));
        if (!credential) throw new ApiError(400, "등록된 패스키를 찾지 못했습니다.");
        if (body.response?.userHandle !== encode(new TextEncoder().encode(credential.vault_id))) throw new ApiError(400, "보관함 정보를 확인하지 못했습니다.");
        let verification;
        try { verification = await verifyAuthenticationResponse({ response: body, expectedChallenge: flow.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true, credential: { id: credential.id, publicKey: decode(credential.public_key), counter: Number(credential.counter), transports: JSON.parse(credential.transports) } }); }
        catch { throw new ApiError(400, "패스키 인증을 확인하지 못했습니다."); }
        if (!verification.verified) throw new ApiError(400, "패스키 인증에 실패했습니다.");
        const sessionCookie = await transaction(async () => {
          await db.get("SELECT id FROM vaults WHERE id = ? FOR UPDATE", credential.vault_id);
          const current = await db.get("SELECT counter FROM credentials WHERE id = ? FOR UPDATE", credential.id);
          if (!current || Number(current.counter) !== Number(credential.counter)) throw new ApiError(400, "패스키 상태가 바뀌었습니다. 다시 인증해 주세요.");
          await db.run("UPDATE credentials SET counter = ? WHERE id = ?", verification.authenticationInfo.newCounter, credential.id);
          return createSession(credential.vault_id);
        });
        return response({ vaultId: credential.vault_id }, 200, [sessionCookie, cookie("carwash_flow", "", 0)]);
      }
      if (path === "/api/recover" && request.method === "POST") {
        if (typeof body.code !== "string") throw new ApiError(400, "복구 코드를 확인해 주세요.");
        const code = body.code.replaceAll("-", "").trim().toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(code)) throw new ApiError(400, "복구 코드를 확인해 주세요.");
        const result = await transaction(async () => {
          const row = (await db.get("UPDATE vaults SET recovery_hash = NULL WHERE recovery_hash = ? RETURNING id", hash(code)));
          if (!row) throw new ApiError(400, "복구 코드가 올바르지 않거나 이미 사용되었습니다.");
          (await db.run("DELETE FROM sessions WHERE vault_id = ?", row.id));
          (await db.run("DELETE FROM challenges WHERE vault_id = ?", row.id));
          (await db.run("DELETE FROM credentials WHERE vault_id = ?", row.id));
          return { vaultId: row.id, recoveryCode: await issueRecovery(row.id), sessionCookie: await createSession(row.id) };
        });
        return response({ vaultId: result.vaultId, recoveryCode: result.recoveryCode, recovered: true }, 200, [result.sessionCookie]);
      }
      const id = await requireSession(request);
      if (["/api/logout", "/api/recovery-code", "/api/presets"].includes(path)) requireTarget(body.vaultId, id);
      if (path === "/api/logout" && request.method === "POST") {
        (await db.run("DELETE FROM sessions WHERE token_hash = ?", hash(readCookie(request, "carwash_session"))));
        return response({ ok: true }, 200, [cookie("carwash_session", "", 0), cookie("carwash_flow", "", 0)]);
      }
      if (path === "/api/recovery-code" && request.method === "POST") return response({ recoveryCode: await issueRecovery(id) });
      if (path === "/api/presets" && request.method === "PUT") {
        if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw new ApiError(400, "데이터 버전을 확인해 주세요.");
        let presets;
        try { presets = body.presets?.length === 0 ? [] : parseBackup(JSON.stringify(body.presets)); }
        catch { throw new ApiError(400, "제품 정보를 확인해 주세요."); }
        if (!Array.isArray(body.presets)) throw new ApiError(400, "제품 목록이 필요합니다.");
        presets = presets.map((row, i) => ({ ...row, id: typeof body.presets[i].id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(body.presets[i].id) ? body.presets[i].id : `preset-${randomUUID()}` }));
        const unique = new Set(presets.map((row) => row.id));
        if (unique.size !== presets.length) throw new ApiError(400, "제품 ID가 중복되었습니다.");
        const updated = (await db.get("UPDATE vaults SET presets = ?, revision = revision + 1 WHERE id = ? AND revision = ? RETURNING revision", JSON.stringify(presets), id, body.revision));
        if (!updated) throw new ApiError(409, "다른 기기에서 변경된 목록이 있습니다. 목록을 비교해 주세요.");
        return response({ vaultId: id, revision: updated.revision, presets });
      }
      throw new ApiError(404, "요청을 찾을 수 없습니다.");
    } catch (error) {
      if (error instanceof ApiError) {
        const result = response({ error: error.message }, error.status);
        if (error.retryAfter) result.headers.set("Retry-After", String(error.retryAfter));
        return result;
      }
      console.error("API request failed", error instanceof Error ? error.name : "UnknownError");
      return response({ error: "처리하지 못했어요. 잠시 후 다시 시도해 주세요." }, 500);
    }
  };
}
