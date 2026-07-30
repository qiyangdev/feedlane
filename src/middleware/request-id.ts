import { createMiddleware } from "hono/factory";

export interface AppBindings {
  Variables: {
    requestId: string;
  };
}

const validRequestId = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestId = createMiddleware<AppBindings>(async (context, next) => {
  const suppliedId = context.req.header("x-request-id");
  const id =
    suppliedId !== undefined && validRequestId.test(suppliedId) ? suppliedId : crypto.randomUUID();
  context.set("requestId", id);
  await next();
  context.header("X-Request-Id", id);
});
