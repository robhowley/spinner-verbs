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

  function randomVerbs(): string[] {
    const name = available[Math.floor(Math.random() * available.length)];
    return loadVerbs(name);
  }

  pi.registerFlag("verbs", {
    description: `Spinner verb list (${available.join(", ")})`,
    type: "string",
    default: DEFAULT,
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
    } catch {
      return undefined;
    }
  }

  function resolveVerbs(settingsPath: string): string[] | undefined {
    const settings = readSettings(settingsPath);
    if (!settings) return undefined;

    const named = settings.spinnerVerbs;
    if (typeof named === "string") {
      if (named === RANDOM) return randomVerbs();
      if (available.includes(named)) return loadVerbs(named);
    }

    const filePath = settings.spinnerVerbsFile;
    if (typeof filePath === "string") {
      const resolved = filePath.startsWith("~")
        ? join(homedir(), filePath.slice(1))
        : filePath.startsWith("/")
        ? filePath
        : join(dirname(settingsPath), filePath);
      if (existsSync(resolved)) {
        try {
          const verbs = parseVerbsData(JSON.parse(readFileSync(resolved, "utf-8")));
          if (verbs) return verbs;
        } catch {}
      }
    }

    return undefined;
  }

  pi.on("session_start", async (_event, ctx) => {
    const flag = pi.getFlag("--verbs") as string;
    const projectSettings = join(ctx.cwd, ".pi", "settings.json");
    const globalSettings = join(homedir(), ".pi", "agent", "settings.json");

    let verbs: string[] | undefined;
    let verbSetName: string | undefined;

    if (flag && flag !== DEFAULT) {
      if (flag === RANDOM) {
        verbs = randomVerbs();
        verbSetName = "random";
      }
      else if (available.includes(flag)) {
        verbs = loadVerbs(flag);
        verbSetName = flag;
      }
    }

    verbs ??= resolveVerbs(projectSettings) ?? resolveVerbs(globalSettings);

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
        const verbs = randomVerbs();
        activate(verbs, "random", ctx);
        ctx.ui.notify("Spinner: random", "info");
      } else {
        const verbs = loadVerbs(choice);
        activate(verbs, choice, ctx);
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
      
      const activeVerbSet = pi.getFlag("--verbs") as string;
      
      let currentVerbSet = "Unknown";
      if (activeVerbSetName) {
        currentVerbSet = activeVerbSetName;
      } else if (activeVerbSet && activeVerbSet !== "(default)") {
        currentVerbSet = activeVerbSet;
      } else if (activeVerbs) {
        // Try to determine the verb set name from the verbs
        const verbSetMap: Record<string, string> = {
          "Yippee-ki-yay": "action-movie",
          "double clicking": "corporate-jargon",
          "Shunting": "doc-emrick",
          "Taking the black": "game-of-thrones",
          "Come on down": "game-show",
          "One does not simply": "lord-of-the-rings",
          "Making moves": "momentum"
        };
        
        // Find a match from the first few verbs
        for (const [verb, set] of Object.entries(verbSetMap)) {
          if (activeVerbs.some(v => v.includes(verb))) {
            currentVerbSet = set;
            break;
          }
        }
      }
      
      const verbCount = activeVerbs?.length || 0;
      ctx.ui.notify(`Spinner active with ${verbCount} verbs from "${currentVerbSet}" set`, "info");
      ctx.ui.notify(`Available verb sets: ${available.join(", ")}`, "info");
    },
  });

  pi.on("session_shutdown", () => {
    clearInterval(interval);
  });
}