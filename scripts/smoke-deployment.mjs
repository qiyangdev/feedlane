const baseUrlInput = process.argv.find(
  (argument, index) => index > 1 && !argument.startsWith("--"),
);
const baseUrl = parseBaseUrl(baseUrlInput ?? process.env.FEEDLANE_BASE_URL);
const checkUpstream =
  process.argv.includes("--upstream") || process.env.FEEDLANE_SMOKE_UPSTREAM === "true";

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
  await checkJson(
    "GitHub releases feed",
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
  const url = new URL(path, baseUrl);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  assert(
    response.status === expectedStatus,
    `${name} returned HTTP ${response.status}; expected ${expectedStatus}`,
  );

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${name} did not return JSON.`);
  }
  validate(response, body);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
