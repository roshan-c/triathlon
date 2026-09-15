import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const VERSION = "^0.1.0";
const scripts = {
  board: "triathlon serve",
  "board:render": "triathlon render",
  "board:validate": "triathlon validate",
  "board:metrics": "triathlon metrics",
  "board:check": "triathlon validate && triathlon render --check",
};

async function exists(path) {
  try { await readFile(path); return true; } catch { return false; }
}

export async function installScaffold({ cwd = process.cwd(), force = false, workflows = true } = {}) {
  const changed = [];
  const packagePath = resolve(cwd, "package.json");
  let manifest = { private: true };
  if (await exists(packagePath)) manifest = JSON.parse(await readFile(packagePath, "utf8"));
  manifest.scripts = { ...(manifest.scripts ?? {}), ...scripts };
  const alreadyInstalled = manifest.dependencies?.["triathlon"] ?? manifest.devDependencies?.["triathlon"];
  if (manifest.name !== "triathlon" && !alreadyInstalled) {
    manifest.devDependencies = { ...(manifest.devDependencies ?? {}), "triathlon": VERSION };
  }
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  changed.push("package.json");

  if (workflows) {
    const workflowDirectory = resolve(cwd, ".github/workflows");
    await mkdir(workflowDirectory, { recursive: true });
    for (const name of ["triathlon-validate.yml", "triathlon-pr.yml", "triathlon-metrics.yml"]) {
      const target = resolve(workflowDirectory, name);
      if (!force && await exists(target)) continue;
      const source = new URL(`../templates/${name}`, import.meta.url);
      await writeFile(target, await readFile(source, "utf8"), "utf8");
      changed.push(`.github/workflows/${name}`);
    }
  }
  return changed;
}
