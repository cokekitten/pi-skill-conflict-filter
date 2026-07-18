import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
