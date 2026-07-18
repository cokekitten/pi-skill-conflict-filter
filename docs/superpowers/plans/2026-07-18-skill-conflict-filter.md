# Pi Skill Collision Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建并全局安装一个只隐藏 Pi TUI 中同名 Skill collision、同时保留其他诊断的显示层扩展。

**Architecture:** 扩展动态导入 Pi 私有 `InteractiveMode`，patch `showLoadedResources()`。包装方法只在原渲染调用期间临时替换当前 `resourceLoader.getSkills()`，返回过滤 collision 后的浅拷贝，并在 `finally` 中恢复；真实 Skill、诊断源和非 TUI 模式不受影响。

**Tech Stack:** TypeScript Pi Extension、Node.js ESM、Node 内置 test/assert、`@earendil-works/pi-coding-agent`、Pi TUI 私有运行时模块。

## Global Constraints

- 仅过滤 `diagnostic.type === "collision" && diagnostic.collision.resourceType === "skill"`。
- 保留非 collision Skill 警告及所有 Prompt、Extension、Theme 诊断。
- 扩展只改变交互式 TUI 显示，不改变 Skill 加载结果、系统提示词、会话或 provider payload。
- 私有 API 不兼容时必须警告并降级，禁止阻止 Pi 启动。
- Patch 必须幂等，并在 `/reload` 与退出时尽力恢复。
- package 路径固定为 `/Users/cokekitten/dev/pi-skill-conflict-filter`。

---

## 文件结构

- `extensions/skill-conflict-filter.ts`：诊断过滤纯函数、渲染包装器、私有模块 patch 和 Pi 生命周期入口。
- `skill-conflict-filter.test.mjs`：纯过滤、包装恢复、真实 extension loader、patch 幂等和 cleanup 测试。
- `package.json`：Pi package manifest、peer dependency 与 test script。
- `README.md`：行为、安装方式、显示边界和私有 API 风险。
- `.gitignore`：忽略本地依赖与日志。
- `LICENSE`：MIT license。

### Task 1: 实现可测试的 collision 过滤与渲染包装器

**Files:**
- Create: `package.json`
- Create: `skill-conflict-filter.test.mjs`
- Create: `extensions/skill-conflict-filter.ts`

**Interfaces:**
- Produces: `filterSkillCollisionDiagnostics<T extends SkillsResult>(result: T): T`
- Produces: `createPatchedShowLoadedResources(original: ShowLoadedResources): ShowLoadedResources`
- Consumes: 当前 `InteractiveMode` 实例上的 `session.resourceLoader.getSkills()`。

- [ ] **Step 1: 创建 package manifest**

创建 `package.json`：

```json
{
  "name": "pi-skill-conflict-filter",
  "version": "0.1.0",
  "description": "A pi extension that hides duplicate skill collision diagnostics from the startup TUI.",
  "type": "module",
  "license": "MIT",
  "keywords": [
    "pi-package",
    "pi-extension",
    "skills",
    "tui"
  ],
  "scripts": {
    "test": "node --test skill-conflict-filter.test.mjs"
  },
  "pi": {
    "extensions": [
      "./extensions/skill-conflict-filter.ts"
    ]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "files": [
    "extensions/",
    "README.md",
    "LICENSE"
  ]
}
```

- [ ] **Step 2: 写过滤与包装器的失败测试**

创建 `skill-conflict-filter.test.mjs`，先只加入纯函数与 wrapper 测试：

```javascript
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
```

- [ ] **Step 3: 运行测试并确认按预期失败**

Run:

```bash
cd /Users/cokekitten/dev/pi-skill-conflict-filter
npm test
```

Expected: FAIL，错误指出 `extensions/skill-conflict-filter.ts` 不存在或未导出目标函数。

- [ ] **Step 4: 实现最小过滤与 wrapper**

创建 `extensions/skill-conflict-filter.ts`：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type SkillDiagnostic = {
  type?: string;
  collision?: {
    resourceType?: string;
  };
  [key: string]: unknown;
};

type SkillsResult = {
  skills: unknown[];
  diagnostics: SkillDiagnostic[];
};

