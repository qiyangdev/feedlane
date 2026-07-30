import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { RequestMetrics } from "../src/core/metrics.js";
import { RouteRegistry } from "../src/core/registry.js";
import type { RegisteredFeedRoute } from "../src/core/route.js";
import { createRouteRegistry } from "../src/routes/index.js";
import { MemoryLogger, silentLogger } from "./helpers.js";

function defaultRegistry() {
  return createRouteRegistry({ githubToken: undefined });
}

describe("request observability", () => {
  it("writes correlated start and completion events without sensitive request data", async () => {
    const logger = new MemoryLogger();
    let currentTime = 100;
    const app = createApp({
      registry: defaultRegistry(),
      logger,
      now: () => {
        const value = currentTime;
        currentTime += 25;
        return value;
      },
    });

    const response = await app.request("https://feedlane.test/?token=must-not-be-logged", {
      headers: {
        authorization: "Bearer must-not-be-logged",
        "x-request-id": "test-request-id",
        "x-vercel-id": "hkg1::iad1::platform-id",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("test-request-id");
    expect(logger.entries).toHaveLength(2);
    expect(logger.entries[0]).toMatchObject({
      level: "info",
      event: "request.started",
      requestId: "test-request-id",
      vercelRequestId: "hkg1::iad1::platform-id",
      method: "GET",
      path: "/",
    });
    expect(logger.entries[1]).toMatchObject({
      level: "info",
      event: "request.completed",
      requestId: "test-request-id",
      route: "/",
      status: 200,
      durationMs: 25,
    });
    expect(JSON.stringify(logger.entries)).not.toContain("must-not-be-logged");
  });

  it("records sanitized error metadata and uses a bounded unmatched route label", async () => {
    const logger = new MemoryLogger();
    const app = createApp({ registry: defaultRegistry(), logger });

    const response = await app.request("https://feedlane.test/private/not-found?secret=value");

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toMatch(/^[A-Fa-f0-9-]{36}$/);
    expect(logger.entries.at(-1)).toMatchObject({
      level: "warn",
      event: "request.completed",
      route: "unmatched",
      status: 404,
      errorCode: "ROUTE_NOT_FOUND",
    });
    expect(JSON.stringify(logger.entries)).not.toContain("secret=value");
  });

  it("does not expose an unexpected error or let logger failures change responses", async () => {
    const secret = "internal-secret-details";
    const failingRoute: RegisteredFeedRoute = {
      path: "/fail",
      name: "Failure test",
      description: "Throws an unexpected error.",
      cacheTtl: 60,
      async execute() {
        throw new Error(secret);
      },
    };
    const logger = new MemoryLogger();
    const app = createApp({ registry: new RouteRegistry([failingRoute]), logger });

    const response = await app.request("https://feedlane.test/fail");
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain(secret);
    expect(logger.entries.at(-1)).toMatchObject({
      level: "error",
      route: "/fail",
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(logger.entries)).not.toContain(secret);

    const loggerFailureApp = createApp({
      registry: defaultRegistry(),
      logger: {
        write() {
          throw new Error("logger unavailable");
        },
      },
    });
    await expect(loggerFailureApp.request("https://feedlane.test/")).resolves.toMatchObject({
      status: 200,
    });
  });
});

describe("operational endpoints", () => {
  it("provides uncached liveness and readiness checks", async () => {
    const app = createApp({ registry: defaultRegistry(), logger: silentLogger });

    const live = await app.request("https://feedlane.test/health/live");
    const ready = await app.request("https://feedlane.test/health/ready");

    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toBe("private, no-store");
    await expect(live.json()).resolves.toEqual({ status: "ok", service: "feedlane" });
    expect(ready.status).toBe(200);
    expect(ready.headers.get("vercel-cdn-cache-control")).toBe("private, no-store");
    await expect(ready.json()).resolves.toEqual({
      status: "ready",
      service: "feedlane",
      checks: { routeRegistry: "ok" },
      routes: 2,
    });
  });

  it("reports an empty route registry as not ready", async () => {
    const app = createApp({ registry: new RouteRegistry([]), logger: silentLogger });

    const response = await app.request("https://feedlane.test/health/ready");

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      status: "not_ready",
      checks: { routeRegistry: "empty" },
    });
  });

  it("exposes instance-scoped Prometheus counters and latency histograms", async () => {
    const metrics = new RequestMetrics({
      durationBucketsMs: [10, 100],
      startedAt: new Date("2026-01-01T00:00:00Z"),
    });
    let currentTime = 0;
    const app = createApp({
      registry: defaultRegistry(),
      logger: silentLogger,
      metrics,
      now: () => {
        currentTime += 20;
        return currentTime;
      },
    });
    await app.request("https://feedlane.test/");
    await app.request("https://feedlane.test/not-found");

    const response = await app.request("https://feedlane.test/metrics");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toContain("feedlane_process_start_time_seconds 1767225600");
    expect(body).toContain('feedlane_http_requests_total{method="GET",route="/",status="2xx"} 1');
    expect(body).toContain(
      'feedlane_http_requests_total{method="GET",route="unmatched",status="4xx"} 1',
    );
    expect(body).toContain(
      'feedlane_http_request_duration_seconds_bucket{method="GET",route="/",le="0.1"} 1',
    );
    expect(body).toContain('feedlane_http_request_errors_total{code="ROUTE_NOT_FOUND"} 1');
  });
});

describe("RequestMetrics", () => {
  it("collapses nonstandard HTTP methods into a bounded label", () => {
    const metrics = new RequestMetrics();
    for (const method of ["probe-a", "PROBE-B"]) {
      metrics.record({
        method,
        route: "unmatched",
        status: 404,
        durationMs: 1,
      });
    }

    const output = metrics.renderPrometheus();

    expect(output).toContain(
      'feedlane_http_requests_total{method="OTHER",route="unmatched",status="4xx"} 2',
    );
    expect(output).not.toContain("PROBE-A");
    expect(output).not.toContain("PROBE-B");
  });

  it.each([[[]], [[10, 10]], [[100, 10]], [[0, 10]]])(
    "rejects invalid histogram buckets: %j",
    (durationBucketsMs) => {
      expect(() => new RequestMetrics({ durationBucketsMs })).toThrow(TypeError);
    },
  );
});
