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
        author?: { name: string; url: string };
        tags: string[];
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.title).toBe("V2EX: Hot Topics");
    expect(body.home_page_url).toBe("https://www.v2ex.com/?tab=hot");
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      id: "https://www.v2ex.com/t/123",
      url: "https://www.v2ex.com/t/123",
      title: "A & B <launch>",
      date_published: "2026-07-30T09:05:28.000Z",
      author: { name: "alice", url: "https://www.v2ex.com/member/alice" },
      tags: ["hot", "问与答"],
    });
    expect(body.items[0]?.content_html).toContain("A &amp; B &lt;launch&gt;");
    expect(body.items[0]?.content_html).toContain("42 replies");
    expect(body.items[0]?.content_html).not.toContain("<launch>");
    expect(body.items[1]?.content_html).toContain("1 reply");
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