type ResourceLoaderLike = {
  getSkills(): SkillsResult;
};

type InteractiveModeLike = {
  session?: {
    resourceLoader?: ResourceLoaderLike;
  };
};

export type ShowLoadedResources = (
  this: InteractiveModeLike,
  options?: unknown,
) => unknown;

export function filterSkillCollisionDiagnostics<T extends SkillsResult>(result: T): T {
  const diagnostics = result.diagnostics.filter(
    (diagnostic) =>
      !(
        diagnostic.type === "collision" &&
        diagnostic.collision?.resourceType === "skill"
      ),
  );

  if (diagnostics.length === result.diagnostics.length) return result;
  return { ...result, diagnostics };
}

export function createPatchedShowLoadedResources(
  original: ShowLoadedResources,
): ShowLoadedResources {
  return function patchedShowLoadedResources(this: InteractiveModeLike, options?: unknown) {
    const loader = this.session?.resourceLoader;
    if (!loader || typeof loader.getSkills !== "function") {
      return original.call(this, options);
    }

    const originalGetSkills = loader.getSkills;
    const ownDescriptor = Object.getOwnPropertyDescriptor(loader, "getSkills");
    const filteredGetSkills = function (this: ResourceLoaderLike): SkillsResult {
      return filterSkillCollisionDiagnostics(originalGetSkills.call(this));
    };

    try {
      Object.defineProperty(loader, "getSkills", {
        configurable: true,
        writable: true,
        value: filteredGetSkills,
      });
    } catch {
      return original.call(this, options);
    }

    try {
      return original.call(this, options);
    } finally {
      if (ownDescriptor) {
        Object.defineProperty(loader, "getSkills", ownDescriptor);
      } else {
        delete (loader as Partial<ResourceLoaderLike>).getSkills;
      }
    }
  };
}

export default function (_pi: ExtensionAPI) {
  // Patch lifecycle is added in Task 2.
}
```

- [ ] **Step 5: 运行测试并确认通过**

Run:

```bash
cd /Users/cokekitten/dev/pi-skill-conflict-filter
npm test
```

Expected: 4 tests PASS，0 FAIL。

- [ ] **Step 6: 提交 Task 1**

```bash
cd /Users/cokekitten/dev/pi-skill-conflict-filter
git add package.json skill-conflict-filter.test.mjs extensions/skill-conflict-filter.ts
git commit -m "feat: add skill collision rendering filter"
```

### Task 2: 安装幂等的 InteractiveMode lifecycle patch

**Files:**
- Modify: `extensions/skill-conflict-filter.ts`
- Modify: `skill-conflict-filter.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `createPatchedShowLoadedResources()`。
- Produces: `retainPatch(): Promise<() => Promise<void>>`。
- Produces: Extension `session_start` / `session_shutdown` handlers。

- [ ] **Step 1: 为真实 patch lifecycle 添加失败测试**

在 `skill-conflict-filter.test.mjs` 顶部增加导入：

```javascript
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
```

在文件末尾追加：

```javascript
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
```

- [ ] **Step 2: 运行测试并确认 lifecycle 测试失败**

Run:

```bash
cd /Users/cokekitten/dev/pi-skill-conflict-filter
npm test
```

Expected: 前 4 个测试 PASS，`extension lifecycle` FAIL，因为尚未注册 `session_start` / `session_shutdown`。

- [ ] **Step 3: 实现内部导入和 patch 引用计数**

在 `extensions/skill-conflict-filter.ts` 顶部补充：

```typescript
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
```

在 `createPatchedShowLoadedResources()` 后、default export 前加入：

