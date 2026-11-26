import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

import {
  cctvFetch,
  cctvUnavailableResponse,
  SESSION_REJECTED,
  withCctvSession,
} from "./cctv-session";

const realFetch = globalThis.fetch;
let sessionsOpened = 0;
let mapPageBlocked = false;
const requests: Request[] = [];

globalThis.fetch = mock(
  async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    if (!request.url.endsWith("/sebaran-cctv")) return new Response("ok");
    if (mapPageBlocked)
      return new Response("Forbidden", {
        status: 403,
        headers: { Server: "nginx" },
      });
    sessionsOpened += 1;
    return new Response("<html></html>", {
      headers: [
        ["Set-Cookie", `ci_session=c${sessionsOpened}; Path=/; HttpOnly`],
        [
          "Set-Cookie",
          `NANCY_TOKEN_W=t${sessionsOpened}; Max-Age=3600; Path=/`,
        ],
      ],
    });
  },
) as unknown as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

function acceptOnly(token: string) {
  return async (headers: Record<string, string>) =>
    headers.Cookie.includes(`NANCY_TOKEN_W=${token}`)
      ? headers
      : SESSION_REJECTED;
}

describe("withCctvSession", () => {
  test("sends the session cookies with a browser User-Agent and the map page as Referer", async () => {
    const headers = await withCctvSession(acceptOnly("t1"));
    expect(headers.Cookie).toBe("ci_session=c1; NANCY_TOKEN_W=t1");
    expect(headers["User-Agent"]).toContain("Chrome/");
    expect(headers.Referer).toBe("https://cctv.malangkota.go.id/sebaran-cctv");
  });

  test("reuses one session across requests", async () => {
    await withCctvSession(acceptOnly("t1"));
    await withCctvSession(acceptOnly("t1"));
    expect(sessionsOpened).toBe(1);
  });

  test("opens a new session and retries once when upstream rejects the current one", async () => {
    const headers = await withCctvSession(acceptOnly("t2"));
    expect(headers.Cookie).toContain("NANCY_TOKEN_W=t2");
    expect(sessionsOpened).toBe(2);
  });

  test("concurrent rejections each retry with a session upstream accepts", async () => {
    const acceptAnyButT2 = async (headers: Record<string, string>) =>
      headers.Cookie.includes("NANCY_TOKEN_W=t2") ? SESSION_REJECTED : headers;
    const results = await Promise.all(
      [1, 2, 3].map(() => withCctvSession(acceptAnyButT2)),
    );
    expect(results.some((h) => h.Cookie.includes("NANCY_TOKEN_W=t2"))).toBe(
      false,
    );
  });

  test("fails when upstream also rejects the fresh session", async () => {
    await expect(withCctvSession(async () => SESSION_REJECTED)).rejects.toThrow(
      "rejected a fresh session",
    );
  });

  test("answers 502 naming the upstream status when the map page refuses a new session", async () => {
    mapPageBlocked = true;
    const response = await withCctvSession(async () => SESSION_REJECTED).then(
      () => new Response("unexpected success"),
      cctvUnavailableResponse,
    );
    mapPageBlocked = false;
    expect(response.status).toBe(502);
    expect(await response.text()).toBe(
      "Could not open a CCTV session: HTTP 403, server nginx, no cookies",
    );
  });
});

describe("cctvFetch", () => {
  beforeEach(() => {
    requests.length = 0;
  });
  afterEach(() => {
    delete process.env.CCTV_UPSTREAM_URL;
    delete process.env.CCTV_RELAY_SECRET;
  });

  test("calls the city directly with no relay secret when no relay is configured", async () => {
    process.env.CCTV_RELAY_SECRET = "relay-key";
    await cctvFetch("/cctv-stream/streams/1234.m3u8", {
      headers: { Referer: "https://cctv.malangkota.go.id/sebaran-cctv" },
    });
    const [request] = requests;
    expect(request?.url).toBe(
      "https://cctv.malangkota.go.id/cctv-stream/streams/1234.m3u8",
    );
    expect(request?.headers.get("x-relay-secret")).toBeNull();
  });

  test("calls the relay with its secret and keeps the caller's headers and body", async () => {
    process.env.CCTV_UPSTREAM_URL = "https://relay.example";
    process.env.CCTV_RELAY_SECRET = "relay-key";
    const form = new FormData();
    form.set("m_kecamatan_id", "99");
    await cctvFetch("/api/v2/get-cameras", {
      method: "POST",
      headers: { Cookie: "NANCY_TOKEN_W=t1" },
      body: form,
    });
    const [request] = requests;
    expect(request?.url).toBe("https://relay.example/api/v2/get-cameras");
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("x-relay-secret")).toBe("relay-key");
    expect(request?.headers.get("Cookie")).toBe("NANCY_TOKEN_W=t1");
    expect((await request?.formData())?.get("m_kecamatan_id")).toBe("99");
  });

  test("refuses a relay without a secret", async () => {
    process.env.CCTV_UPSTREAM_URL = "https://relay.example";
    await expect(cctvFetch("/sebaran-cctv")).rejects.toThrow(
      "CCTV_UPSTREAM_URL is set without CCTV_RELAY_SECRET",
    );
    expect(requests).toHaveLength(0);
  });
});
