import { XMLParser, XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";

import type { FeedDocument } from "../src/core/feed.js";
import { ValidationError } from "../src/core/errors.js";
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

interface ParsedFeedXml {
  rss: {
    "@_version": string;
    channel: { title: string };
  };
  feed: {
    "@_xmlns": string;
    title: string;
  };
}

describe("serializeFeedDocument", () => {
  it("serializes RSS 2.0 with escaped metadata and HTML content", () => {
    const output = serializeFeedDocument(document, "rss");
    const parsed = parseXml(output.body);

    expect(output.contentType).toBe("application/rss+xml; charset=utf-8");
    expect(parsed.rss["@_version"]).toBe("2.0");
    expect(parsed.rss.channel.title).toBe(document.title);
    expect(output.body).toContain('<rss version="2.0"');
    expect(output.body).toContain("Signals &amp; Systems &lt;Weekly&gt;");
    expect(output.body).toContain("<![CDATA[One & Two < Three > Zero]]>");
    expect(output.body).toContain(
      "<![CDATA[<p>Hello <strong>feed readers</strong> &amp; friends.</p>]]>",
    );
  });

  it("serializes Atom 1.0 with safe XML text", () => {
    const output = serializeFeedDocument(document, "atom");
    const parsed = parseXml(output.body);

    expect(output.contentType).toBe("application/atom+xml; charset=utf-8");
    expect(parsed.feed["@_xmlns"]).toBe("http://www.w3.org/2005/Atom");
    expect(parsed.feed.title).toBe(document.title);
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

  it.each([
    ["feed home URL", { ...document, homeUrl: "javascript:alert(1)" }],
    ["feed URL", { ...document, feedUrl: "relative/feed" }],
    ["item title", { ...document, items: [{ ...document.items[0]!, title: " " }] }],
    ["item URL", { ...document, items: [{ ...document.items[0]!, url: "file:///tmp/private" }] }],
    [
      "author URL",
      {
        ...document,
        items: [
          {
            ...document.items[0]!,
            authors: [{ name: "Example", url: "mailto:example@example.com" }],
          },
        ],
      },
    ],
    [
      "enclosure metadata",
      {
        ...document,
        items: [
          {
            ...document.items[0]!,
            enclosure: { url: "https://example.com/audio.mp3", type: "audio/mpeg", length: -1 },
          },
        ],
      },
    ],
  ] satisfies Array<[string, FeedDocument]>)(
    "rejects an invalid %s",
    (_description, invalidDocument) => {
      expect(() => serializeFeedDocument(invalidDocument, "rss")).toThrow(ValidationError);
    },
  );
});

function parseXml(body: string): ParsedFeedXml {
  expect(XMLValidator.validate(body)).toBe(true);
  return new XMLParser({ ignoreAttributes: false }).parse(body) as ParsedFeedXml;
}
