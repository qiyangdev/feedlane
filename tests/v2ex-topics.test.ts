import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { v2exTopicsRoute } from "../src/routes/v2ex/topics.js";
import { createRouteTestApp } from "./route-test-app.js";
import { server } from "./setup.js";

const v2exOrigin = "https://www.v2ex.com";

const pageFixture = `<!doctype html>
<html lang="zh-CN">
  <body>
    <div class="cell item">
      <table><tr>
        <td>
          <span class="item_title"><a href="/t/123#reply42" class="topic-link">A &amp; B &lt;launch&gt;</a></span>
          <span class="topic_info">
            <a class="node" href="/go/qna">问与答</a>
            <strong><a href="/member/alice">alice</a></strong>
            <span title="2026-07-30 17:05:28 +08:00">Just Now</span>
            Lastly replied by <strong><a href="/member/bob">bob</a></strong>
          </span>
        </td>
        <td><a href="/t/123#reply42" class="count_livid">42</a></td>
      </tr></table>
    </div>
    <div class="cell item">
      <table><tr>
        <td>
          <span class="item_title"><a href="/t/456" class="topic-link">Second topic</a></span>
          <span class="topic_info">
            <a class="node" href="/go/programmer">程序员</a>
            <strong><a href="/member/dev_2">dev_2</a></strong>
            <span title="2026-07-30 08:00:00 +00:00">1 hour ago</span>
          </span>
        </td>
        <td><a href="/t/456#reply1" class="count_orange">1</a></td>
      </tr></table>
    </div>
    <div class="cell item">
      <span class="item_title"><a href="https://evil.example/t/789" class="topic-link">Skipped topic</a></span>
      <span class="topic_info">
        <a class="node" href="/go/qna">问与答</a>
        <strong><a href="/member/mallory">mallory</a></strong>
        <span title="not-a-date">Now</span>
      </span>
    </div>
  </body>
</html>`;

function detailFixture(input: {
  id: string;
  title: string;
  publishedAt: string;
  content?: string;
}) {
  return `<!doctype html>
    <html lang="zh-CN">
      <head><title>${input.title}</title></head>
      <body>
        <div class="box">
          <div class="header">
            <h1>${input.title}</h1>
            <div id="topic_${input.id}_votes"></div>
            <small class="gray"><a href="/member/alice">alice</a> · <span title="${input.publishedAt}">earlier</span></small>
          </div>
          <div class="cell">
            <div class="topic_content"><div class="markdown_body">${
              input.content ?? `<p>Original content for topic ${input.id}.</p>`
            }</div></div>
          </div>
        </div>
      </body>
    </html>`;
}

function generatedListFixture(count: number) {
  const rows = Array.from({ length: count }, (_value, index) => {
    const id = String(1000 + index);
    return `<div class="cell item">
      <span class="item_title"><a href="/t/${id}#reply${index}" class="topic-link">Topic ${id}</a></span>
      <span class="topic_info">
        <a class="node" href="/go/qna">问与答</a>
        <strong><a href="/member/author${index}">author${index}</a></strong>
        <span title="2026-07-30 17:05:28 +08:00">Now</span>
      </span>
      <a href="/t/${id}#reply${index}" class="count_livid">${index}</a>
    </div>`;
  });
  return `<html><body>${rows.join("")}</body></html>`;
}

function createV2exApp() {
  return createRouteTestApp(v2exTopicsRoute);
}

