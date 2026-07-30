import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createRouteRegistry } from "../src/routes/index.js";
import { silentLogger } from "./helpers.js";
import { server } from "./setup.js";

const apiUrl = "https://api.github.com/repos/acme/widget/releases";

function createTestApp() {
  return createApp({
    registry: createRouteRegistry({ githubToken: undefined }),
    logger: silentLogger,
  });
}

describe("Feedlane application", () => {
  it.each([
    ["rss", "application/rss+xml; charset=utf-8"],
    ["atom", "application/atom+xml; charset=utf-8"],
    ["json", "application/feed+json; charset=utf-8"],
  ] as const)("returns the correct Content-Type for %s", async (format, contentType) => {
    server.use(http.get(apiUrl, () => HttpResponse.json([])));

    const response = await createTestApp().request(
      `https://feedlane.test/github/releases/acme/widget?format=${format}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(contentType);
  });

  it("defaults to RSS and applies Vercel CDN caching headers", async () => {
    server.use(http.get(apiUrl, () => HttpResponse.json([])));

    const response = await createTestApp().request(
      "https://feedlane.test/github/releases/acme/widget",
    );

    expect(response.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe(
      "public, s-maxage=600, stale-while-revalidate=86400",
    );
  });

  it("supports HEAD requests and conditional feed polling with ETags", async () => {
    server.use(http.get(apiUrl, () => HttpResponse.json([])));
    const app = createTestApp();
    const feedUrl = "https://feedlane.test/github/releases/acme/widget";

    const getResponse = await app.request(feedUrl);
    const responseEtag = getResponse.headers.get("etag");
    expect(getResponse.status).toBe(200);
    expect(responseEtag).toMatch(/^"[a-f0-9]+"$/);

    const headResponse = await app.request(feedUrl, { method: "HEAD" });
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(headResponse.headers.get("cache-control")).toBe("public, max-age=60");
    expect(headResponse.headers.get("etag")).toBe(responseEtag);
    await expect(headResponse.text()).resolves.toBe("");

    const conditionalResponse = await app.request(feedUrl, {
      headers: { "If-None-Match": responseEtag! },
    });
    expect(conditionalResponse.status).toBe(304);
    expect(conditionalResponse.headers.get("cache-control")).toBe("public, max-age=60");
    expect(conditionalResponse.headers.get("etag")).toBe(responseEtag);
    await expect(conditionalResponse.text()).resolves.toBe("");
  });

  it("uses the configured public origin and canonicalizes the feed URL", async () => {
    server.use(http.get(apiUrl, () => HttpResponse.json([])));
    const app = createApp({
      registry: createRouteRegistry({ githubToken: undefined }),
      logger: silentLogger,
      publicBaseUrl: "https://feeds.example.com",
    });

    const response = await app.request(
      "https://internal.example.test/github/releases/acme/widget?format=json",
    );
    const body = (await response.json()) as { feed_url: string };

    expect(response.status).toBe(200);
    expect(body.feed_url).toBe("https://feeds.example.com/github/releases/acme/widget?format=json");
  });

  it.each([
    "not-a-url",
    "ftp://feeds.example.com",
    "https://user:password@feeds.example.com",
    "https://feeds.example.com/path",
    "https://feeds.example.com/?debug=true",
  ])("rejects an invalid public base URL: %s", (publicBaseUrl) => {
    expect(() => createApp({ publicBaseUrl })).toThrow(TypeError);
  });

  it("treats an empty public base URL as unset", () => {
    expect(() => createApp({ publicBaseUrl: "" })).not.toThrow();
  });

  it.each(["/github/releases/-invalid/widget", "/github/releases/acme/bad%20repo"])(
    "rejects invalid route parameters: %s",
    async (path) => {
      const response = await createTestApp().request(`https://feedlane.test${path}`);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    },
  );

  it("rejects unsupported formats with a uniform uncached error", async () => {
    const response = await createTestApp().request(
      "https://feedlane.test/github/releases/acme/widget?format=xml",
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        requestId: expect.any(String),
      },
    });
  });

  it.each([
    ["an unknown parameter", "cacheBust=random-value"],
    ["an unknown parameter alongside format", "format=json&token=must-not-leak"],
    ["duplicate formats with different values", "format=json&format=atom"],
    ["duplicate formats with the same value", "format=rss&format=rss"],
  ])("rejects %s before calling the upstream service", async (_description, query) => {
    let upstreamCalls = 0;
    server.use(
      http.get(apiUrl, () => {
        upstreamCalls += 1;
        return HttpResponse.json([]);
      }),
    );

    const response = await createTestApp().request(
      `https://feedlane.test/github/releases/acme/widget?${query}`,
    );
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("private, no-store");
    expect(body).toContain("VALIDATION_ERROR");
    expect(body).not.toContain("must-not-leak");
    expect(upstreamCalls).toBe(0);
  });

  it("returns a sanitized error for unknown routes", async () => {
    const response = await createTestApp().request("https://feedlane.test/not-a-route");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ROUTE_NOT_FOUND" },
    });
  });
});
