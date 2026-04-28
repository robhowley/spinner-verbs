import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export default function (pi: ExtensionAPI) {
  const dir = dirname(fileURLToPath(import.meta.url));
  const verbsDir = join(dir, "..", "spinner-verbs");

  const available = readdirSync(verbsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => basename(f, ".json"));

  const DEFAULT = "(default)";
  const RANDOM = "random";
  const availableWithDefault = [...available, RANDOM, DEFAULT];
  const validChoices = new Set(availableWithDefault);

  function parseVerbsData(data: unknown): string[] | undefined {
    return Array.isArray(data) && data.length > 0 ? data : undefined;
  }

  function loadVerbs(name: string): string[] {
    const data = JSON.parse(readFileSync(join(verbsDir, `${name}.json`), "utf-8"));
    const verbs = parseVerbsData(data);
    if (!verbs) throw new Error(`Failed to parse verbs from ${name}.json`);
    return verbs;
  }

  function randomVerbs(): { verbs: string[], setName: string } {
    const name = available[Math.floor(Math.random() * available.length)];
    return { verbs: loadVerbs(name), setName: name };
  }

  pi.registerFlag("verbs", {
    description: `Spinner verb list (${available.join(", ")})`,
    type: "string",
    default: undefined,
  });

  let interval: ReturnType<typeof setInterval> | undefined;
  let activeVerbs: string[] | undefined;
  let activeVerbSetName: string | undefined;

  function activate(verbs: string[], verbSetName: string | undefined, ctx: ExtensionContext) {
    clearInterval(interval);
    activeVerbs = verbs;
    activeVerbSetName = verbSetName;
    const tick = () => ctx.ui.setWorkingMessage(`${verbs[Math.floor(Math.random() * verbs.length)]}...`);
    tick();
    interval = setInterval(tick, 3000);
  }

  function readSettings(settingsPath: string): Record<string, unknown> | undefined {
    if (!existsSync(settingsPath)) return undefined;
    try {
      return JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch (error) {
      // Log error for debugging but continue gracefully
      return undefined;
    }
  }

  function getSpinnerVerbsValue(source: string | undefined, projectSettings: string | undefined, globalSettings: string | undefined): unknown {
  // Coalesce: flag -> project settings -> global settings
  const projectSpinnerVerbs = projectSettings ? readSettings(projectSettings)?.spinnerVerbs : undefined;
  const globalSpinnerVerbs = globalSettings ? readSettings(globalSettings)?.spinnerVerbs : undefined;
  
  return source ?? projectSpinnerVerbs ?? globalSpinnerVerbs;
}

function getSpinnerVerbsFileValue(projectSettings: string | undefined, globalSettings: string | undefined): string | undefined {
  // Coalesce: project settings -> global settings
  const projectSpinnerVerbsFile = projectSettings ? readSettings(projectSettings)?.spinnerVerbsFile : undefined;
  const globalSpinnerVerbsFile = globalSettings ? readSettings(globalSettings)?.spinnerVerbsFile : undefined;
  
  return projectSpinnerVerbsFile ?? globalSpinnerVerbsFile;
}

function loadVerbsFromSource(source: string | undefined, projectSettings: string | undefined, globalSettings: string | undefined): { verbs: string[], verbSetName: string | undefined } {
    // Handle string source (named set or random)
    if (typeof source === "string") {
      if (source === RANDOM) {
        const result = randomVerbs();
        return { verbs: result.verbs, verbSetName: result.setName };
      } else if (available.includes(source)) {
        return { verbs: loadVerbs(source), verbSetName: source };
      }
    }
    
    // Get the spinnerVerbs value from coalesced sources
    const spinnerVerbsValue = getSpinnerVerbsValue(source, projectSettings, globalSettings);
    
    if (typeof spinnerVerbsValue === "string") {
      if (spinnerVerbsValue === RANDOM) {
        const result = randomVerbs();
        return { verbs: result.verbs, verbSetName: result.setName };
      } else if (available.includes(spinnerVerbsValue)) {
        return { verbs: loadVerbs(spinnerVerbsValue), verbSetName: spinnerVerbsValue };
      }
    }
    
    // Handle custom file if spinnerVerbsFile key exists
    const spinnerVerbsFileValue = getSpinnerVerbsFileValue(projectSettings, globalSettings);
    
    if (typeof spinnerVerbsFileValue === "string") {
      const resolved = resolveFilePath(spinnerVerbsFileValue, projectSettings || "");
      if (existsSync(resolved)) {
        try {
          const fileVerbs = parseVerbsData(JSON.parse(readFileSync(resolved, "utf-8")));
          if (fileVerbs) {
            return { verbs: fileVerbs, verbSetName: undefined };
          }
        } catch (error) {
          console.error(`Failed to parse verbs from file ${resolved}:`, error);
          return { verbs: undefined, verbSetName: undefined };
        }
      }
    }
    
    return { verbs: undefined, verbSetName: undefined };
  }

  function resolveFilePath(filePath: string, projectSettings: string): string {
    if (filePath.startsWith("~")) {
      return join(homedir(), filePath.slice(1));
    } else if (filePath.startsWith("/")) {
      return filePath;
    } else {
      return join(dirname(projectSettings), filePath);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    const flag = pi.getFlag("verbs") as string;
    const projectSettings = join(ctx.cwd, ".pi", "settings.json");
    const globalSettings = join(homedir(), ".pi", "agent", "settings.json");

    let verbs: string[] | undefined;
    let verbSetName: string | undefined;

    // Normalize flag - if it's invalid, set it to undefined and notify user
    let normalizedFlag = flag;
    if (flag && !validChoices.has(flag)) {
      ctx.ui.notify(`Invalid verb set: ${flag}. Available: ${availableWithDefault.join(", ")}`, "error");
      normalizedFlag = undefined;
    }

    // Load from normalized flag or settings using centralized function
    const result = loadVerbsFromSource(normalizedFlag, projectSettings, globalSettings);
    verbs = result.verbs;
    verbSetName = result.verbSetName;

    if (verbs) activate(verbs, verbSetName, ctx);
  });

  pi.registerCommand("verbs", {
    description: "Choose spinner verb list",
    getArgumentCompletions: (prefix: string) => {
      const matches = availableWithDefault
        .filter((v) => v.startsWith(prefix))
        .map((v) => ({ value: v, label: v }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      const arg = args?.trim();
      if (arg && !validChoices.has(arg)) {
        ctx.ui.notify(`Unknown verb list: ${arg}. Available: ${availableWithDefault.join(", ")}`, "error");
        return;
      }
      const choice = arg || await ctx.ui.select("Spinner verbs:", availableWithDefault);
      if (!choice) return;
      if (choice === DEFAULT) {
        clearInterval(interval);
        ctx.ui.setWorkingMessage();
        ctx.ui.notify("Restored default spinner", "info");
      } else if (choice === RANDOM) {
        const result = loadVerbsFromSource(choice, undefined, undefined);
        activate(result.verbs, result.verbSetName, ctx);
        ctx.ui.notify("Spinner: random", "info");
      } else {
        // For direct verb selection, we don't have settings context so we'll use undefined
        const result = loadVerbsFromSource(choice, undefined, undefined);
        activate(result.verbs, result.verbSetName, ctx);
        ctx.ui.notify(`Spinner: ${choice}`, "info");
      }
    },
  });

  pi.registerCommand("verb-status", {
    description: "Show current spinner verb status",
    handler: async (_args, ctx) => {
      if (!interval) {
        ctx.ui.notify("No spinner active. Use /verbs to set one.", "info");
        return;
      }

      let currentVerbSet = "Unknown";
      if (activeVerbSetName) {
        currentVerbSet = activeVerbSetName;
      } else if (pi.getFlag("--verbs") as string !== DEFAULT) {
        currentVerbSet = pi.getFlag("--verbs") as string;
      }

      const verbCount = activeVerbs?.length || 0;
      const message = `Spinner active with ${verbCount} verbs from "${currentVerbSet}" set\nAvailable verb sets: ${available.join(", ")}`;
      ctx.ui.notify(message, "info");
    },
  });

  pi.on("session_shutdown", () => {
    clearInterval(interval);
  });
}