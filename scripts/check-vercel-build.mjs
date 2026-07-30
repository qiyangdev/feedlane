import { spawn } from "node:child_process";

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn("vercel", ["build", "--prod"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal !== null) {
      reject(new Error(`Vercel build was terminated by ${signal}.`));
      return;
    }
    resolve(code);
  });
});

if (exitCode !== 0) {
  throw new Error(`Vercel build failed with exit code ${exitCode}.`);
}

await import("./smoke-vercel-build.mjs");
