import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROUTE_SEGMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export async function createRouteScaffold({ rootDirectory, source, name }) {
  assertRouteSegment(source, "source");
  assertRouteSegment(name, "name");

  const root = resolve(rootDirectory);
  const routeExport = `${toCamelCase(source)}${toPascalCase(name)}Route`;
  const routePath = `/${source}/${name}/:resource`;
  const displayName = `${toTitleCase(source)} ${toTitleCase(name)}`;
  const modulePath = resolve(root, "src", "routes", source, `${name}.ts`);
  const testPath = resolve(root, "tests", `${source}-${name}.test.ts`);

  const existingPaths = [];
  for (const path of [modulePath, testPath]) {
    if (await pathExists(path)) existingPaths.push(relative(root, path));
  }
  if (existingPaths.length > 0) {
    throw new Error(`Refusing to overwrite existing files: ${existingPaths.join(", ")}`);
  }

  await mkdir(resolve(root, "src", "routes", source), { recursive: true });
  await mkdir(resolve(root, "tests"), { recursive: true });

  const createdPaths = [];
  try {
    await writeFile(modulePath, buildRouteModule({ displayName, routeExport, routePath }), {
      encoding: "utf8",
      flag: "wx",
    });
    createdPaths.push(modulePath);
    await writeFile(
      testPath,
      buildRouteTest({ displayName, name, routeExport, routePath, source }),
      { encoding: "utf8", flag: "wx" },
    );
    createdPaths.push(testPath);
  } catch (error) {
    await Promise.all(createdPaths.map((path) => rm(path, { force: true })));
    throw error;
  }

  return {
    modulePath: relative(root, modulePath),
    testPath: relative(root, testPath),
    routeExport,
    registrationImport: `import { ${routeExport} } from "./${source}/${name}.js";`,
  };
}

function assertRouteSegment(value, label) {
  if (typeof value !== "string" || value.length > 64 || !ROUTE_SEGMENT.test(value)) {
    throw new TypeError(
      `Route ${label} must be a lowercase kebab-case segment of at most 64 characters.`,
    );
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function toWords(value) {
  return value.split("-");
}

function toCamelCase(value) {
  const [first = "", ...rest] = toWords(value);
  return first + rest.map(capitalize).join("");
}

function toPascalCase(value) {
  return toWords(value).map(capitalize).join("");
}

function toTitleCase(value) {
  return toWords(value).map(capitalize).join(" ");
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildRouteModule({ displayName, routeExport, routePath }) {
  return `import { z } from "zod";

import { UpstreamResponseError } from "../../core/errors.js";
import { defineFeedRoute, type FeedRoute } from "../../core/route.js";

const parameters = z.object({
  resource: z.string().min(1).max(200),
});

type Parameters = z.infer<typeof parameters>;

const definition: FeedRoute<Parameters> = {
  path: "${routePath}",
  name: "${displayName}",
  description: "TODO: Describe the feed and its upstream source.",
  parameters,
  cacheTtl: 300,
  async handler() {
    throw new UpstreamResponseError("Route scaffold is not implemented.");
  },
};

export const ${routeExport} = defineFeedRoute(definition);
`;
}

function buildRouteTest({ displayName, name, routeExport, routePath, source }) {
  return `import { describe, expect, it } from "vitest";

import { ${routeExport} } from "../src/routes/${source}/${name}.js";
import { createRouteTestApp } from "./route-test-app.js";

describe("${displayName} route", () => {
  it("defines the scaffold route metadata", async () => {
    expect(${routeExport}).toMatchObject({ path: "${routePath}" });

    const response = await createRouteTestApp(${routeExport}).request(
      "https://feedlane.test/${source}/${name}/example",
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UPSTREAM_RESPONSE_ERROR" },
    });
  });

  it.todo("converts a representative upstream response into feed items");
  it.todo("rejects invalid route parameters before fetching upstream data");
  it.todo("maps upstream failures to sanitized errors");
});
`;
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] === "--") arguments_.shift();
  const [source, name, ...extraArguments] = arguments_;
  if (source === undefined || name === undefined || extraArguments.length > 0) {
    throw new TypeError("Usage: pnpm route:new -- <source> <route-name>");
  }

  const result = await createRouteScaffold({ rootDirectory: process.cwd(), source, name });
  console.log(`Created ${result.modulePath}`);
  console.log(`Created ${result.testPath}`);
  console.log("Register the route explicitly in src/routes/index.ts:");
  console.log(result.registrationImport);
  console.log(`Add ${result.routeExport} to the RouteRegistry list.`);
}

const executedPath = process.argv[1];
if (executedPath !== undefined && import.meta.url === pathToFileURL(resolve(executedPath)).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Route scaffolding failed.");
    process.exitCode = 1;
  });
}
