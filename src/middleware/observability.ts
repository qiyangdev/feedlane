import { FeedlaneError } from "../core/errors.js";
import type { StructuredLogger } from "../core/logger.js";
import type { RequestMetrics } from "../core/metrics.js";
import { createMiddleware } from "hono/factory";

import type { AppBindings } from "./request-id.js";

export interface ObservabilityOptions {
  logger: StructuredLogger;
  metrics: RequestMetrics;
  now?: () => number;
}

export function observability(options: ObservabilityOptions) {
  const now = options.now ?? performance.now.bind(performance);

  return createMiddleware<AppBindings>(async (context, next) => {
    const startedAt = now();
    const requestId = context.get("requestId");
    const vercelRequestId = context.req.header("x-vercel-id");
    safeWrite(options.logger, {
      timestamp: new Date().toISOString(),
      level: "info",
      event: "request.started",
      service: "feedlane",
      requestId,
      method: context.req.method,
      path: context.req.path,
      ...(vercelRequestId === undefined ? {} : { vercelRequestId }),
    });

    let didThrow = false;
    let thrownError: unknown;
    try {
      await next();
    } catch (error) {
      didThrow = true;
      thrownError = error;
      if (error instanceof Error) {
        context.error = error;
      }
    }

    const durationMs = Math.max(0, now() - startedAt);
    const route = normalizeRoute(context.req.routePath);
    const status = didThrow
      ? context.error instanceof FeedlaneError
        ? context.error.status
        : 500
      : context.res.status;
    const errorCode =
      context.error instanceof FeedlaneError
        ? context.error.code
        : context.error === undefined
          ? undefined
          : "INTERNAL_ERROR";

    options.metrics.record({
      method: context.req.method,
      route,
      status,
      durationMs,
      ...(errorCode === undefined ? {} : { errorCode }),
    });
    safeWrite(options.logger, {
      timestamp: new Date().toISOString(),
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      event: "request.completed",
      service: "feedlane",
      requestId,
      method: context.req.method,
      route,
      status,
      durationMs: Math.round(durationMs * 100) / 100,
      ...(vercelRequestId === undefined ? {} : { vercelRequestId }),
      ...(errorCode === undefined ? {} : { errorCode }),
    });

    if (didThrow) {
      throw thrownError;
    }
  });
}

function normalizeRoute(route: string): string {
  return route === "*" || route === "/*" || route === "" ? "unmatched" : route;
}

function safeWrite(
  logger: StructuredLogger,
  entry: Parameters<StructuredLogger["write"]>[0],
): void {
  try {
    logger.write(entry);
  } catch {
    // Telemetry failures must never change an HTTP response.
  }
}
