import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createRouteScaffold } from "../scripts/create-route.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("route scaffolding", () => {
  it("creates a route module and an isolated test without editing the registry", async () => {
    const rootDirectory = await createTemporaryRoot();

    const result = await createRouteScaffold({
      rootDirectory,
      source: "example-source",
      name: "release-notes",
    });
    const module = await readFile(join(rootDirectory, result.modulePath), "utf8");
    const test = await readFile(join(rootDirectory, result.testPath), "utf8");

    expect(result).toMatchObject({
      modulePath: "src/routes/example-source/release-notes.ts",
      testPath: "tests/example-source-release-notes.test.ts",
      routeExport: "exampleSourceReleaseNotesRoute",
      registrationImport:
        'import { exampleSourceReleaseNotesRoute } from "./example-source/release-notes.js";',
    });
    expect(module).toContain('path: "/example-source/release-notes/:resource"');
    expect(module).toContain("Route scaffold is not implemented.");
    expect(test).toContain("createRouteTestApp(exampleSourceReleaseNotesRoute)");
  });

  it.each([
    ["uppercase source", "Example", "updates"],
    ["path traversal", "example", "../updates"],
    ["underscore", "example_source", "updates"],
    ["empty name", "example", ""],
  ])("rejects %s", async (_description, source, name) => {
    const rootDirectory = await createTemporaryRoot();

    await expect(createRouteScaffold({ rootDirectory, source, name })).rejects.toThrow(TypeError);
  });

  it("refuses to overwrite an existing scaffold", async () => {
    const rootDirectory = await createTemporaryRoot();
    const input = { rootDirectory, source: "example", name: "updates" };
    const first = await createRouteScaffold(input);
    const originalModule = await readFile(join(rootDirectory, first.modulePath), "utf8");

    await expect(createRouteScaffold(input)).rejects.toThrow("Refusing to overwrite");
    await expect(readFile(join(rootDirectory, first.modulePath), "utf8")).resolves.toBe(
      originalModule,
    );
  });
});

async function createTemporaryRoot() {
  const path = await mkdtemp(join(tmpdir(), "feedlane-route-"));
  temporaryRoots.push(path);
  return path;
}
