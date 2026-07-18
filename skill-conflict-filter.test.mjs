import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
