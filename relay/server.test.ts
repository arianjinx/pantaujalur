import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import { createRelay, STREAM_FILE } from "./server";

const SECRET = "s".repeat(64);
const realFetch = globalThis.fetch;
let upstreamRequests: Request[] = [];

globalThis.fetch = mock(
  async (input: string | URL | Request, init?: RequestInit) => {
    upstreamRequests.push(new Request(input, init));
    return new Response("upstream body", {
      status: 200,
      headers: [
        ["Content-Type", "text/html"],
        ["Server", "nginx"],
        ["Last-Modified", "Wed, 18 Nov 2026 08:28:08 GMT"],
        ["Set-Cookie", "ci_session=c1; Path=/"],
        ["Set-Cookie", "NANCY_TOKEN_W=t1; Path=/"],
      ],
    });
  },
) as unknown as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  upstreamRequests = [];
});

const relay = createRelay(SECRET);
const send = (path: string, init: RequestInit = {}, secret = SECRET) =>
  relay(
    new Request(`http://relay:8080${path}`, {
      ...init,
      headers: { ...init.headers, "x-relay-secret": secret },
    }),
  );

describe("relay", () => {
  test("answers /healthz without the secret", async () => {
    const response = await relay(new Request("http://relay:8080/healthz"));
    expect(response.status).toBe(200);
  });

  test("refuses a request with a missing or wrong secret", async () => {
    const missing = await relay(new Request("http://relay:8080/sebaran-cctv"));
    const wrong = await send("/sebaran-cctv", {}, "x".repeat(64));
    expect([missing.status, wrong.status]).toEqual([401, 401]);
    expect(upstreamRequests).toHaveLength(0);
  });

  test.each([
    ["GET", "/"],
    ["POST", "/sebaran-cctv"],
    ["GET", "/api/v2/get-cameras"],
    ["GET", "/cctv-stream/streams/index.html"],
    ["GET", "/cctv-stream/streams/12/34.ts"],
    ["GET", "/cctv-stream/streams/../../etc/passwd"],
  ])("answers 404 for %s %s", async (method, path) => {
    const response = await send(path, { method });
    expect(response.status).toBe(404);
    expect(upstreamRequests).toHaveLength(0);
  });

  test("forwards only the session headers and returns the status, type, date and every cookie", async () => {
    const response = await send("/sebaran-cctv?x=1", {
      headers: {
        "User-Agent": "Chrome/130",
        Referer: "https://cctv.malangkota.go.id/sebaran-cctv",
        Cookie: "a=b",
        Authorization: "Bearer leak",
      },
    });
    const [forwarded] = upstreamRequests;
    expect(forwarded?.url).toBe("https://cctv.malangkota.go.id/sebaran-cctv");
    expect([...(forwarded?.headers.keys() ?? [])].sort()).toEqual([
      "cookie",
      "referer",
      "user-agent",
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(response.headers.get("Last-Modified")).toBe(
      "Wed, 18 Nov 2026 08:28:08 GMT",
    );
    expect(response.headers.getSetCookie()).toEqual([
      "ci_session=c1; Path=/",
      "NANCY_TOKEN_W=t1; Path=/",
    ]);
    expect(response.headers.get("Server")).toBeNull();
    expect(await response.text()).toBe("upstream body");
  });

  test("forwards the camera list form with its content type", async () => {
    const form = new FormData();
    form.set("m_kecamatan_id", "99");
    const body = new Request("http://x", { method: "POST", body: form });
    await send("/api/v2/get-cameras", {
      method: "POST",
      headers: { "Content-Type": body.headers.get("Content-Type") ?? "" },
      body: await body.arrayBuffer(),
    });
    const [forwarded] = upstreamRequests;
    expect(forwarded?.method).toBe("POST");
    expect((await forwarded?.formData())?.get("m_kecamatan_id")).toBe("99");
  });

  test("forwards a playlist and a segment", async () => {
    await send("/cctv-stream/streams/1234.m3u8");
    await send("/cctv-stream/streams/1234_0p0870.ts");
    expect(upstreamRequests.map((r) => r.url)).toEqual([
      "https://cctv.malangkota.go.id/cctv-stream/streams/1234.m3u8",
      "https://cctv.malangkota.go.id/cctv-stream/streams/1234_0p0870.ts",
    ]);
  });

  test("accepts the same stream names as the app's stream proxy", async () => {
    const route = await Bun.file(
      new URL("../src/routes/api/stream/$file.ts", import.meta.url),
    ).text();
    expect(route).toContain(`const STREAM_FILE = ${STREAM_FILE};`);
  });
});
