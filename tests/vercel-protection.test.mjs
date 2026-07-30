import { describe, expect, it } from "vitest";

import { buildProtectionBypassHeaders } from "../scripts/vercel-protection.mjs";

const environment = {
  VERCEL_AUTOMATION_BYPASS_SECRET: "test-bypass-secret",
  VERCEL_AUTOMATION_BYPASS_PROJECT_SLUG: "feedlane",
  VERCEL_AUTOMATION_BYPASS_TEAM_SLUG: "qiyangstudio",
};

describe("Vercel protection bypass", () => {
  it("sends the bypass header to the configured project's generated deployment host", () => {
    expect(
      buildProtectionBypassHeaders(
        new URL("https://feedlane-b9a11exv2-qiyangstudio.vercel.app"),
        environment,
      ),
    ).toEqual({ "x-vercel-protection-bypass": "test-bypass-secret" });
  });

  it.each([
    "https://attacker.example",
    "https://feedlane-b9a11exv2-otherteam.vercel.app",
    "https://otherproject-b9a11exv2-qiyangstudio.vercel.app",
    "https://feedlane-b9a11exv2-qiyangstudio.vercel.app.attacker.example",
    "https://feedlane-rose.vercel.app",
    "http://feedlane-b9a11exv2-qiyangstudio.vercel.app",
  ])("does not send the bypass header to an untrusted target: %s", (target) => {
    expect(buildProtectionBypassHeaders(new URL(target), environment)).toBeUndefined();
  });

  it("fails closed when the trusted project configuration is incomplete", () => {
    expect(
      buildProtectionBypassHeaders(new URL("https://feedlane-b9a11exv2-qiyangstudio.vercel.app"), {
        VERCEL_AUTOMATION_BYPASS_SECRET: "test-bypass-secret",
        VERCEL_AUTOMATION_BYPASS_PROJECT_SLUG: "feedlane",
      }),
    ).toBeUndefined();
  });
});
