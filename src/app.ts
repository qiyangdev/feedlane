import { Hono } from "hono";
import { z } from "zod";

import { RouteNotFoundError, ValidationError } from "./core/errors.js";
import { HttpFetcher } from "./core/fetcher.js";
import type { RouteRegistry } from "./core/registry.js";
import type { RouteEnvironment } from "./core/route.js";
import { serializeFeedDocument } from "./core/serializer.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestId, type AppBindings } from "./middleware/request-id.js";
import { routeRegistry as defaultRegistry } from "./routes/index.js";

const formatSchema = z.enum(["rss", "atom", "json"]);

export interface CreateAppOptions {
  registry?: RouteRegistry;
  fetcher?: HttpFetcher;
  environment?: RouteEnvironment;
}

export function createApp(options: CreateAppOptions = {}): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  const registry = options.registry ?? defaultRegistry;
  const fetcher = options.fetcher ?? new HttpFetcher();
  const environment = options.environment ?? { githubToken: process.env.GITHUB_TOKEN };

  app.use("*", requestId);
  app.onError(errorHandler);

  app.get("/", (context) =>
    context.json({
      name: "feedlane",
      routes: registry.list().map(({ path, name, description }) => ({ path, name, description })),
    }),
  );

  for (const route of registry.list()) {
    app.get(route.path, async (context) => {
      const formatResult = formatSchema.safeParse(context.req.query("format") ?? "rss");
      if (!formatResult.success) {
        throw new ValidationError("Unsupported feed format. Use rss, atom, or json.");
      }

      const document = await route.execute({
        params: context.req.param(),
        requestUrl: new URL(context.req.url),
        fetcher,
        environment,
      });
      const output = serializeFeedDocument(document, formatResult.data);

      context.header("Content-Type", output.contentType);
      context.header("Cache-Control", "public, max-age=60");
      context.header(
        "Vercel-CDN-Cache-Control",
        `public, s-maxage=${route.cacheTtl}, stale-while-revalidate=86400, stale-if-error=604800`,
      );
      return context.body(output.body);
    });
  }

  app.notFound(() => {
    throw new RouteNotFoundError();
  });

  return app;
}

export const app = createApp();

export default app;
