import { serve } from "@hono/node-server";

import { app } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

serve({ fetch: app.fetch, port }, ({ port: listeningPort }) => {
  console.log(`Feedlane is running at http://localhost:${listeningPort}`);
});
