import { resolve } from "node:path";

import { smokeRuntime } from "./runtime-smoke.mjs";

await smokeRuntime({
  appModulePath: resolve("dist/index.js"),
  contentModulePath: resolve("dist/core/content.js"),
  label: "Compiled production entry point",
});
