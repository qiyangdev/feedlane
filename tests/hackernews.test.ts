import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { hackerNewsListsRoute } from "../src/routes/hackernews/lists.js";
import { createRouteTestApp } from "./route-test-app.js";
import { server } from "./setup.js";

const hackerNewsOrigin = "https://news.ycombinator.com";

const pageFixture = `<!doctype html>
<html lang="en">
  <body>
    <table class="itemlist">
      <tr class="athing" id="123">
        <td class="title"><span class="titleline"><a href="https://example.com/story?a=1&amp;b=2">A &amp; B &lt;launch&gt;</a></span></td>
      </tr>
      <tr>
        <td class="subtext">
          <span class="score">42 points</span> by <a class="hnuser" href="user?id=alice">alice</a>
          <span class="age" title="2026-07-30T00:00:00 1785369600"><a href="item?id=123">1 hour ago</a></span>
          | <a href="item?id=123">7 comments</a>
        </td>
      </tr>
      <tr class="spacer"></tr>
      <tr class="athing" id="456">
        <td class="title"><span class="titleline"><a href="javascript:alert(1)">Unsafe &lt;script&gt; title</a></span></td>
      </tr>
      <tr>
        <td class="subtext">
          <span class="age" title="2026-07-30T01:00:00 1785373200"><a href="item?id=456">5 minutes ago</a></span>
          | <a href="item?id=456">discuss</a>
        </td>
      </tr>
      <tr class="athing" id="not-a-number">
        <td class="title"><span class="titleline"><a href="https://invalid.example">Skipped row</a></span></td>
      </tr>
    </table>
  </body>
</html>`;

function createHackerNewsApp() {
  return createRouteTestApp(hackerNewsListsRoute);
}

describe("Hacker News lists route", () => {
  it("parses stories and safely renders HTML content", async () => {
    server.use(
      http.get(`${hackerNewsOrigin}/news`, ({ request }) => {
        expect(request.headers.get("accept")).toBe("text/html, application/xhtml+xml");
        expect(request.headers.get("user-agent")).toMatch(/^Feedlane\//);
        return HttpResponse.html(pageFixture);
      }),
    );

    const response = await createHackerNewsApp().request(
      "https://feedlane.test/hackernews/news?format=json",
    );
    const body = (await response.json()) as {
      title: string;
      items: Array<{
        id: string;
        url: string;
        title: string;
        content_html: string;
        author?: { name: string; url: string };
        tags: string[];
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.title).toBe("Hacker News");
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      id: "https://news.ycombinator.com/item?id=123",
      url: "https://example.com/story?a=1&b=2",
      title: "A & B <launch>",
      author: { name: "alice", url: "https://news.ycombinator.com/user?id=alice" },
      tags: ["news", "example.com"],
    });
    expect(body.items[0]?.content_html).toContain("A &amp; B &lt;launch&gt;");
    expect(body.items[0]?.content_html).toContain("42 points · by alice · 7 comments");
    expect(body.items[1]).toMatchObject({
      id: "https://news.ycombinator.com/item?id=456",
      url: "https://news.ycombinator.com/item?id=456",
      title: "Unsafe <script> title",
      tags: ["news", "news.ycombinator.com"],
    });
    expect(body.items[1]?.content_html).toContain("Unsafe &lt;script&gt; title");
    expect(body.items[1]?.content_html).not.toContain("javascript:");
  });

  it.each([
    ["newest", "Hacker News: New Links"],
    ["best", "Hacker News: Best Links"],
  ])("maps the %s list to its upstream page and feed title", async (list, title) => {
    server.use(http.get(`${hackerNewsOrigin}/${list}`, () => HttpResponse.html(pageFixture)));

    const response = await createHackerNewsApp().request(
      `https://feedlane.test/hackernews/${list}?format=json`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ title });
  });

  it("rejects unsupported lists before fetching upstream HTML", async () => {
    const response = await createHackerNewsApp().request(
      "https://feedlane.test/hackernews/popular",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it.each([
    ["an unexpected page", HttpResponse.html("<html><body>changed</body></html>")],
    ["a non-HTML response", HttpResponse.json({ stories: [] })],
  ])("maps %s to a sanitized upstream response error", async (_description, upstreamResponse) => {
    server.use(http.get(`${hackerNewsOrigin}/news`, () => upstreamResponse));

    const response = await createHackerNewsApp().request("https://feedlane.test/hackernews/news");

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UPSTREAM_RESPONSE_ERROR" },
    });
  });

  it("maps an upstream 404 without exposing the response body", async () => {
    server.use(
      http.get(`${hackerNewsOrigin}/news`, () =>
        HttpResponse.html("private upstream details", { status: 404 }),
      ),
    );

    const response = await createHackerNewsApp().request("https://feedlane.test/hackernews/news");
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain("UPSTREAM_NOT_FOUND");
    expect(body).not.toContain("private upstream details");
  });
});
