import { RouteRegistry } from "../core/registry.js";
import { createGithubCommitsRoute } from "./github/commits.js";
import { createGithubReleasesRoute } from "./github/releases.js";
import { hackerNewsListsRoute } from "./hackernews/lists.js";

export interface RouteRegistryOptions {
  githubToken: string | undefined;
}

export function createRouteRegistry(options: RouteRegistryOptions): RouteRegistry {
  return new RouteRegistry([
    createGithubCommitsRoute({ token: options.githubToken }),
    createGithubReleasesRoute({ token: options.githubToken }),
    hackerNewsListsRoute,
  ]);
}

export function createDefaultRouteRegistry(): RouteRegistry {
  return createRouteRegistry({ githubToken: process.env.GITHUB_TOKEN });
}
