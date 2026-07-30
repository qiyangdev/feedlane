import { pathToFileURL } from "node:url";

export async function smokeRuntime({ appModulePath, contentModulePath, label }) {
  const { default: app } = await import(pathToFileURL(appModulePath).href);

  if (typeof app?.fetch !== "function") {
    throw new TypeError(`${label} must export a Hono application by default.`);
  }

  const response = await app.request("https://feedlane.test/health/live");
  const body = await response.json();

  if (
    response.status !== 200 ||
    response.headers.get("cache-control") !== "private, no-store" ||
    body.status !== "ok" ||
    body.service !== "feedlane"
  ) {
    throw new Error(`${label} failed its health check.`);
  }

  const { extractReadableContent } = await import(pathToFileURL(contentModulePath).href);
  const content = await extractReadableContent({
    pageUrl: new URL("https://example.com/articles/runtime-smoke"),
    contentSelector: "article",
    html: `<!doctype html><html><body><article><p>Runtime <strong>content</strong>.</p><script>alert(1)</script></article></body></html>`,
  });

  if (
    content?.contentHtml.includes("Runtime <strong>content</strong>.") !== true ||
    /<script/i.test(content.contentHtml)
  ) {
    throw new Error(`${label} failed its readable-content dependency check.`);
  }

  console.log(`${label} and readable-content dependencies passed the runtime smoke test.`);
}
