import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, test } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects access-matrix rows for functions that no longer exist", () => {
  const root = mkdtempSync(join(tmpdir(), "pickle-point-access-matrix-"));
  temporaryDirectories.push(root);

  const convexDir = join(root, "convex");
  mkdirSync(convexDir, { recursive: true });
  writeFileSync(
    join(convexDir, "sample.ts"),
    'export const active = query({ args: {}, handler: async () => null });\n',
  );

  const matrixPath = join(root, "matrix.md");
  writeFileSync(
    matrixPath,
    [
      "| Function | Kind |",
      "|---|---|",
      "| `sample.active` | query |",
      "| `sample.deleted` | query |",
      "",
    ].join("\n"),
  );

  const result = spawnSync(
    process.execPath,
    [resolve("scripts/check-convex-access.mjs")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CONVEX_ACCESS_SOURCE_DIR: convexDir,
        CONVEX_ACCESS_MATRIX_PATH: matrixPath,
      },
    },
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("stale classification");
  expect(result.stderr).toContain("sample.deleted");
});
