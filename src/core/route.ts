import type { z } from "zod";

import { ValidationError } from "./errors.js";
import type { FeedDocument } from "./feed.js";
import type { HttpFetcher } from "./fetcher.js";

export type RouteParameters = Record<string, string>;

export interface RouteEnvironment {
  githubToken: string | undefined;
}

export interface FeedRouteContext<TParameters extends RouteParameters> {
  params: TParameters;
  requestUrl: URL;
  fetcher: HttpFetcher;
  environment: RouteEnvironment;
}

export interface FeedRoute<TParameters extends RouteParameters> {
  path: string;
  name: string;
  description: string;
  parameters: z.ZodType<TParameters>;
  cacheTtl: number;
  handler: (context: FeedRouteContext<TParameters>) => Promise<FeedDocument>;
}

export interface RegisteredFeedRoute {
  path: string;
  name: string;
  description: string;
  cacheTtl: number;
  execute: (
    context: Omit<FeedRouteContext<RouteParameters>, "params"> & { params: unknown },
  ) => Promise<FeedDocument>;
}

export function defineFeedRoute<TParameters extends RouteParameters>(
  route: FeedRoute<TParameters>,
): RegisteredFeedRoute {
  return {
    path: route.path,
    name: route.name,
    description: route.description,
    cacheTtl: route.cacheTtl,
    async execute(context) {
      const result = route.parameters.safeParse(context.params);
      if (!result.success) {
        throw new ValidationError("One or more route parameters are invalid.");
      }
      return route.handler({ ...context, params: result.data });
    },
  };
}
