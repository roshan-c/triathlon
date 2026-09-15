import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installScaffold } from "../lib/scaffold.js";

test("init scaffold preserves package data and adds local commands and workflows", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "triathlon-scaffold-"));
  await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "node --test" } }));
  const changed = await installScaffold({ cwd });
  const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  assert.equal(manifest.name, "demo");
  assert.equal(manifest.scripts.test, "node --test");
  assert.equal(manifest.scripts.board, "triathlon serve");
  assert.equal(manifest.devDependencies["triathlon"], "^0.1.0");
  assert.ok(changed.includes(".github/workflows/triathlon-pr.yml"));
  assert.match(await readFile(join(cwd, ".github/workflows/triathlon-validate.yml"), "utf8"), /fetch-depth: 0/);
});
