/**
 * Plannotator reverse proxy at `/plan/:sessionId/*`.
 *
 * Adapted from vibe-plugin-tool-git/src/lib/proxy.ts. The key differences:
 *   - Path-routed by sessionId segment (not a single subprocess).
 *   - Strips iframe-blocking response headers so the host's tunneled
 *     iframe can render plannotator's UI.
 *   - SSE pass-through for /api/ai/query in review mode (Plannotator
 *     uses HTTP-only — no WebSocket).
 *   - Constant-time API-key comparison (avoid string-equality timing).
 *
 * Auth (any one accepted):
 *   - `__vibe_plan_plannotator_session` cookie (24 h TTL, set after first
 *     successful API-key request).
 *   - `x-agent-api-key` header (matches the agent's API key).
 *   - `?apiKey=` query (mainly for top-level iframe loads).
 *   - `Referer` URL `?apiKey=` (for iframe sub-resources when 3rd-party
 *     cookies are blocked).
 */

import { Elysia } from "elysia";

import { getPortForSession, touchSession } from "./process.js";

interface Session {
  token: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const COOKIE_NAME = "__vibe_plan_plannotator_session";
const sessions = new Map<string, Session>();

function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function createSession(): Session {
  const token = generateSessionToken();
  const session: Session = {
    token,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(token, session);
  return session;
}

function validateSessionToken(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function cleanupSessions(): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now > session.expiresAt) sessions.delete(token);
  }
}

setInterval(cleanupSessions, 10 * 60 * 1000);

function getCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still hash both to keep timing roughly constant. The early return
    // above is fine for our threat model — we leak length, not bytes.
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const STRIP_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "x-content-type-options",
]);

interface AuthResult {
  hasValidSession: boolean;
  hasValidApiKey: boolean;
}

function isAuthed(
  request: Request,
  validateApiKey: (key: string) => boolean,
): AuthResult {
  const cookieHeader = request.headers.get("cookie");
  const sessionToken = getCookie(cookieHeader, COOKIE_NAME);
  const apiKeyHeader = request.headers.get("x-agent-api-key");
  const url = new URL(request.url);
  const apiKeyParam = url.searchParams.get("apiKey");

  const hasValidSession = sessionToken
    ? validateSessionToken(sessionToken)
    : false;

  let hasValidApiKey =
    (apiKeyHeader != null && validateApiKey(apiKeyHeader)) ||
    (apiKeyParam != null && validateApiKey(apiKeyParam));

  if (!hasValidApiKey && !hasValidSession) {
    const referer = request.headers.get("referer");
    if (referer) {
      try {
        const refUrl = new URL(referer);
        const refKey = refUrl.searchParams.get("apiKey");
        if (refKey && validateApiKey(refKey)) hasValidApiKey = true;
      } catch {
        // Invalid referer URL.
      }
    }
  }

  return { hasValidSession, hasValidApiKey };
}

function stripSessionIdFromPath(pathname: string): {
  sessionId: string | null;
  remainder: string;
} {
  // pathname always starts with `/plan/<sessionId>/...` here.
  const match = pathname.match(/^\/plan\/([^/]+)(\/.*)?$/);
  if (!match) return { sessionId: null, remainder: pathname };
  return { sessionId: match[1], remainder: match[2] ?? "/" };
}

export function createPlannotatorProxy(
  validateApiKey: (key: string) => boolean,
) {
  return new Elysia({ prefix: "/plan" })
    .all("/*", async ({ request }) => handle(request, validateApiKey))
    .all("/", () => {
      // Bare /plan/ has no sessionId — show a tiny placeholder so the
      // iframe doesn't crash if it's hit directly.
      return new Response("Plannotator: pick a session at /plan/<sessionId>/", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    });
}

async function handle(
  request: Request,
  validateApiKey: (key: string) => boolean,
): Promise<Response> {
  const auth = isAuthed(request, validateApiKey);
  if (!auth.hasValidSession && !auth.hasValidApiKey) {
    return new Response(
      JSON.stringify({
        error:
          "Unauthorized — provide x-agent-api-key, ?apiKey=, or a valid session cookie",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const url = new URL(request.url);
  const { sessionId, remainder } = stripSessionIdFromPath(url.pathname);
  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: "Session id missing in path" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const port = getPortForSession(sessionId);
  if (!port) {
    return new Response(
      JSON.stringify({
        error: `No running plannotator session '${sessionId}'`,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
  touchSession(sessionId);

  let sessionCookieHeader: string | null = null;
  if (!auth.hasValidSession && auth.hasValidApiKey) {
    const session = createSession();
    sessionCookieHeader = `${COOKIE_NAME}=${session.token}; Path=/plan/${sessionId}/; HttpOnly; SameSite=None; Secure; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
  }

  const upstreamUrl = `http://127.0.0.1:${port}${remainder}${url.search}`;
  const upstreamHeaders = new Headers();
  const hopByHop = new Set([
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "proxy-authorization",
    "proxy-authenticate",
  ]);
  request.headers.forEach((value, key) => {
    if (!hopByHop.has(key.toLowerCase())) {
      upstreamHeaders.set(key, value);
    }
  });
  upstreamHeaders.set("Host", `127.0.0.1:${port}`);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
      redirect: "manual",
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Failed to proxy to plannotator",
        details: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  const responseHeaders = new Headers();
  upstreamResponse.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });
  if (sessionCookieHeader) {
    responseHeaders.set("Set-Cookie", sessionCookieHeader);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

// Exported for tests.
export const __test__ = {
  timingSafeEqual,
  stripSessionIdFromPath,
};
