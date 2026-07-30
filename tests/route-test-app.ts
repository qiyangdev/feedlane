import { createApp, type CreateAppOptions } from "../src/app.js";
import { RouteRegistry } from "../src/core/registry.js";
import type { RegisteredFeedRoute } from "../src/core/route.js";
import { silentLogger } from "./helpers.js";

export function createRouteTestApp(
  route: RegisteredFeedRoute,
  options: Omit<CreateAppOptions, "registry"> = {},
) {
  return createApp({
    ...options,
    registry: new RouteRegistry([route]),
    logger: options.logger ?? silentLogger,
  });
}
