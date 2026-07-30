import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { server } from "./setup.js";

const apiUrl = "https://api.github.com/repos/acme/widget/releases";

const stableRelease = {
  id: 101,
  html_url: "https://github.com/acme/widget/releases/tag/v1.0.0",
  tag_name: "v1.0.0",
  name: "Version 1.0 & ready",
  body: "Fixes <bugs> & improves speed.",
  draft: false,
  prerelease: false,
  created_at: "2026-01-01T00:00:00Z",
  published_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-03T00:00:00Z",
  author: {
    login: "octocat",
    html_url: "https://github.com/octocat",
  },
};

describe("GitHub releases route", () => {
  it("converts releases, excludes drafts, and retains prerelease metadata", async () => {
    server.use(
      http.get(apiUrl, ({ request }) => {
        expect(request.headers.get("user-agent")).toMatch(/^Feedlane\//);
        expect(request.headers.get("accept")).toBe("application/vnd.github+json");
        expect(request.headers.get("authorization")).toBe("Bearer github-secret");
        return HttpResponse.json([
          stableRelease,
          {
            ...stableRelease,
            id: 102,
            html_url: "https://github.com/acme/widget/releases/tag/v2.0.0-beta.1",
            tag_name: "v2.0.0-beta.1",
            name: null,
            prerelease: true,
          },
          { ...stableRelease, id: 103, tag_name: "v3.0.0-draft", draft: true },
        ]);
      }),
    );
    const app = createApp({ environment: { githubToken: "github-secret" } });

    const response = await app.request(
      "https://feedlane.test/github/releases/acme/widget?format=json",
    );
    const body = (await response.json()) as {
      items: Array<{ id: string; title: string; tags: string[]; content_html: string }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/feed+json; charset=utf-8");
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      id: "https://github.com/acme/widget/releases/tag/v1.0.0",
      title: "Version 1.0 & ready",
    });
    expect(body.items[0]?.content_html).toContain("Fixes &lt;bugs&gt; &amp; improves speed.");
    expect(body.items[1]).toMatchObject({
      id: "https://github.com/acme/widget/releases/tag/v2.0.0-beta.1",
      title: "v2.0.0-beta.1",
      tags: ["prerelease", "v2.0.0-beta.1"],
    });
  });

  it("maps GitHub 404 responses", async () => {
    server.use(
      http.get(apiUrl, () => HttpResponse.json({ message: "Not Found" }, { status: 404 })),
    );

    const response = await createApp().request("https://feedlane.test/github/releases/acme/widget");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UPSTREAM_NOT_FOUND" },
    });
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("private, no-store");
  });

  it("maps GitHub rate limits without exposing a token in errors or logs", async () => {
    const token = "top-secret-github-token";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    server.use(
      http.get(apiUrl, () =>
        HttpResponse.json(
          { message: `API rate limit exceeded for ${token}` },
          { status: 403, headers: { "x-ratelimit-remaining": "0" } },
        ),
      ),
    );

    const response = await createApp({ environment: { githubToken: token } }).request(
      "https://feedlane.test/github/releases/acme/widget",
    );
    const body = await response.text();

    expect(response.status).toBe(429);
    expect(body).toContain("UPSTREAM_RATE_LIMITED");
    expect(body).not.toContain(token);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
