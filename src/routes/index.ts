import { RouteRegistry } from "../core/registry.js";
import { createGithubReleasesRoute } from "./github/releases.js";
import { hackerNewsListsRoute } from "./hackernews/lists.js";

export interface RouteRegistryOptions {
  githubToken: string | undefined;
}

export function createRouteRegistry(options: RouteRegistryOptions): RouteRegistry {
  return new RouteRegistry([
    createGithubReleasesRoute({ token: options.githubToken }),
    hackerNewsListsRoute,
  ]);
}

export function createDefaultRouteRegistry(): RouteRegistry {
  return createRouteRegistry({ githubToken: process.env.GITHUB_TOKEN });
}
