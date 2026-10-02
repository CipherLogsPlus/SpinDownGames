import { handleAuth } from "./auth";
import { handleData } from "./data";
import { HttpError, json } from "./http";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health" && request.method === "GET")
        return json({ service: "spinarium", accountsEnabled: env.AUTH_ENABLED === "true", claimsEnabled: false });
      if (!url.pathname.startsWith("/api/"))
        throw new HttpError(404, "NOT_FOUND", "This endpoint does not exist.");
      // A cookie is useful only on the explicitly configured HTTPS origin.
      // Never accept preview login, bearer tokens, or caller-supplied identity.
      if (env.AUTH_ENABLED !== "true")
        throw new HttpError(503, "ACCOUNTS_DISABLED", "Real accounts are not enabled yet.");
      if (!env.APP_ORIGIN || url.origin !== env.APP_ORIGIN)
        throw new HttpError(403, "ORIGIN_DENIED", "Use the configured Spinarium origin.");
      const response = await handleAuth(request, env) ?? await handleData(request, env);
      return response ?? json({ code: "NOT_FOUND", message: "This endpoint does not exist." }, 404);
    } catch (error) {
      if (error instanceof HttpError)
        return json({ code: error.code, message: error.message }, error.status);
      // Never log URL/query/body/headers: they can contain credentials.
      console.error(JSON.stringify({ event: "spinarium_request_failed", method: request.method }));
      return json({ code: "SERVICE_UNAVAILABLE", message: "Spinarium could not complete this request." }, 503);
    }
  },
} satisfies ExportedHandler<Env>;
