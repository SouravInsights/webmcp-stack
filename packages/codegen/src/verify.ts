/**
 * The verify command: the tool standard, measured locally.
 *
 * Why this exists: a generated surface's quality was only ever discovered
 * after deploy, by an external audit reading the page's registry. Verify runs
 * the same rubric over the tools a run would register — name shape, what the
 * description covers, field text, annotations, surface size — and prints a
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
 * Walk every input field of a schema — nested objects and array items, two
 * levels down, mirroring the describe layer's coverage — and run `visit` on
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
export function verifyTools(tools: ReviewedTool[]): VerifyCheck[] {
  const registered = tools.filter((tool) => !tool.withheld);

  const longNames = registered
    .filter((tool) => tool.name.length > NAME_MAX)
    .map(
      (tool) => `${tool.name} (${tool.name.length} chars) — rename it in the dashboard or config.`,
    );
  const longParamNames: string[] = [];
  const longParamDescriptions: string[] = [];
  for (const tool of registered) {
    eachField(tool.inputSchema, 0, (name, description) => {
      if (name.length > PARAM_NAME_MAX) {
        longParamNames.push(
          `${tool.name} → ${name} (${name.length} chars) — parameter names max ${PARAM_NAME_MAX}.`,
        );
      }
      if (description && description.length > FIELD_DESCRIPTION_MAX) {
        longParamDescriptions.push(
          `${tool.name} → ${name} (${description.length} chars) — over the ${FIELD_DESCRIPTION_MAX}-character parameter budget; tighten it.`,
        );
      }
    });
  }
  const nonVerb = registered
    .filter((tool) => !KNOWN_VERBS.has(tool.name.split("-")[0] ?? ""))
    .map((tool) => `${tool.name} — agents pick tools by their first word; lead with the action.`);

  const longDescriptions = registered
    .filter((tool) => tool.description && tool.description.length > TOOL_DESCRIPTION_MAX)
    .map(
      (tool) =>
        `${tool.name} (${tool.description.length} chars) — over the ${TOOL_DESCRIPTION_MAX}-character tool budget; tighten it.`,
    );

  const noDescription = registered
    .filter((tool) => !tool.description || tool.description.trim() === "")
    .map((tool) => `${tool.name} — no description; the tool is invisible to agents.`);
  const templateDescription = registered
    .filter((tool) => tool.descriptionSource === "generated-template")
    .map((tool) => `${tool.name} — description is a machine draft; write the real one.`);
  const noReturnShape = registered
    .filter(
      (tool) => tool.outputSchema && tool.description && !RETURN_LANGUAGE.test(tool.description),
    )
    .map((tool) => `${tool.name} — the description never says what comes back.`);

  const bareFields = registered
    .filter((tool) => hasBareField(tool.inputSchema, 0))
    .map((tool) => `${tool.name} — an input field has no description an agent can act on.`);

  const readWithoutHint = registered
    .filter((tool) => tool.sideEffect === "read" && !tool.hints.readOnlyHint)
    .map((tool) => `${tool.name} — a read without readOnlyHint looks unsafe to call.`);

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

  // The character budgets are errors: they exist to keep tool text inside
  // agent guardrails, and CI gates on them (generation already composes
  // within budget, so offenders here are hand-written or overrides).
  const budgetOffenders = [...longDescriptions, ...longParamDescriptions];
  if (budgetOffenders.length > 0) {
    checks.push({
      area: "Budgets",
      summary: `${budgetOffenders.length} over budget`,
      findings: budgetOffenders,
      level: "error",
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

  if (registered.length > 25) {
    checks.push({
      area: "Surface",
      summary: `${registered.length} registered`,
      findings: [
        `${registered.length} tools register on this surface — agents choose measurably worse past a handful. ` +
          "Withhold unreviewed tools, or narrow with safety.exclude.",
      ],
      level: "warning",
    });
  }

  return checks;
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