```typescript
const INTERACTIVE_MODE_MODULE =
  "dist/modes/interactive/interactive-mode.js";
const STATE_KEY = Symbol.for("pi-skill-conflict-filter.state");

type InteractiveModePrototype = {
  showLoadedResources: ShowLoadedResources;
};

type PatchState = {
  refCount: number;
  cleanup?: (() => void) | undefined;
  installPromise?: Promise<() => void> | undefined;
  release?: (() => Promise<void>) | undefined;
};

function getState(): PatchState {
  const values = globalThis as typeof globalThis & {
    [STATE_KEY]?: PatchState;
  };
  values[STATE_KEY] ??= { refCount: 0 };
  return values[STATE_KEY];
}

function getPackageRoot(packageName: string): string {
  const entryPath = fileURLToPath(import.meta.resolve(packageName));
  return dirname(dirname(entryPath));
}

async function importInteractiveMode(): Promise<{
  prototype: InteractiveModePrototype;
}> {
  const root = getPackageRoot("@earendil-works/pi-coding-agent");
  const moduleUrl = pathToFileURL(join(root, INTERACTIVE_MODE_MODULE)).href;
  const module = (await import(moduleUrl)) as {
    InteractiveMode?: { prototype: InteractiveModePrototype };
  };
  if (!module.InteractiveMode?.prototype) {
    throw new Error("InteractiveMode missing");
  }
  return module.InteractiveMode;
}

async function installPatch(): Promise<() => void> {
  const InteractiveMode = await importInteractiveMode();
  const prototype = InteractiveMode.prototype;
  const original = prototype.showLoadedResources;
  if (typeof original !== "function") {
    throw new Error("InteractiveMode.showLoadedResources missing");
  }

  const patched = createPatchedShowLoadedResources(original);
  prototype.showLoadedResources = patched;

  return () => {
    if (prototype.showLoadedResources === patched) {
      prototype.showLoadedResources = original;
    }
  };
}

export async function retainPatch(): Promise<() => Promise<void>> {
  const state = getState();
  state.refCount++;

  let cleanup = state.cleanup;
  if (!cleanup) {
    const pending = state.installPromise ?? installPatch();
    state.installPromise = pending;
    try {
      cleanup = await pending;
      state.cleanup ??= cleanup;
    } catch (error) {
      state.refCount--;
      throw error;
    } finally {
      if (state.installPromise === pending) state.installPromise = undefined;
    }
  }

  let released = false;
  return async () => {
    if (released) return;
    state.refCount = Math.max(0, state.refCount - 1);
    released = true;
    if (state.refCount > 0) return;

    const currentCleanup = state.cleanup;
    state.cleanup = undefined;
    state.release = undefined;
    currentCleanup?.();
  };
}
```

- [ ] **Step 4: 实现 Extension 生命周期与降级通知**

将空的 default export 替换为：

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const state = getState();
    if (state.cleanup && state.release) return;

    try {
      state.release = await retainPatch();
    } catch (error) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `skill-conflict-filter: ${
            error instanceof Error ? error.message : String(error)
          }`,
          "warning",
        );
      }
    }
  });

  pi.on("session_shutdown", async (event) => {
    if (
      (event.reason === "reload" || event.reason === "quit") &&
      getState().release
    ) {
      await getState().release?.();
    }
  });
}
```

- [ ] **Step 5: 运行测试并确认全部通过**

Run:

```bash
cd /Users/cokekitten/dev/pi-skill-conflict-filter
npm test
```

Expected: 5 tests PASS，0 FAIL，且没有 warning notification。

- [ ] **Step 6: 提交 Task 2**

```bash
cd /Users/cokekitten/dev/pi-skill-conflict-filter
git add extensions/skill-conflict-filter.ts skill-conflict-filter.test.mjs
git commit -m "feat: patch Pi startup skill diagnostics"
```

### Task 3: 完成文档、安装和真实启动验证

**Files:**
- Create: `README.md`
- Create: `.gitignore`
- Create: `LICENSE`
- Modify: `~/.pi/agent/settings.json`（由 `pi install` 管理）

**Interfaces:**
- Consumes: Task 2 完成的 Pi package。
- Produces: 全局安装的本地 package `pi-skill-conflict-filter`。

- [ ] **Step 1: 创建项目辅助文件**

创建 `.gitignore`：

```gitignore
node_modules/
*.log
.DS_Store
```

创建 `LICENSE`，使用标准 MIT License，copyright 行写：

```text
Copyright (c) 2026 cokekitten
```

- [ ] **Step 2: 编写 README**

创建 `README.md`：

```markdown
# pi-skill-conflict-filter

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that hides duplicate Skill collision diagnostics from the interactive startup TUI.