describe("V2EX topics route", () => {
  it("converts the hot tab into safe feed items", async () => {
    server.use(
      http.get(`${v2exOrigin}/`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("tab")).toBe("hot");
        expect(request.headers.get("accept")).toBe("text/html, application/xhtml+xml");
        expect(request.headers.get("user-agent")).toMatch(/^Feedlane\//);
        return HttpResponse.html(pageFixture);
      }),
      http.get(`${v2exOrigin}/t/:id`, ({ params }) => {
        const id = String(params.id);
        return HttpResponse.html(
          detailFixture({
            id,
            title: id === "123" ? "A &amp; B &lt;launch&gt;" : "Second topic",
            publishedAt: id === "123" ? "2026-07-30 08:00:00 +08:00" : "2026-07-30 07:00:00 +00:00",
            ...(id === "123"
              ? {
                  content:
                    '<p onclick="alert(1)">Full <strong>original</strong> body. <a href="/go/qna">Node</a> <a href="javascript:alert(1)">unsafe text</a><img src="/static/topic.png" onerror="alert(1)"></p><script>alert(1)</script>',
                }
              : {}),
          }),
        );
      }),
    );

    const response = await createV2exApp().request(
      "https://feedlane.test/v2ex/topics/hot?format=json",
    );
    const body = (await response.json()) as {
      title: string;
      home_page_url: string;
      items: Array<{
        id: string;
        url: string;
        title: string;
        content_html: string;
        date_published: string;
        date_modified: string;
        author?: { name: string; url: string };
        tags: string[];
      }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("vercel-cdn-cache-control")).toContain("s-maxage=600");
    expect(body.title).toBe("V2EX: Hot Topics");
    expect(body.home_page_url).toBe("https://www.v2ex.com/?tab=hot");
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      id: "https://www.v2ex.com/t/123",
      url: "https://www.v2ex.com/t/123",
      title: "A & B <launch>",
      date_published: "2026-07-30T00:00:00.000Z",
      date_modified: "2026-07-30T09:05:28.000Z",
      author: { name: "alice", url: "https://www.v2ex.com/member/alice" },
      tags: ["hot", "问与答"],
    });
    expect(body.items[0]?.content_html).toContain("Full <strong>original</strong> body.");
    expect(body.items[0]?.content_html).toContain('href="https://www.v2ex.com/go/qna"');
    expect(body.items[0]?.content_html).toContain('src="https://www.v2ex.com/static/topic.png"');
    expect(body.items[0]?.content_html).toContain("42 replies");
    expect(body.items[0]?.content_html).toContain("unsafe text");
    expect(body.items[0]?.content_html).not.toMatch(/onclick|onerror|javascript:|<script/i);
    expect(body.items[1]?.content_html).toContain("Original content for topic 456.");
    expect(body.items[1]?.content_html).toContain("1 reply");
  });

  it("falls back to summary content when one detail page fails", async () => {
    server.use(
      http.get(`${v2exOrigin}/`, () => HttpResponse.html(pageFixture)),
      http.get(`${v2exOrigin}/t/123`, () => HttpResponse.html("unavailable", { status: 500 })),
      http.get(`${v2exOrigin}/t/456`, () =>
        HttpResponse.html(
          detailFixture({
            id: "456",
            title: "Second topic",
            publishedAt: "2026-07-30 07:00:00 +00:00",
          }),
        ),
      ),
    );

    const response = await createV2exApp().request(
      "https://feedlane.test/v2ex/topics/hot?format=json",
    );
    const body = (await response.json()) as { items: Array<{ content_html: string }> };

    expect(response.status).toBe(200);
    expect(body.items[0]?.content_html).toContain("A &amp; B &lt;launch&gt;");
    expect(body.items[0]?.content_html).not.toContain("Full <strong>original</strong> body.");
    expect(body.items[1]?.content_html).toContain("Original content for topic 456.");
  });

  it("fails when no topic details can be enriched", async () => {
    server.use(
      http.get(`${v2exOrigin}/`, () => HttpResponse.html(pageFixture)),
      http.get(`${v2exOrigin}/t/:id`, () => HttpResponse.html("unavailable", { status: 500 })),
    );

    const response = await createV2exApp().request("https://feedlane.test/v2ex/topics/hot");

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UPSTREAM_RESPONSE_ERROR" },
    });
  });

  it("does not let Defuddle fall back to unrelated page content", async () => {
    server.use(
      http.get(`${v2exOrigin}/`, () => HttpResponse.html(pageFixture)),
      http.get(`${v2exOrigin}/t/:id`, ({ params }) => {
        const id = String(params.id);
        return HttpResponse.html(`
          <html><body>
            <div id="topic_${id}_votes"></div>
            <div class="header"><small class="gray"><span title="2026-07-30 08:00:00 +08:00">earlier</span></small></div>
            <main><p>Unrelated page content that must not become the topic body.</p></main>
          </body></html>`);
      }),
    );

    const response = await createV2exApp().request("https://feedlane.test/v2ex/topics/hot");

    expect(response.status).toBe(502);
  });

  it("limits full-content enrichment and detail request concurrency", async () => {
    let detailCalls = 0;
    let activeRequests = 0;
    let maxActiveRequests = 0;
    server.use(
      http.get(`${v2exOrigin}/`, () => HttpResponse.html(generatedListFixture(11))),
      http.get(`${v2exOrigin}/t/:id`, async ({ params }) => {
        detailCalls += 1;
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeRequests -= 1;
        const id = String(params.id);
        return HttpResponse.html(
          detailFixture({
            id,
            title: `Topic ${id}`,
            publishedAt: "2026-07-30 08:00:00 +08:00",
          }),
        );
      }),
    );

    const response = await createV2exApp().request(
      "https://feedlane.test/v2ex/topics/hot?format=json",
    );
    const body = (await response.json()) as { items: unknown[] };

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(10);
    expect(detailCalls).toBe(10);
    expect(maxActiveRequests).toBeLessThanOrEqual(4);
  });

  it("rejects unsupported tabs before fetching upstream HTML", async () => {
    let upstreamCalls = 0;
    server.use(
      http.get(`${v2exOrigin}/`, () => {
        upstreamCalls += 1;
        return HttpResponse.html(pageFixture);
      }),
    );

    const response = await createV2exApp().request("https://feedlane.test/v2ex/topics/latest");

    expect(response.status).toBe(400);
    expect(upstreamCalls).toBe(0);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it.each([
    ["an unexpected page", HttpResponse.html("<html><body>changed</body></html>")],
    ["a non-HTML response", HttpResponse.json({ topics: [] })],
  ])("maps %s to a sanitized upstream response error", async (_description, upstreamResponse) => {
    server.use(http.get(`${v2exOrigin}/`, () => upstreamResponse));

    const response = await createV2exApp().request("https://feedlane.test/v2ex/topics/hot");

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UPSTREAM_RESPONSE_ERROR" },
    });
  });

  it("maps an upstream 404 without exposing its response body", async () => {
    server.use(
      http.get(`${v2exOrigin}/`, () => HttpResponse.html("private details", { status: 404 })),
    );

    const response = await createV2exApp().request("https://feedlane.test/v2ex/topics/hot");
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain("UPSTREAM_NOT_FOUND");
    expect(body).not.toContain("private details");
  });
});
