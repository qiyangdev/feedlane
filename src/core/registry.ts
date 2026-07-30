import type { RegisteredFeedRoute } from "./route.js";

export class RouteRegistry {
  readonly #routes: readonly RegisteredFeedRoute[];

  constructor(routes: readonly RegisteredFeedRoute[]) {
    const paths = new Set<string>();
    for (const route of routes) {
      if (paths.has(route.path)) {
        throw new Error(`Duplicate feed route path: ${route.path}`);
      }
      paths.add(route.path);
    }
    this.#routes = [...routes];
  }

  list(): readonly RegisteredFeedRoute[] {
    return this.#routes;
  }
}