## Behavior

- Hides only diagnostics where `type` is `collision` and `resourceType` is `skill`.
- Keeps invalid Skill metadata/path warnings visible.
- Keeps Prompt, Extension, and Theme diagnostics visible.
- Changes display only; Skill discovery, precedence, loaded content, sessions, and model context are untouched.

## Install

```bash
pi install /path/to/pi-skill-conflict-filter
```

Restart pi or run `/reload`.

## Development

```bash
npm test
pi -e /path/to/pi-skill-conflict-filter
```

## Compatibility

This extension monkey-patches Pi's private `InteractiveMode.prototype.showLoadedResources` method. It fails open and shows a warning if Pi changes the internal module path or method, but a Pi upgrade may still require an extension update.

## License

MIT
```

- [ ] **Step 3: 执行完整测试与仓库检查**

Run:

```bash
cd /Users/cokekitten/dev/pi-skill-conflict-filter
npm test
git status --short
```

Expected: 5 tests PASS；`git status --short` 仅列出 `README.md`、`.gitignore`、`LICENSE`。

- [ ] **Step 4: 提交文档**

```bash
cd /Users/cokekitten/dev/pi-skill-conflict-filter
git add README.md .gitignore LICENSE
git commit -m "docs: document extension installation"
```

- [ ] **Step 5: 全局安装本地 package**

Run:

```bash
pi install /Users/cokekitten/dev/pi-skill-conflict-filter
```

Expected: Pi 把该本地 package 加入 `~/.pi/agent/settings.json`，安装命令成功退出。

- [ ] **Step 6: 用伪终端执行真实启动 smoke test**

从存在全局/项目同名 Skill 的 Sunrise 仓库启动两次 Pi：先用 `--no-extensions` 证明基线会显示冲突，再启用扩展证明冲突被隐藏。两次启动都在初始渲染后发送 Ctrl+D：

```bash
python3 - <<'PY'
import os
import pty
import select
import subprocess
import time

CWD = "/Users/cokekitten/dev/sunrise"


def capture(args):
    master, slave = pty.openpty()
    proc = subprocess.Popen(
        args,
        cwd=CWD,
        stdin=slave,
        stdout=slave,
        stderr=slave,
        close_fds=True,
    )
    os.close(slave)
    output = bytearray()
    deadline = time.time() + 8
    sent_exit = False

    while time.time() < deadline:
        ready, _, _ = select.select([master], [], [], 0.2)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            output.extend(chunk)
        if not sent_exit and time.time() + 6 >= deadline:
            os.write(master, b"\x04")
            sent_exit = True
        if proc.poll() is not None:
            break

    if proc.poll() is None:
        proc.terminate()
        proc.wait(timeout=3)
    os.close(master)
    return output.decode("utf-8", errors="replace")


baseline = capture(["pi", "--no-extensions"])
filtered = capture(["pi"])
open("/tmp/pi-skill-conflict-filter-baseline.log", "w").write(baseline)
open("/tmp/pi-skill-conflict-filter-smoke.log", "w").write(filtered)
assert "[Skill conflicts]" in baseline, "baseline did not expose the expected conflicts"
assert "[Skill conflicts]" not in filtered, filtered
print("startup smoke passed: baseline visible, extension hidden")
PY
```

Expected: 输出 `startup smoke passed: baseline visible, extension hidden`；两份完整 ANSI 捕获分别保存在 `/tmp/pi-skill-conflict-filter-baseline.log` 与 `/tmp/pi-skill-conflict-filter-smoke.log`。

- [ ] **Step 7: 最终验证**

Run:

```bash
cd /Users/cokekitten/dev/pi-skill-conflict-filter
npm test
git status --short --branch
python3 -m json.tool /Users/cokekitten/.pi/agent/settings.json >/dev/null
```

Expected: tests 0 FAIL；仓库为 `## main` 且无未提交文件；全局 settings JSON 有效。
