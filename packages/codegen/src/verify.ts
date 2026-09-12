/**
 * The verify command: the tool standard, measured locally.
 *
 * Why this exists: a generated surface's quality was only ever discovered
 * after deploy, by an external audit reading the page's registry. Verify runs
 * the same rubric over the tools a run would register - name shape, what the
 * description covers, field text, annotations, surface size - and prints a
 * scorecard before anything ships.
 *
 * The checks are deterministic: same tools in, same verdict out, no key, no
 * network (except the explicit --url probe). It exits 1 on error-level
 * findings so CI can gate on it.
 */

import { FIELD_DESCRIPTION_MAX, TOOL_DESCRIPTION_MAX } from "./describe.js";
import type { AuditFinding, ReviewedTool } from "./types.js";

/** Chrome's published guidance for tool names. */
const NAME_MAX = 30;

/** Chrome's budget for parameter names (same as tool names). */
const PARAM_NAME_MAX = 30;

/** Verbs a good tool name starts with. Method verbs plus the action words
 *  the naming algorithm knows; the list lives here because verify's whole
 *  job is judging names from the outside. */
const KNOWN_VERBS = new Set([
  "accept",
  "activate",
  "add",
  "approve",
  "archive",
  "bookmark",
  "cancel",
  "check",
  "claim",
  "clone",
  "close",
  "complete",
  "confirm",
  "copy",
  "create",
  "decline",
  "delete",
  "deploy",
  "disable",
  "download",
  "duplicate",
  "enable",
  "execute",
  "export",
  "generate",
  "get",
  "import",
  "invite",
  "join",
  "leave",
  "list",
  "lock",
  "login",
  "logout",
  "log-in",
  "log-out",
  "merge",
  "migrate",
  "move",
  "notify",
  "open",
  "pin",
  "process",
  "publish",
  "redeem",
  "refresh",
  "register",
  "reject",
  "reopen",
  "resend",
  "reset",
  "restore",
  "retry",
  "revoke",
  "rollback",
  "run",
  "save",
  "search",
  "send",
  "share",
  "sign-up",
  "sign-in",
  "sign-out",
  "split",
  "start",
  "stop",
  "submit",
  "sync",
  "trigger",
  "unarchive",
  "unbookmark",
  "unlock",
  "unpin",
  "unpublish",
  "unregister",
  "update",
  "upload",
  "validate",
  "verify",
]);

/** Words that mean a description covers what comes back. Mirrors describe.ts. */
const RETURN_LANGUAGE =
  /\b(returns?|response|responds?|yields?|gives? back|provides?|contains?)\b/i;

export interface VerifyCheck {
  /** The standard's area, e.g. "Names". */
  area: string;
  /** What passed or failed, as a sentence. */
  summary: string;
  /** One line per offender, each ending in what to do. */
  findings: string[];
  level: "ok" | "warning" | "error";
}

function check(area: string, offenders: string[], okText: string): VerifyCheck {
  return {
    area,
    summary:
      offenders.length === 0
        ? okText
        : `${offenders.length} problem${offenders.length === 1 ? "" : "s"}`,
    findings: offenders,
    level: offenders.length === 0 ? "ok" : "warning",
  };
}

/**
 * Walk every input field of a schema - nested objects and array items, two
 * levels down, mirroring the describe layer's coverage - and run `visit` on
 * each name and its text.
 */
function eachField(
  schema: {
    properties?: Record<string, { description?: unknown }>;
    items?: unknown;
  },
  depth: number,
  visit: (name: string, description: string | undefined) => void,
): void {
  if (depth > 2) return;
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    visit(name, typeof field.description === "string" ? field.description : undefined);
    eachField(field as typeof schema, depth + 1, visit);
    const items = (field as { items?: unknown }).items;
    if (items && typeof items === "object") eachField(items as typeof schema, depth + 1, visit);
  }
}

/** True when any field (including nested ones, two levels down) lacks text.
 *  The root schema is the object itself, not a field, so it is not checked. */
function hasBareField(
  schema: {
    description?: string;
    properties?: Record<string, unknown>;
    items?: unknown;
  },
  depth: number,
): boolean {
  if (depth > 2) return false;
  if (depth > 0 && (typeof schema.description !== "string" || schema.description.trim() === "")) {
    return true;
  }
  for (const prop of Object.values(schema.properties ?? {})) {
    if (hasBareField(prop as typeof schema, depth + 1)) return true;
  }
  const items = schema.items;
  if (items && typeof items === "object") {
    if (hasBareField(items as typeof schema, depth + 1)) return true;
  }
  return false;
}

/**
 * Run the rubric over the tools a generate run would produce. The standard
 * each check serves is named in its area, so the scorecard maps to the
 * design doc's table without translation.
 */
