import { Hono } from "hono";
import { z } from "zod";

import { RouteNotFoundError, ValidationError } from "./core/errors.js";
import { HttpFetcher } from "./core/fetcher.js";
import { jsonConsoleLogger, type StructuredLogger } from "./core/logger.js";
import { RequestMetrics } from "./core/metrics.js";
import type { RouteRegistry } from "./core/registry.js";
import { serializeFeedDocument, type FeedFormat } from "./core/serializer.js";
import { errorHandler } from "./middleware/error-handler.js";
import { observability } from "./middleware/observability.js";
import { requestId, type AppBindings } from "./middleware/request-id.js";
import { createDefaultRouteRegistry } from "./routes/index.js";

const formatSchema = z.enum(["rss", "atom", "json"]);

export interface CreateAppOptions {
  registry?: RouteRegistry;
  fetcher?: HttpFetcher;
  logger?: StructuredLogger;
  metrics?: RequestMetrics;
  now?: () => number;
  publicBaseUrl?: string | URL;
}

export function createApp(options: CreateAppOptions = {}): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  const registry = options.registry ?? createDefaultRouteRegistry();
  const fetcher = options.fetcher ?? new HttpFetcher();
  const logger = options.logger ?? jsonConsoleLogger;
  const metrics = options.metrics ?? new RequestMetrics();
  const publicBaseUrl = parsePublicBaseUrl(options.publicBaseUrl);

  app.use("*", requestId);
  app.use(
    "*",
    observability({
      logger,
      metrics,
      ...(options.now === undefined ? {} : { now: options.now }),
    }),
  );
  app.onError(errorHandler);

  app.get("/", (context) =>
    context.json({
      name: "feedlane",
      routes: registry.list().map(({ path, name, description }) => ({ path, name, description })),
    }),
  );

  app.get("/health/live", (context) => {
    setOperationalHeaders(context);
    return context.json({ status: "ok", service: "feedlane" });
  });

  app.get("/health/ready", (context) => {
    setOperationalHeaders(context);
    const routeCount = registry.list().length;
    if (routeCount === 0) {
      return context.json(
        {
          status: "not_ready",
          service: "feedlane",
          checks: { routeRegistry: "empty" },
        },
        503,
      );
    }
    return context.json({
      status: "ready",
      service: "feedlane",
      checks: { routeRegistry: "ok" },
      routes: routeCount,
    });
  });

  app.get("/metrics", (context) => {
    setOperationalHeaders(context);
    return context.body(metrics.renderPrometheus(), 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    });
  });

  for (const route of registry.list()) {
    app.get(route.path, async (context) => {
      const formatResult = formatSchema.safeParse(context.req.query("format") ?? "rss");
      if (!formatResult.success) {
        throw new ValidationError("Unsupported feed format. Use rss, atom, or json.");
      }

      const document = await route.execute({
        params: context.req.param(),
        requestUrl: buildFeedUrl(new URL(context.req.url), formatResult.data, publicBaseUrl),
        fetcher,
      });
      const output = serializeFeedDocument(document, formatResult.data);

      context.header("Content-Type", output.contentType);
      context.header("Cache-Control", "public, max-age=60");
      context.header(
        "Vercel-CDN-Cache-Control",
        `public, s-maxage=${route.cacheTtl}, stale-while-revalidate=86400`,
      );
      return context.body(output.body);
    });
  }

  app.notFound(() => {
    throw new RouteNotFoundError();
  });

  return app;
}

const configuredPublicBaseUrl = process.env.PUBLIC_BASE_URL;
export const app = createApp(
  configuredPublicBaseUrl === undefined ? {} : { publicBaseUrl: configuredPublicBaseUrl },
);

export default app;

function setOperationalHeaders(context: { header(name: string, value: string): void }): void {
  context.header("Cache-Control", "private, no-store");
  context.header("Vercel-CDN-Cache-Control", "private, no-store");
}

function parsePublicBaseUrl(value: string | URL | undefined): URL | undefined {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) return undefined;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("PUBLIC_BASE_URL must be an absolute HTTP or HTTPS URL.");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError("PUBLIC_BASE_URL must contain only an HTTP or HTTPS origin.");
  }
  return url;
}

function buildFeedUrl(requestUrl: URL, format: FeedFormat, publicBaseUrl: URL | undefined): URL {
  const url = new URL(requestUrl);
  if (publicBaseUrl !== undefined) {
    url.protocol = publicBaseUrl.protocol;
    url.host = publicBaseUrl.host;
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  if (format !== "rss") {
    url.searchParams.set("format", format);
  }
  return url;
}
