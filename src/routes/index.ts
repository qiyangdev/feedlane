import { RouteRegistry } from "../core/registry.js";
import { githubReleasesRoute } from "./github/releases.js";

export const routeRegistry = new RouteRegistry([githubReleasesRoute]);