export function verifyTools(
  tools: ReviewedTool[],
  options?: { journeyToolCount?: number },
): VerifyCheck[] {
  const registered = tools.filter((tool) => !tool.withheld);

  const longNames = registered
    .filter((tool) => tool.name.length > NAME_MAX)
    .map(
      (tool) => `${tool.name} (${tool.name.length} chars) - rename it in the dashboard or config.`,
    );
  const longParamNames: string[] = [];
  const longParamDescriptions: string[] = [];
  for (const tool of registered) {
    eachField(tool.inputSchema, 0, (name, description) => {
      if (name.length > PARAM_NAME_MAX) {
        longParamNames.push(
          `${tool.name} -> ${name} (${name.length} chars) - parameter names max ${PARAM_NAME_MAX}.`,
        );
      }
      if (description && description.length > FIELD_DESCRIPTION_MAX) {
        longParamDescriptions.push(
          `${tool.name} -> ${name} (${description.length} chars) - over the ${FIELD_DESCRIPTION_MAX}-character parameter budget; tighten it.`,
        );
      }
    });
  }
  const nonVerb = registered
    .filter((tool) => !KNOWN_VERBS.has(tool.name.split("-")[0] ?? ""))
    .map((tool) => `${tool.name} - agents pick tools by their first word; lead with the action.`);

  const longDescriptions = registered
    .filter((tool) => tool.description && tool.description.length > TOOL_DESCRIPTION_MAX)
    .map(
      (tool) =>
        `${tool.name} (${tool.description.length} chars) - over the ${TOOL_DESCRIPTION_MAX}-character tool budget; tighten it.`,
    );

  const noDescription = registered
    .filter((tool) => !tool.description || tool.description.trim() === "")
    .map((tool) => `${tool.name} - no description; the tool is invisible to agents.`);
  const templateDescription = registered
    .filter((tool) => tool.descriptionSource === "generated-template")
    .map((tool) => `${tool.name} - description is a machine draft; write the real one.`);
  const noReturnShape = registered
    .filter(
      (tool) => tool.outputSchema && tool.description && !RETURN_LANGUAGE.test(tool.description),
    )
    .map((tool) => `${tool.name} - the description never says what comes back.`);

  const bareFields = registered
    .filter((tool) => hasBareField(tool.inputSchema, 0))
    .map((tool) => `${tool.name} - an input field has no description an agent can act on.`);

  const readWithoutHint = registered
    .filter((tool) => tool.sideEffect === "read" && !tool.hints.readOnlyHint)
    .map((tool) => `${tool.name} - a read without readOnlyHint looks unsafe to call.`);

  const checks: VerifyCheck[] = [
    check(
      "Names",
      [...longNames, ...longParamNames, ...nonVerb],
      `all ${registered.length} names within 30 characters, verb-first`,
    ),
    check(
      "Descriptions",
      [...templateDescription, ...noReturnShape],
      "every description says what the tool does and returns",
    ),
    check("Fields", bareFields, "every input field described, nested ones included"),
    check("Annotations", readWithoutHint, "reads declare readOnlyHint; content declares its trust"),
  ];

  // Chrome's character budgets are authoring guidance, not spec rules: the
  // browser only rejects an empty description or a bad name. So an overrun is
  // a warning that points at a shorter rewrite, never an error that blocks CI.
  // (A long description is a quality smell, not a broken tool.)
  const budgetOffenders = [...longDescriptions, ...longParamDescriptions];
  if (budgetOffenders.length > 0) {
    checks.push({
      area: "Budgets",
      summary: `${budgetOffenders.length} over budget`,
      findings: budgetOffenders,
      level: "warning",
    });
  }

  // Missing descriptions are the one error: the audit treats them as fatal,
  // and so do we.
  if (noDescription.length > 0) {
    checks.push({
      area: "Descriptions",
      summary: `${noDescription.length} missing`,
      findings: noDescription,
      level: "error",
    });
  }

  // Journey tools register at runtime, so they are counted by the caller and
  // passed in: the surface an agent actually sees is endpoint tools plus
  // journey steps plus their submit gates. Missing this would let a journey
  // quietly grow the surface past the budget the docs promise is watched.
  const journeyToolCount = options?.journeyToolCount ?? 0;
  const surfaceTotal = registered.length + journeyToolCount;
  if (surfaceTotal > 25) {
    const breakdown =
      journeyToolCount > 0
        ? `${registered.length} endpoint and ${journeyToolCount} journey`
        : `${registered.length}`;
    checks.push({
      area: "Surface",
      summary: `${surfaceTotal} registered (${breakdown})`,
      findings: [
        `${surfaceTotal} tools register on this surface (${breakdown}) - agents choose measurably worse past a handful. ` +
          "Withhold unreviewed tools, split journeys, or narrow with safety.exclude.",
      ],
      level: "warning",
    });
  }

  return checks;
}

/**
 * The top-level keys of an inline object literal's `steps: { ... }` block,
 * found by brace matching rather than parsing (journey files are the user's
 * TypeScript; a full parse is out of scope for a lint). Used to count steps.
 */
