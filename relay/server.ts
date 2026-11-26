import { createHash, timingSafeEqual } from "node:crypto";

const CITY_ORIGIN = "https://cctv.malangkota.go.id";
const STREAM_PREFIX = "/cctv-stream/streams/";

export const STREAM_FILE = /^\d{1,40}(?:_[0-9p]{1,20})?\.(?:m3u8|ts)$/;
const FORWARDED_HEADERS = ["Cookie", "User-Agent", "Referer", "Content-Type"];

const RETURNED_HEADERS = ["Content-Type", "Last-Modified"];
const UPSTREAM_TIMEOUT_MS = 15_000;

function isAllowed(method: string, path: string): boolean {
  if (path === "/sebaran-cctv") return method === "GET";
  if (path === "/api/v2/get-cameras") return method === "POST";
  return (
    method === "GET" &&
    path.startsWith(STREAM_PREFIX) &&
    STREAM_FILE.test(path.slice(STREAM_PREFIX.length))
  );
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export function createRelay(secret: string) {
  const expected = digest(secret);
  const authorized = (request: Request) =>
    timingSafeEqual(
      digest(request.headers.get("x-relay-secret") ?? ""),
      expected,
    );

  async function respond(request: Request, path: string): Promise<Response> {
    if (request.method === "GET" && path === "/healthz")
      return new Response("ok\n");
    if (!authorized(request))
      return new Response("Unauthorized\n", { status: 401 });
    if (!isAllowed(request.method, path))
      return new Response("Not found\n", { status: 404 });

    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    let upstream: Response;
    try {
      upstream = await fetch(`${CITY_ORIGIN}${path}`, {
        method: request.method,
        headers,
        body: request.method === "POST" ? await request.arrayBuffer() : null,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut =
        error instanceof DOMException && error.name === "TimeoutError";
      return new Response(
        timedOut ? "Upstream timed out\n" : "Upstream unreachable\n",
        { status: timedOut ? 504 : 502 },
      );
    }

    const returned = new Headers({ "Cache-Control": "no-store" });
    for (const name of RETURNED_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) returned.set(name, value);
    }
    for (const cookie of upstream.headers.getSetCookie())
      returned.append("Set-Cookie", cookie);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: returned,
    });
  }

  return async function handle(request: Request): Promise<Response> {
    const started = performance.now();
    const path = new URL(request.url).pathname;
    const response = await respond(request, path);
    console.log(
      `${request.method} ${path.slice(0, 200)} ${response.status} ${Math.round(performance.now() - started)}ms`,
    );
    return response;
  };
}

if (import.meta.main) {
  const secret = process.env.CCTV_RELAY_SECRET ?? "";
  if (secret.length < 32) {
    console.error("CCTV_RELAY_SECRET must be set to at least 32 characters");
    process.exit(1);
  }
  const server = Bun.serve({
    port: Number(process.env.PORT ?? 8080),

    idleTimeout: 30,
    fetch: createRelay(secret),
  });
  console.log(`relay listening on ${server.port}`);
}
