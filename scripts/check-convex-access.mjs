#!/usr/bin/env node
// Enforces that every registered Convex function is classified in
// docs/security/convex-access-matrix.md. Wires into CI as
// `pnpm check:convex-access` (see Task 3.6).
//
// Extracts exported registered function names from convex/*.ts (excluding
// _generated/** and *.test.ts), then asserts each `<file>.<name>` token
// appears in the matrix markdown. Exits 1 listing any unclassified names.
//
// Run: node scripts/check-convex-access.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const convexDir = join(repoRoot, "convex");
const matrixPath = join(repoRoot, "docs", "security", "convex-access-matrix.md");

// Registered function decorators. internal* variants are included so the
// matrix accounts for private/internal functions too.
// Scans the full file (no `^` anchor, no `m` flag) so declarations that span
// multiple lines — e.g.
//   export const foo =
//     query({ ... });
// are still detected.
const REGISTERED =
  /export\s+const\s+(\w+)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\s*\(/g;

function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "_generated" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (
      st.isFile() &&
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      entry !== "schema.ts" &&
      entry !== "auth.config.ts" &&
      entry !== "testTypes.d.ts"
    ) {
      out.push(full);
    }
  }
  return out;
}

function extractFunctions(file) {
  const src = readFileSync(file, "utf8");
  const names = [];
  // Deduplicate in case the same declaration is matched twice (defensive).
  const seen = new Set();
  for (const m of src.matchAll(REGISTERED)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    names.push(m[1]);
  }
  return names;
}

const matrix = readFileSync(matrixPath, "utf8");
const files = listTsFiles(convexDir);

const missing = [];
let total = 0;
for (const file of files) {
  const rel = file.slice(convexDir.length + 1).replace(/\.ts$/, "");
  for (const name of extractFunctions(file)) {
    total++;
    // Each matrix row references the function as `file.name` (backticked).
    // Require the dotted form so a name shared across modules (e.g.
    // `listByTenant`, `getById`) cannot satisfy another module's row.
    const token = `\`${rel}.${name}\``;
    if (!matrix.includes(token)) {
      missing.push(`${rel}.${name}`);
    }
  }
}

if (missing.length > 0) {
  console.error(
    `check-convex-access: ${missing.length} unclassified function(s) of ${total}:`
  );
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

console.error(`check-convex-access: all ${total} registered functions classified.`);