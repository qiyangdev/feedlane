import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createRouteRegistry } from "../src/routes/index.js";
import { silentLogger } from "./helpers.js";
import { server } from "./setup.js";

const apiUrl = "https://api.github.com/repos/acme/widget/commits";

function createGithubApp(githubToken: string | undefined = undefined) {
  return createApp({ registry: createRouteRegistry({ githubToken }), logger: silentLogger });
}

const linkedAuthorCommit = {
  sha: "0123456789abcdef0123456789abcdef01234567",
  html_url: "https://github.com/acme/widget/commit/0123456789abcdef0123456789abcdef01234567",
  commit: {
    message: "Add <fast> feeds & caching\n\nThis is the full commit message.",
    author: {
      name: "Ada Lovelace",
      email: "ada@example.com",
      date: "2026-07-29T09:00:00Z",
    },
    committer: {
      name: "GitHub",
      email: "noreply@github.com",
      date: "2026-07-29T09:01:00Z",
    },
  },
  author: {
    login: "ada",
    html_url: "https://github.com/ada",
  },
};

describe("GitHub commits route", () => {
  it("converts default-branch commits and preserves linked and Git authors", async () => {
    server.use(
      http.get(apiUrl, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("per_page")).toBe("30");
        expect(url.searchParams.has("sha")).toBe(false);
        expect(request.headers.get("user-agent")).toMatch(/^Feedlane\//);
        expect(request.headers.get("accept")).toBe("application/vnd.github+json");
        expect(request.headers.get("authorization")).toBe("Bearer github-secret");
        expect(request.headers.get("x-github-api-version")).toBe("2026-03-10");

        return HttpResponse.json([
          linkedAuthorCommit,
          {
            ...linkedAuthorCommit,
            sha: "fedcba9876543210fedcba9876543210fedcba98",
            html_url:
              "https://github.com/acme/widget/commit/fedcba9876543210fedcba9876543210fedcba98",
            commit: {
              message: "Document reader setup",
              author: {
                name: "Grace Hopper",
                email: "grace@example.com",
                date: "2026-07-28T08:00:00Z",
              },
              committer: null,
            },
            author: null,
          },
        ]);
      }),
    );

    const response = await createGithubApp("github-secret").request(
      "https://feedlane.test/github/commits/acme/widget?format=json",
    );
    const body = (await response.json()) as {
      title: string;
      home_page_url: string;
      items: Array<{
        id: string;
        title: string;
        content_html: string;
        author?: { name: string; url?: string };
        tags: string[];
      }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/feed+json; charset=utf-8");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=86400",
    );
    expect(body).toMatchObject({
      title: "acme/widget commits",
      home_page_url: "https://github.com/acme/widget/commits",
    });
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      id: linkedAuthorCommit.html_url,
      title: "Add <fast> feeds & caching",
      author: { name: "ada", url: "https://github.com/ada" },
      tags: ["commit"],
    });
    expect(body.items[0]?.content_html).toContain(
      "Add &lt;fast&gt; feeds &amp; caching\n\nThis is the full commit message.",
    );
    expect(body.items[1]).toMatchObject({
      title: "Document reader setup",
      author: { name: "Grace Hopper" },
    });
  });

  it("uses the short SHA when a commit message has no title", async () => {
    server.use(
      http.get(apiUrl, () =>
        HttpResponse.json([
          { ...linkedAuthorCommit, commit: { ...linkedAuthorCommit.commit, message: "" } },
        ]),
      ),
    );

    const response = await createGithubApp().request(
      "https://feedlane.test/github/commits/acme/widget?format=json",
    );
    const body = (await response.json()) as { items: Array<{ title: string }> };

    expect(response.status).toBe(200);
    expect(body.items[0]?.title).toBe("0123456789ab");
  });

  it("rejects commits without an author or committer timestamp", async () => {
    server.use(
      http.get(apiUrl, () =>
        HttpResponse.json([
          {
            ...linkedAuthorCommit,
            commit: { ...linkedAuthorCommit.commit, author: null, committer: null },
          },
        ]),
      ),
    );

    const response = await createGithubApp().request(
      "https://feedlane.test/github/commits/acme/widget",
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UPSTREAM_RESPONSE_ERROR" },
    });
  });

  it("maps GitHub 404 responses", async () => {
    server.use(
      http.get(apiUrl, () => HttpResponse.json({ message: "Not Found" }, { status: 404 })),
    );

    const response = await createGithubApp().request(
      "https://feedlane.test/github/commits/acme/widget",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UPSTREAM_NOT_FOUND" },
    });
  });
});
