import { describe, expect, it } from "vitest";

import { extractReadableContent } from "../src/core/content.js";

describe("readable content extraction", () => {
  it("uses Defuddle and sanitizes the extracted HTML", async () => {
    const result = await extractReadableContent({
      pageUrl: new URL("https://example.com/articles/one"),
      contentSelector: "article",
      html: `<!doctype html>
        <html lang="en">
          <head>
            <title>Example article</title>
            <meta name="author" content="Alice">
            <meta name="description" content="A useful article">
          </head>
          <body>
            <nav>Navigation clutter</nav>
            <article>
              <h1>Example article</h1>
              <p onclick="alert(1)">Useful <strong>content</strong>.</p>
              <p><a href="/more" onclick="alert(1)">Related</a></p>
              <p><a href="javascript:alert(1)">Unsafe link text</a></p>
              <img src="/image.png" onerror="alert(1)" alt="Article image">
              <script>alert(1)</script>
            </article>
          </body>
        </html>`,
    });

    expect(result).toMatchObject({
      title: "Example article",
      author: "Alice",
      description: "A useful article",
    });
    expect(result?.contentHtml).toContain("Useful <strong>content</strong>.");
    expect(result?.contentHtml).toContain('href="https://example.com/more"');
    expect(result?.contentHtml).toContain('src="https://example.com/image.png"');
    expect(result?.contentHtml).toContain("Unsafe link text");
    expect(result?.contentHtml).not.toMatch(/onclick|onerror|javascript:|<script/i);
  });

  it("rejects content that exceeds the configured output budget", async () => {
    const result = await extractReadableContent({
      pageUrl: new URL("https://example.com/large"),
      contentSelector: "article",
      maxContentBytes: 32,
      html: `<html><body><article><p>${"content ".repeat(20)}</p></article></body></html>`,
    });

    expect(result).toBeUndefined();
  });

  it("rejects pages without meaningful readable content", async () => {
    const result = await extractReadableContent({
      pageUrl: new URL("https://example.com/empty"),
      contentSelector: "article",
      html: "<html><body><article><script>alert(1)</script></article></body></html>",
    });

    expect(result).toBeUndefined();
  });
});
