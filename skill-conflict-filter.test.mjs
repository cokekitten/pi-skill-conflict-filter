import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  createPatchedShowLoadedResources,
  filterSkillCollisionDiagnostics,
} from "./extensions/skill-conflict-filter.ts";

const skillCollision = {
  type: "collision",
  message: "name collision",
  collision: { resourceType: "skill", name: "brainstorming" },
};
const promptCollision = {
  type: "collision",
  message: "prompt collision",
  collision: { resourceType: "prompt", name: "review" },
};
const warning = {
  type: "warning",
  message: "skill path does not exist",
};

describe("filterSkillCollisionDiagnostics", () => {
  it("removes only skill collision diagnostics without mutating the source", () => {
    const source = {
      skills: [{ name: "brainstorming" }],
      diagnostics: [skillCollision, promptCollision, warning],
    };

    const filtered = filterSkillCollisionDiagnostics(source);

    assert.deepEqual(filtered.diagnostics, [promptCollision, warning]);
    assert.deepEqual(source.diagnostics, [skillCollision, promptCollision, warning]);
    assert.strictEqual(filtered.skills, source.skills);
  });

  it("returns the original object when no skill collision exists", () => {
    const source = { skills: [], diagnostics: [warning] };
    assert.strictEqual(filterSkillCollisionDiagnostics(source), source);
  });
});

describe("createPatchedShowLoadedResources", () => {
  it("filters only during rendering and restores getSkills afterwards", () => {
    const result = {
      skills: [],
      diagnostics: [skillCollision, warning],
    };
    const loader = {
      getSkills() {
        return result;
      },
    };
    let observed;
    const original = function () {
      observed = this.session.resourceLoader.getSkills();
      return "rendered";
    };
    const patched = createPatchedShowLoadedResources(original);
    const instance = { session: { resourceLoader: loader } };
    const originalGetSkills = loader.getSkills;

    assert.equal(patched.call(instance), "rendered");
    assert.deepEqual(observed.diagnostics, [warning]);
    assert.strictEqual(loader.getSkills, originalGetSkills);
    assert.strictEqual(loader.getSkills(), result);
  });

  it("restores getSkills when native rendering throws", () => {
    const loader = {
      getSkills() {
        return { skills: [], diagnostics: [skillCollision] };
      },
    };
    const originalGetSkills = loader.getSkills;
    const patched = createPatchedShowLoadedResources(function () {
      throw new Error("render failed");
    });

    assert.throws(
      () => patched.call({ session: { resourceLoader: loader } }),
      /render failed/,
    );
    assert.strictEqual(loader.getSkills, originalGetSkills);
  });
});

function resolvePiPackageRoot() {
  const piBin = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
  return dirname(dirname(realpathSync(piBin)));
}

async function loadPiInternals() {
  const root = resolvePiPackageRoot();
  const codingAgent = await import(pathToFileURL(join(root, "dist/index.js")).href);
  const interactive = await import(
    pathToFileURL(join(root, "dist/modes/interactive/interactive-mode.js")).href
  );
  return { codingAgent, InteractiveMode: interactive.InteractiveMode };
}

describe("extension lifecycle", () => {
  it("patches once on TUI session start and restores on reload", async () => {
    const { codingAgent, InteractiveMode } = await loadPiInternals();
    const extensionPath = join(
      process.cwd(),
      "extensions",
      "skill-conflict-filter.ts",
    );
    const original = InteractiveMode.prototype.showLoadedResources;
    const loaded = await codingAgent.discoverAndLoadExtensions(
      [extensionPath],
      process.cwd(),
    );

    assert.deepEqual(loaded.errors, []);
    const extension = loaded.extensions.find(
      (item) => item.resolvedPath === extensionPath,
    );
    assert.ok(extension);

    const starts = extension.handlers.get("session_start") ?? [];
    const shutdowns = extension.handlers.get("session_shutdown") ?? [];
    assert.equal(starts.length, 1);
    assert.equal(shutdowns.length, 1);

    const notifications = [];
    const ctx = {
      mode: "tui",
      hasUI: true,
      ui: {
        notify(message, level) {
          notifications.push({ message, level });
        },
      },
    };

    await starts[0]({ type: "session_start", reason: "startup" }, ctx);
    const patched = InteractiveMode.prototype.showLoadedResources;
    assert.notStrictEqual(patched, original);

    await starts[0]({ type: "session_start", reason: "new" }, ctx);
    assert.strictEqual(InteractiveMode.prototype.showLoadedResources, patched);
    assert.deepEqual(notifications, []);

    await shutdowns[0]({ type: "session_shutdown", reason: "reload" }, ctx);
    assert.strictEqual(InteractiveMode.prototype.showLoadedResources, original);
  });
});