function journeyStepNames(contents: string): string[] {
  const start = /steps\s*:\s*\{/.exec(contents);
  if (!start) return [];
  let depth = 0;
  let bodyStart = -1;
  let bodyEnd = -1;
  for (let i = start.index + start[0].length - 1; i < contents.length; i++) {
    const char = contents[i];
    if (char === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }
  if (bodyStart === -1 || bodyEnd === -1) return [];
  const body = contents.slice(bodyStart, bodyEnd);
  // Keys at depth one: "search-places": { ... }. The sticky regex anchors at
  // the first non-space character after the walk position, and the walk
  // skips past each match, so a key is counted exactly once.
  const names: string[] = [];
  const keyPattern = /"([^"]+)"\s*:\s*\{/y;
  let innerDepth = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "{") {
      innerDepth++;
      continue;
    }
    if (char === "}") {
      innerDepth--;
      continue;
    }
    if (innerDepth !== 0) continue;
    let cursor = i;
    while (cursor < body.length && /\s/.test(body[cursor] ?? "")) cursor++;
    keyPattern.lastIndex = cursor;
    const keyMatch = keyPattern.exec(body);
    if (keyMatch) {
      names.push(keyMatch[1] ?? "");
      // The match consumed the step's opening brace - count it, since the
      // walk skips past the whole match including that brace.
      innerDepth++;
      i = cursor + keyMatch[0].length - 1;
    }
  }
  return names;
}

/** A journey definition file from the tools directory's journeys/ folder. */
export interface JourneyFileInput {
  path: string;
  contents: string;
}

/**
 * The journey checks, over the user's journey files (not the generated
 * tools). Structural problems (no createJourney, no submit gate, missing
 * run) and over-budget descriptions are errors; step count and bypassing
 * the generated callers are warnings. Journey files are the user's agent's
 * code, so findings name the fix, not just the smell.
 */
export function verifyJourneyFiles(files: JourneyFileInput[]): VerifyCheck[] {
  const structural: string[] = [];
  const budget: string[] = [];
  const warnings: string[] = [];

  for (const { path, contents } of files) {
    if (!/createJourney\s*\(/.test(contents)) {
      structural.push(
        `${path} - no createJourney() call; files in journeys/ must define a journey.`,
      );
      continue;
    }
    if (!/submit\s*:/.test(contents) || !/run\s*:/.test(contents)) {
      structural.push(
        `${path} - no submit gate with a run; a journey without one is just loose tools.`,
      );
    }
    const steps = journeyStepNames(contents);
    if (steps.length > 5) {
      warnings.push(
        `${path} - ${steps.length} steps; past five, agents lose the thread. Split it into two journeys.`,
      );
    }
    for (const match of contents.matchAll(/description\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      const text = match[1] ?? "";
      if (text.length > TOOL_DESCRIPTION_MAX) {
        budget.push(
          `${path} - a description runs ${text.length} characters (max ${TOOL_DESCRIPTION_MAX}); tighten it.`,
        );
      }
    }
    const withoutImports = contents.replace(/^\s*import\s.*$/gm, "");
    if (/\b(?:fetch|callApi)\s*\(/.test(withoutImports)) {
      warnings.push(
        `${path} - calls fetch/callApi directly; use the generated raw callers (fetchX) or a tool's execute, so the contract lives in one place.`,
      );
    }
  }

  const checks: VerifyCheck[] = [];
  if (structural.length > 0) {
    checks.push({
      area: "Journeys",
      summary: `${structural.length} structural problem${structural.length === 1 ? "" : "s"}`,
      findings: structural,
      level: "error",
    });
  }
  if (budget.length > 0) {
    checks.push({
      area: "Journeys",
      summary: `${budget.length} over budget`,
      findings: budget,
      level: "warning",
    });
  }
  if (warnings.length > 0) {
    checks.push({
      area: "Journeys",
      summary: `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`,
      findings: warnings,
      level: "warning",
    });
  }
  if (checks.length === 0 && files.length > 0) {
    checks.push({
      area: "Journeys",
      summary: `${files.length} journey file${files.length === 1 ? "" : "s"}, gates and budgets in order`,
      findings: [],
      level: "ok",
    });
  }
  return checks;
}

/**
 * How many tools a set of journey files registers on the page: one per step
 * plus the submit gate. Used by the surface check, because these tools are
 * created at runtime and never pass through the pipeline's tool list.
 */
export function countJourneyTools(files: JourneyFileInput[]): number {
  let count = 0;
  for (const { contents } of files) {
    if (!/createJourney\s*\(/.test(contents)) continue;
    count += journeyStepNames(contents).length + 1;
  }
  return count;
}

/** The --url probe: is the page actually live for a visitor's browser? */
export async function verifyUrl(url: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  let html: string;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      return [
        {
          level: "warning",
          message: `${url} answered ${response.status}. The page checks could not run.`,
        },
      ];
    }
    html = await response.text();
  } catch {
    return [
      {
        level: "warning",
        message: `${url} could not be reached. The page checks could not run.`,
      },
    ];
  }

  if (!html.includes('http-equiv="origin-trial"') && !html.includes("http-equiv='origin-trial'")) {
    findings.push({
      level: "warning",
      message:
        "No origin trial token found on the page. Tools register for tooling and " +
        "audits, but a visitor's Chrome leaves WebMCP off without one. Get a token " +
        "from Chrome's origin trials and serve it in a meta tag.",
    });
  }
  return findings;
}
