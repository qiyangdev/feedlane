import { describe, expect, it, vi } from "vitest";

import {
  UpstreamNotFoundError,
  UpstreamRateLimitError,
  UpstreamResponseError,
  ValidationError,
} from "../src/core/errors.js";
import { HttpFetcher } from "../src/core/fetcher.js";

const targetUrl = "https://api.example.test/resources";
const allowedHosts = ["api.example.test"];

function response(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Response(body, { ...init, headers });
}

function mockFetch(handler: (input: URL, init: RequestInit) => Promise<Response>) {
  return vi.fn(handler) as unknown as typeof globalThis.fetch & {
    mock: { calls: unknown[][] };
  };
}

describe("HttpFetcher", () => {
  it("sends the expected request contract without following redirects", async () => {
    const fetch = mockFetch(async () => response('{"ok":true}'));
    const fetcher = new HttpFetcher({ fetch });

    await expect(
      fetcher.json(targetUrl, {
        allowedHosts,
        accept: "application/vnd.example+json",
        token: "secret-token",
        additionalHeaders: { "X-Api-Version": "2026-01-01" },
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(url.toString()).toBe(targetUrl);
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(headers.get("accept")).toBe("application/vnd.example+json");
    expect(headers.get("authorization")).toBe("Bearer secret-token");
    expect(headers.get("user-agent")).toBe("Feedlane/0.1 (+https://github.com/qiyangdev/feedlane)");
    expect(headers.get("x-api-version")).toBe("2026-01-01");
  });

  it.each([
    ["an invalid URL", "not a URL"],
    ["plain HTTP", "http://api.example.test/resources"],
    ["an unlisted hostname", "https://evil.example.test/resources"],
    ["credentials", "https://user:password@api.example.test/resources"],
    ["a nonstandard port", "https://api.example.test:8443/resources"],
  ])("rejects %s before making a request", async (_description, url) => {
    const fetch = mockFetch(async () => response("{}"));
    const fetcher = new HttpFetcher({ fetch });

    await expect(fetcher.json(url, { allowedHosts })).rejects.toBeInstanceOf(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("matches allowed hosts exactly and case-insensitively", async () => {
    const fetch = mockFetch(async () => response("{}"));
    const fetcher = new HttpFetcher({ fetch });

    await expect(
      fetcher.json("https://API.EXAMPLE.TEST/resources", { allowedHosts }),
    ).resolves.toEqual({});
  });

  it.each([
    ["timeout", { timeoutMs: 0 }],
    ["response limit", { maxResponseBytes: -1 }],
  ])("rejects an invalid %s", async (_description, limits) => {
    const fetch = mockFetch(async () => response("{}"));
    const fetcher = new HttpFetcher({ fetch });

    await expect(fetcher.json(targetUrl, { allowedHosts, ...limits })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["Accept", "Authorization", "Host", "User-Agent"])(
    "prevents routes from overriding the %s header",
    async (name) => {
      const fetch = mockFetch(async () => response("{}"));
      const fetcher = new HttpFetcher({ fetch });

      await expect(
        fetcher.json(targetUrl, {
          allowedHosts,
          additionalHeaders: { [name]: "unsafe" },
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("accepts structured JSON media types", async () => {
    const fetch = mockFetch(async () =>
      response('{"problem":"none"}', {
        headers: { "content-type": "application/problem+json; charset=utf-8" },
      }),
    );

    await expect(new HttpFetcher({ fetch }).json(targetUrl, { allowedHosts })).resolves.toEqual({
      problem: "none",
    });
  });

  it.each(["text/html; charset=utf-8", "application/xhtml+xml"])(
    "accepts the HTML media type %s",
    async (contentType) => {
      const fetch = mockFetch(async (_url, init) => {
        expect(new Headers(init.headers).get("accept")).toBe("text/html, application/xhtml+xml");
        return response("<html><body>ok</body></html>", {
          headers: { "content-type": contentType },
        });
      });

      await expect(new HttpFetcher({ fetch }).html(targetUrl, { allowedHosts })).resolves.toContain(
        "<body>ok</body>",
      );
    },
  );

  it("rejects a non-HTML text response", async () => {
    const fetch = mockFetch(async () => response('{"ok":true}'));

    await expect(new HttpFetcher({ fetch }).html(targetUrl, { allowedHosts })).rejects.toThrow(
      "did not return HTML",
    );
  });

  it.each([
    [404, {}, UpstreamNotFoundError],
    [429, {}, UpstreamRateLimitError],
    [403, { "x-ratelimit-remaining": "0" }, UpstreamRateLimitError],
    [403, { "x-ratelimit-remaining": "1" }, UpstreamResponseError],
    [500, {}, UpstreamResponseError],
    [301, { location: "https://api.example.test/elsewhere" }, UpstreamResponseError],
  ])("maps HTTP %i to a sanitized error", async (status, headers, ErrorType) => {
    const fetch = mockFetch(async () =>
      response('{"secret":"must not leak"}', { status, headers }),
    );

    const promise = new HttpFetcher({ fetch }).json(targetUrl, { allowedHosts });
    await expect(promise).rejects.toBeInstanceOf(ErrorType);
    await expect(promise).rejects.not.toThrow("must not leak");
  });

  it("classifies an error response without reading its body", async () => {
    let bodyCancelled = false;
    const fetch = mockFetch(async () =>
      response(
        new ReadableStream({
          pull() {
            throw new Error("the error body must not be read");
          },
          cancel() {
            bodyCancelled = true;
          },
        }),
        {
          status: 404,
          headers: { "content-length": "9999999" },
        },
      ),
    );

    await expect(
      new HttpFetcher({ fetch }).json(targetUrl, { allowedHosts, maxResponseBytes: 10 }),
    ).rejects.toBeInstanceOf(UpstreamNotFoundError);
    expect(bodyCancelled).toBe(true);
  });

  it("rejects a declared response that is too large", async () => {
    const fetch = mockFetch(async () => response("{}", { headers: { "content-length": "100" } }));

    await expect(
      new HttpFetcher({ fetch }).json(targetUrl, {
        allowedHosts,
        maxResponseBytes: 10,
      }),
    ).rejects.toThrow("exceeded the size limit");
  });

  it("stops reading an undeclared response that exceeds the limit", async () => {
    const fetch = mockFetch(async () => response("12345"));

    await expect(
      new HttpFetcher({ fetch }).json(targetUrl, {
        allowedHosts,
        maxResponseBytes: 4,
      }),
    ).rejects.toThrow("exceeded the size limit");
  });

  it("maps response stream failures to a sanitized upstream error", async () => {
    const fetch = mockFetch(async () =>
      response(
        new ReadableStream({
          pull(controller) {
            controller.error(new Error("private socket details"));
          },
        }),
      ),
    );

    const promise = new HttpFetcher({ fetch }).json(targetUrl, { allowedHosts });

    await expect(promise).rejects.toBeInstanceOf(UpstreamResponseError);
    await expect(promise).rejects.toThrow("could not be read");
    await expect(promise).rejects.not.toThrow("private socket details");
  });

  it("maps a timeout while reading the response stream", async () => {
    const fetch = mockFetch(async (_url, init) => {
      const signal = init.signal as AbortSignal;
      return response(
        new ReadableStream({
          start(controller) {
            signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
          },
        }),
      );
    });

    await expect(
      new HttpFetcher({ fetch }).json(targetUrl, { allowedHosts, timeoutMs: 1 }),
    ).rejects.toThrow("timed out");
  });

  it.each([
    ["a non-JSON response", response("hello", { headers: { "content-type": "text/plain" } })],
    ["malformed JSON", response("not-json")],
  ])("rejects %s", async (_description, upstreamResponse) => {
    const fetch = mockFetch(async () => upstreamResponse);

    await expect(
      new HttpFetcher({ fetch }).json(targetUrl, { allowedHosts }),
    ).rejects.toBeInstanceOf(UpstreamResponseError);
  });

  it.each([
    [new DOMException("timed out", "TimeoutError"), "timed out"],
    [new TypeError("socket details"), "could not be reached"],
  ])("sanitizes transport failures", async (failure, expectedMessage) => {
    const fetch = mockFetch(async () => {
      throw failure;
    });

    await expect(new HttpFetcher({ fetch }).json(targetUrl, { allowedHosts })).rejects.toThrow(
      expectedMessage,
    );
  });
});
