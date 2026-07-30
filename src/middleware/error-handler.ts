import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { FeedlaneError } from "../core/errors.js";
import type { AppBindings } from "./request-id.js";

export const errorHandler: ErrorHandler<AppBindings> = (error, context) => {
  const knownError = error instanceof FeedlaneError;
  const status = (knownError ? error.status : 500) as ContentfulStatusCode;
  const code = knownError ? error.code : "INTERNAL_ERROR";
  const message = knownError ? error.message : "An unexpected error occurred.";

  context.header("Cache-Control", "private, no-store");
  context.header("Vercel-CDN-Cache-Control", "private, no-store");
  return context.json(
    {
      error: {
        code,
        message,
        requestId: context.get("requestId"),
      },
    },
    status,
  );
};
