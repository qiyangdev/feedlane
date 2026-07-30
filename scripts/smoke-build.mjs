const { default: app } = await import("../dist/index.js");

if (typeof app?.fetch !== "function") {
  throw new TypeError("The production entry point must export a Hono application by default.");
}

const response = await app.request("https://feedlane.test/health/live");
const body = await response.json();

if (
  response.status !== 200 ||
  response.headers.get("cache-control") !== "private, no-store" ||
  body.status !== "ok" ||
  body.service !== "feedlane"
) {
  throw new Error("The compiled production entry point failed its health check.");
}

console.log("Compiled production entry point smoke test passed.");
