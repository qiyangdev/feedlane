import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { smokeRuntime } from "./runtime-smoke.mjs";

const functionDirectory = resolve(".vercel/output/functions/index.func");
const configPath = resolve(functionDirectory, ".vc-config.json");
const config = JSON.parse(await readFile(configPath, "utf8"));

if (typeof config.handler !== "string" || config.handler.trim() === "") {
  throw new TypeError("The Vercel function configuration is missing its handler.");
}

const handlerPath = resolve(functionDirectory, config.handler);
if (!handlerPath.startsWith(`${functionDirectory}${sep}`)) {
  throw new TypeError("The Vercel function handler must remain inside its function directory.");
}

await smokeRuntime({
  appModulePath: handlerPath,
  contentModulePath: resolve(dirname(handlerPath), "core/content.js"),
  label: "Vercel function bundle",
});
