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
