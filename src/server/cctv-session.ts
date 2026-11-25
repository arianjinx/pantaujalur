const CCTV_ORIGIN = "https://cctv.malangkota.go.id";
const MAP_PAGE_URL = `${CCTV_ORIGIN}/sebaran-cctv`;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const SESSION_MAX_AGE_MS = 50 * 60 * 1000;

type Session = { cookie: string; createdAt: number };

export const SESSION_REJECTED = Symbol("session rejected");

let current: Session | null = null;

export class CctvUnavailable extends Error {}

export function cctvUnavailableResponse(error: unknown): Response {
  if (!(error instanceof CctvUnavailable)) throw error;
  return new Response(error.message, { status: 502 });
}

type CctvPath =
  "/sebaran-cctv" | "/api/v2/get-cameras" | `/cctv-stream/streams/${string}`;

export async function cctvFetch(
  path: CctvPath,
  init: RequestInit = {},
): Promise<Response> {
  const relay = process.env.CCTV_UPSTREAM_URL;
  if (!relay) return fetch(`${CCTV_ORIGIN}${path}`, init);
  const secret = process.env.CCTV_RELAY_SECRET;
  if (!secret)
    throw new Error("CCTV_UPSTREAM_URL is set without CCTV_RELAY_SECRET");
  const headers = new Headers(init.headers);
  headers.set("x-relay-secret", secret);
  return fetch(new URL(path, relay), { ...init, headers });
}

async function openSession(): Promise<Session> {
  const response = await cctvFetch("/sebaran-cctv", {
    headers: { "User-Agent": BROWSER_USER_AGENT },
  }).catch((error: unknown) => {
    throw new CctvUnavailable(
      `Could not reach the CCTV server: ${String(error)}`,
    );
  });
  await response.body?.cancel();
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(";", 1)[0])
    .join("; ");
  if (!response.ok || !cookie.includes("NANCY_TOKEN")) {
    throw new CctvUnavailable(
      `Could not open a CCTV session: HTTP ${response.status}, server ${response.headers.get("server") ?? "unknown"}, ${cookie === "" ? "no cookies" : "no NANCY_TOKEN cookie"}`,
    );
  }
  return { cookie, createdAt: Date.now() };
}

async function sessionReplacing(stale: Session | null): Promise<Session> {
  if (
    current !== null &&
    current !== stale &&
    Date.now() - current.createdAt < SESSION_MAX_AGE_MS
  ) {
    return current;
  }
  current = await openSession();
  return current;
}

function headersFor(session: Session): Record<string, string> {
  return {
    Cookie: session.cookie,
    "User-Agent": BROWSER_USER_AGENT,
    Referer: MAP_PAGE_URL,
  };
}

export async function withCctvSession<T>(
  attempt: (
    headers: Record<string, string>,
  ) => Promise<T | typeof SESSION_REJECTED>,
): Promise<T> {
  const first = await sessionReplacing(null);
  const result = await attempt(headersFor(first));
  if (result !== SESSION_REJECTED) return result;

  const fresh = await sessionReplacing(first);
  const retried = await attempt(headersFor(fresh));
  if (retried === SESSION_REJECTED)
    throw new CctvUnavailable("CCTV upstream rejected a fresh session");
  return retried;
}
