import { etagsWeaklyMatch } from "./http-cache.mjs";
import { buildProtectionBypassHeaders } from "./vercel-protection.mjs";

const baseUrlInput = process.argv.find(
  (argument, index) => index > 1 && !argument.startsWith("--"),
);
const baseUrl = parseBaseUrl(baseUrlInput ?? process.env.FEEDLANE_BASE_URL);
const checkUpstream =
  process.argv.includes("--upstream") || process.env.FEEDLANE_SMOKE_UPSTREAM === "true";
const protectionBypassHeaders = buildProtectionBypassHeaders(baseUrl);

await checkJson("liveness", "/health/live", 200, (response, body) => {
  assert(response.headers.get("cache-control") === "private, no-store", "must not be cached");
  assert(body.status === "ok" && body.service === "feedlane", "returned an unexpected body");
});

await checkJson("readiness", "/health/ready", 200, (response, body) => {
  assert(response.headers.get("cache-control") === "private, no-store", "must not be cached");
  assert(body.status === "ready" && Number.isSafeInteger(body.routes), "is not ready");
});

await checkJson("route catalogue", "/", 200, (_response, body) => {
  assert(
    body.name === "feedlane" && Array.isArray(body.routes) && body.routes.length > 0,
    "is empty",
  );
});

await checkJson(
  "sanitized validation error",
  "/github/releases/acme/widget?format=unsupported",
  400,
  (response, body) => {
    assert(response.headers.get("cache-control") === "private, no-store", "must not be cached");
    assert(body.error?.code === "VALIDATION_ERROR", "returned an unexpected error");
  },
);

if (checkUpstream) {
  await checkFeed(
    "GitHub releases RSS feed",
    "/github/releases/honojs/hono",
    "application/rss+xml",
    '<rss version="2.0"',
    { checkReaderPolling: true },
  );
  await checkFeed(
    "GitHub releases Atom feed",
    "/github/releases/honojs/hono?format=atom",
    "application/atom+xml",
    '<feed xmlns="http://www.w3.org/2005/Atom"',
  );
  await checkJson(
    "GitHub releases JSON feed",
    "/github/releases/honojs/hono?format=json",
    200,
    (response, body) => {
      assert(
        response.headers.get("content-type")?.startsWith("application/feed+json") === true,
        "returned an unexpected content type",
      );
      assert(
        response.headers.get("cache-control") === "public, max-age=60",
        "is missing its browser cache policy",
      );
      assert(Array.isArray(body.items), "returned an invalid JSON Feed document");
    },
  );
  await checkFeed(
    "Hacker News RSS feed",
    "/hackernews/news",
    "application/rss+xml",
    '<rss version="2.0"',
  );
}

console.log(
  `Deployment smoke test passed for ${baseUrl.origin}${checkUpstream ? " with upstream checks" : ""}.`,
);

function parseBaseUrl(value) {
  if (value === undefined || value === "") {
    throw new TypeError("Provide a deployment URL as the first argument or set FEEDLANE_BASE_URL.");
  }

  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError("The deployment URL must contain only an HTTP or HTTPS origin.");
  }
  return url;
}

async function checkJson(name, path, expectedStatus, validate) {
  const response = await fetchDeployment(path);
  assert(
    response.status === expectedStatus,
    `${name} returned HTTP ${response.status}; expected ${expectedStatus}`,
  );

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `${name} did not return JSON. For a protected Vercel deployment, configure the bypass secret and trusted project/team slugs.`,
    );
  }
  validate(response, body);
}

async function checkFeed(
  name,
  path,
  expectedContentType,
  rootMarker,
  { checkReaderPolling = false } = {},
) {
  const response = await fetchDeployment(path);
  assert(response.status === 200, `${name} returned HTTP ${response.status}; expected 200`);
  assert(
    response.headers.get("content-type")?.startsWith(expectedContentType) === true,
    `${name} returned an unexpected content type`,
  );
  assert(
    response.headers.get("cache-control") === "public, max-age=60",
    `${name} is missing its browser cache policy`,
  );
  const body = await response.text();
  assert(body.includes(rootMarker), `${name} returned an invalid feed document`);

  if (!checkReaderPolling) return;

  const responseEtag = response.headers.get("etag");
  assert(responseEtag !== null && responseEtag !== "", `${name} is missing an ETag`);

  const headResponse = await fetchDeployment(path, { method: "HEAD" });
  assert(headResponse.status === 200, `${name} HEAD returned HTTP ${headResponse.status}`);
  assert(headResponse.headers.get("etag") === responseEtag, `${name} HEAD changed the ETag`);
  assert((await headResponse.text()) === "", `${name} HEAD returned a response body`);

  const conditionalResponse = await fetchDeployment(path, {
    headers: { "If-None-Match": responseEtag },
  });
  assert(
    conditionalResponse.status === 304,
    `${name} conditional request returned HTTP ${conditionalResponse.status}; expected 304`,
  );
  assert(
    etagsWeaklyMatch(conditionalResponse.headers.get("etag"), responseEtag),
    `${name} conditional response changed the ETag digest`,
  );
}

function fetchDeployment(path, init = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(protectionBypassHeaders ?? {})) {
    headers.set(name, value);
  }
  return fetch(new URL(path, baseUrl), {
    ...init,
    headers,
    signal: AbortSignal.timeout(20_000),
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
