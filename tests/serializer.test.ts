import { describe, expect, it } from "vitest";

import type { FeedDocument } from "../src/core/feed.js";
import { serializeFeedDocument } from "../src/core/serializer.js";

const document: FeedDocument = {
  title: "Signals & Systems <Weekly>",
  description: "Updates > noise & distractions",
  homeUrl: "https://example.com/",
  feedUrl: "https://feeds.example.com/demo",
  language: "en",
  updatedAt: new Date("2026-01-02T03:04:05.000Z"),
  items: [
    {
      id: "entry-1",
      title: "One & Two < Three > Zero",
      url: "https://example.com/posts/1?a=1&b=2",
      description: "Plain <text> & symbols",
      contentHtml: "<p>Hello <strong>feed readers</strong> &amp; friends.</p>",
      publishedAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T03:04:05.000Z"),
      authors: [{ name: "A & B", url: "https://example.com/authors/a" }],
      categories: ["news & notes"],
    },
  ],
};

describe("serializeFeedDocument", () => {
  it("serializes RSS 2.0 with escaped metadata and HTML content", () => {
    const output = serializeFeedDocument(document, "rss");

    expect(output.contentType).toBe("application/rss+xml; charset=utf-8");
    expect(output.body).toContain('<rss version="2.0"');
    expect(output.body).toContain("Signals &amp; Systems &lt;Weekly&gt;");
    expect(output.body).toContain("<![CDATA[One & Two < Three > Zero]]>");
    expect(output.body).toContain(
      "<![CDATA[<p>Hello <strong>feed readers</strong> &amp; friends.</p>]]>",
    );
  });

  it("serializes Atom 1.0 with safe XML text", () => {
    const output = serializeFeedDocument(document, "atom");

    expect(output.contentType).toBe("application/atom+xml; charset=utf-8");
    expect(output.body).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(output.body).toContain("<![CDATA[One & Two < Three > Zero]]>");
    expect(output.body).toContain("<p>Hello <strong>feed readers</strong> &amp; friends.</p>");
  });

  it("serializes JSON Feed 1.0 and preserves HTML content", () => {
    const output = serializeFeedDocument(document, "json");
    const parsed = JSON.parse(output.body) as {
      version: string;
      items: Array<{ content_html: string; title: string }>;
    };

    expect(output.contentType).toBe("application/feed+json; charset=utf-8");
    expect(parsed.version).toBe("https://jsonfeed.org/version/1");
    expect(parsed.items[0]).toMatchObject({
      title: "One & Two < Three > Zero",
      content_html: "<p>Hello <strong>feed readers</strong> &amp; friends.</p>",
    });
  });
});
