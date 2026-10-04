import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions, Response as MiniflareResponse } from "miniflare";
import type { Env } from "../src/types";

export const origin = "https://spinarium.test";
export async function createHarness(overrides: Partial<Env> = {}, outbound?: (request: Request) => Promise<Response>) {
  const bindings = {
    AUTH_ENABLED: "true", AUTH_PROVIDER: "oidc", SIGNUP_ENABLED: "false", APP_ORIGIN: origin,
    OIDC_ISSUER: "https://identity.test", OIDC_CLIENT_ID: "spinarium-test",
    OIDC_CLIENT_SECRET: "test-only-provider-secret", AUTH0_CONNECTION: "Username-Password-Authentication", ...overrides,
  };
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    cf: false,
    scriptPath: new URL("../dist/index.js", import.meta.url).pathname,
    compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "test-db" }, r2Buckets: ["ARTWORK"],
    bindings,
    // Every external call must go through a test fixture. No real IdP/network.
    outboundService: async (request) => {
      if (!outbound) throw new Error("Unexpected outbound request in local test");
      const response = await outbound(new Request(request.url, {
        method: request.method, headers: request.headers,
        ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: await request.arrayBuffer() }),
      }));
      return new MiniflareResponse(await response.arrayBuffer(), { status: response.status, headers: response.headers });
    },
  }));
  const env = await mf.getBindings<Env>();
  const db = env.DB;
  const r2 = env.ARTWORK;
  for (const file of ["0001_foundation.sql", "0002_password_accounts.sql", "0003_account_management.sql", "0005_member_showcase.sql"]) {
    const migration = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    const statements = migration.split(/;\s*(?:\n|$)/).filter((statement) => statement.trim());
    for (const statement of statements) await db.prepare(statement).run();
  }
  return {
    mf, db, r2, env,
    fetch: (path: string, init: RequestInit = {}) => mf.dispatchFetch(new URL(path, origin), { ...init, redirect: "manual" }),
  };
}

export async function seedSession(db: D1Database, options: {
  id?: string; admin?: boolean; owner?: boolean; disabled?: boolean; expiresAt?: number; token?: string; csrfToken?: string; displayName?: string; email?: string;
} = {}) {
  const id = options.id ?? crypto.randomUUID();
  const token = options.token ?? Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const csrfToken = options.csrfToken ?? Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = options.expiresAt ?? now + 3600;
  await db.prepare(`INSERT INTO users (id,oidc_issuer,oidc_subject,display_name,disabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(id, "https://identity.test", id, options.displayName ?? "Test Collector", options.disabled ? 1 : 0, now, now).run();
  if (options.email) await db.prepare("INSERT INTO password_accounts(user_id,email_normalized,password_hash,created_at,updated_at) VALUES (?,?,?,?,?)")
    .bind(id, options.email.toLowerCase(), "local-fixture-noncredential", now, now).run();
  await db.prepare(`INSERT INTO sessions (token_hash,user_id,csrf_token,created_at,expires_at) VALUES (?,?,?,?,?)`)
    .bind(hash, id, csrfToken, Math.min(now - 1, expiresAt - 3600), expiresAt).run();
  if (options.admin || options.owner) await db.prepare("INSERT INTO admin_allowlist(user_id,granted_at,granted_by,role) VALUES (?,?,?,?)")
    .bind(id, now, "test-only trusted operator", options.owner ? "owner" : "admin").run();
  return {
    id, token, hash, csrfToken,
    cookie: `__Host-spinarium_session=${token}`,
    headers: { Cookie: `__Host-spinarium_session=${token}`, Origin: origin, "X-CSRF-Token": csrfToken },
  };
}
