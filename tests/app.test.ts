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
      "public, s-maxage=600, stale-while-revalidate=86400, stale-if-error=604800",
    );
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

  it("returns a sanitized error for unknown routes", async () => {
    const response = await createTestApp().request("https://feedlane.test/not-a-route");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ROUTE_NOT_FOUND" },
    });
  });
});
