/**
 * The safety layer.
 *
 * Nothing gets written to disk until every candidate tool has been through
 * here. This layer does three jobs:
 *
 *   1. Classify: what does calling this tool do to the world?
 *      (read / write / destructive, from the HTTP verb plus name heuristics)
 *   2. Hint:     derive the WebMCP tool hints (readOnlyHint etc.) from that
 *   3. Audit:    lint the result and report problems in plain language
 *
 * Every rule is a heuristic with an escape hatch: the generated code carries
 * the classification in plain sight, and the developer owns the final file.
 */

import type {
  AuditFinding,
  CandidateTool,
  EndpointRole,
  JsonSchema,
  ReviewedTool,
  RiskTier,
  SafetyOptions,
  SideEffect,
  SkippedEndpoint,
  ToolHints,
} from "./types.js";

/**
 * Words that signal "this changes something the user can't easily undo",
 * even when the HTTP verb looks innocent. `POST /orders/{id}/cancel` is the
 * classic case: a POST that behaves like a DELETE.
 */
const DESTRUCTIVE_WORDS =
  /\b(cancel|delete|remove|destroy|deactivate|refund|revoke|purge|close)\b/i;

/**
 * Words that mark a POST as a read in disguise. Plenty of real APIs search
 * with POST because the filter object is too big for a query string
 * (`POST /search`, `POST /estimate`). These get read treatment: enabled by
 * default, readOnlyHint set.
 *
 * Matched per dash-separated segment, so both route-derived names
 * ("post-search") and operationId-derived names ("search-assets") qualify,
 * while "blacklist-items" does not.
 */
const READING_POST_WORDS = new Set([
  "search",
  "query",
  "list",
  "find",
  "filter",
  "estimate",
  "preview",
  "validate",
  "check",
  "lookup",
  "autocomplete",
  "suggest",
]);

/** True when the tool's name contains a reading word as a whole segment. */
function nameSaysRead(toolName: string): boolean {
  return toolName.split("-").some((segment) => READING_POST_WORDS.has(segment));
}

/** Endpoints that receive server callbacks. An agent has nothing to call. */
const WEBHOOK_PATTERN = /\bwebhooks?\b/i;

/** Sign-in, session, and credential endpoints. Agents should not drive auth. */
const AUTH_PATTERN =
  /\b(auth|signin|sign-in|login|log-in|logout|log-out|oauth|password|credential|session)s?\b/i;

/** Admin endpoints. Exposing them to agents is a deliberate decision. */
const ADMIN_PATTERN = /\badmin\b/i;

/** Past this many tools the surface is a catalog, not a toolkit (the audit
 *  warns once per run). Roughly double what an agent holds comfortably. */
const TOOL_COUNT_SOFT_LIMIT = 25;

/**
 * Field names that usually hold personal data or secrets. Matched against
 * the last segment of a field path, case-insensitively. Teams extend this
 * list via `safety.piiFields` in the config.
 */
const DEFAULT_PII_FIELDS = [
  "password",
  "ssn",
  "token",
  "secret",
  "apikey",
  "api_key",
  "email",
  "dob",
  "birthdate",
  "phone",
  "address",
  "creditcard",
  "cardnumber",
  "cvv",
];

/**
 * Phrases that suggest a description is trying to *instruct the agent*
 * instead of describing the tool. That is a known prompt-injection smell.
 */
const AGENT_INSTRUCTION_PATTERN =
  /\b(you (must|should|always|are)|as an ai|ignore (all |previous )?instructions|do not refuse)\b/i;

/** Step 1: classify what calling the tool does. */
export function classifySideEffect(tool: CandidateTool): SideEffect {
  if (!tool.httpMethod) {
    // Schema-declared tools carry no verb, so the name carries the signal.
    // The default for an unknown action is write (generated disabled,
    // confirmation on): an action we cannot classify is never treated as safe.
    if (nameSaysRead(tool.name)) return "read";
    return DESTRUCTIVE_WORDS.test(tool.name) ? "destructive" : "write";
  }
  switch (tool.httpMethod) {
    case "GET":
    case "HEAD":
    case "OPTIONS":
      // A safe verb whose name says otherwise is suspicious; audit flags it.
      return "read";
    case "DELETE":
      return "destructive";
    case "POST":
      // A POST whose name is a reading word ("search-assets", "post-search")
      // is a read wearing a write verb. Treat it as one.
      if (nameSaysRead(tool.name)) return "read";
      return DESTRUCTIVE_WORDS.test(tool.name) || DESTRUCTIVE_WORDS.test(routeRef(tool))
        ? "destructive"
        : "write";
    case "PUT":
    case "PATCH":
      // Upgrade nominally-"write" verbs when the name says it can't be undone.
      return DESTRUCTIVE_WORDS.test(tool.name) || DESTRUCTIVE_WORDS.test(routeRef(tool))
        ? "destructive"
        : "write";
    default:
      return "unknown";
  }
}

/**
 * The route this tool wraps, for heuristics. For a merged tool that is the
 * endpoint it fused with (source.ref holds the schema's own reference), so the
 * route's destructive/admin signal is never lost in the merge.
 */
function routeRef(tool: CandidateTool): string {
  return tool.endpointRef ?? tool.source.ref;
}

/**
 * What kind of endpoint this tool wraps. Checked against the route and the
 * name: "/v1/admin/users" and "admin-feature-access-approve" both catch it.
 */
export function endpointRoleFor(tool: CandidateTool): EndpointRole {
  const haystack = `${tool.name} ${routeRef(tool)}`;
  if (WEBHOOK_PATTERN.test(haystack)) return "webhook";
  if (AUTH_PATTERN.test(haystack)) return "auth";
  if (ADMIN_PATTERN.test(haystack)) return "admin";
  return "endpoint";
}

/** Step 2: derive the WebMCP hints from the classification. */
export function hintsFor(tool: CandidateTool, sideEffect: SideEffect): ToolHints {
  const method = tool.httpMethod;
  return {
    readOnlyHint: sideEffect === "read",
    destructiveHint: sideEffect === "destructive",
    // PUT/PATCH/DELETE can be safely retried with the same input; POST cannot.
    idempotentHint:
      sideEffect === "read" || method === "PUT" || method === "PATCH" || method === "DELETE",
    untrustedContentHint: hasFreeTextOutput(tool.outputSchema),
  };
}

/**
 * True when the output schema contains a free-text field: a string with no
 * enum and no format. Structured values (ids, dates, enums) are the site's
 * own words; an unconstrained string can be user-written (titles, comments,
 * stories), and agents should treat it as untrusted content.
 */
function hasFreeTextOutput(schema: JsonSchema | undefined): boolean {
  if (!schema) return false;
  if (schema.type === "string" && !schema.enum && !schema.format) return true;
  for (const value of Object.values(schema.properties ?? {})) {
    if (hasFreeTextOutput(value)) return true;
  }
  const items = schema.items;
  if (items && !Array.isArray(items) && hasFreeTextOutput(items)) return true;
  // Unions are how validators spell nullable and optional fields
  // ("anyOf: [string, null]"); the content hides one branch down.
  for (const union of [schema.anyOf, schema.oneOf, schema.allOf]) {
    if (Array.isArray(union) && union.some((branch) => hasFreeTextOutput(branch))) return true;
  }
  return false;
}

export function riskTierFor(sideEffect: SideEffect): RiskTier {
  switch (sideEffect) {
    case "read":
      return "safe-read";
    case "destructive":
      return "destructive-confirm";
    default:
      return "write-confirm";
  }
}

/**
 * Walk a schema and return the paths of fields that look like PII or
 * secrets, e.g. "user.email". Only *output* schemas are scanned: the
 * security-relevant direction is data leaving the page and reaching the agent.
 */
export function findPiiFields(
  schema: JsonSchema | undefined,
  extraFields: string[] = [],
  prefix = "",
): string[] {
  if (!schema?.properties) return [];
  const piiNames = new Set(
    [...DEFAULT_PII_FIELDS, ...extraFields].map((name) => name.toLowerCase()),
  );
  const found: string[] = [];

  for (const [key, fieldSchema] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
    const looksSensitive =
      piiNames.has(key.toLowerCase()) ||
      piiNames.has(normalizedKey) ||
      [...piiNames].some((name) => normalizedKey === name.replace(/[-_]/g, ""));
    if (looksSensitive) found.push(path);
    // Recurse into nested objects ("user": { "email": ... }).
    found.push(...findPiiFields(fieldSchema, extraFields, path));
  }
  return found;
}

/**
 * Run the full review: classify, hint, PII-scan, decide the starting state.
 * Pure, no I/O.
 *
 * Returns the surviving tools plus the endpoints we deliberately skipped
 * (webhooks today), so the report can say what was left out and why.
 */
export function reviewTools(
  candidates: CandidateTool[],
  safety: SafetyOptions = {},
): { tools: ReviewedTool[]; skipped: SkippedEndpoint[] } {
  const excluded = (safety.exclude ?? []).map((pattern) => pattern.toLowerCase());
  const skipped: SkippedEndpoint[] = [];
  const tools: ReviewedTool[] = [];

  for (const tool of candidates) {
    const excludedBy = excluded.find(
      (pattern) =>
        tool.name.toLowerCase().includes(pattern) || routeRef(tool).toLowerCase().includes(pattern),
    );
    if (excludedBy) {
      skipped.push({ ref: tool.source.ref, reason: `excluded by config ("${excludedBy}")` });
      continue;
    }

    const endpointRole = endpointRoleFor(tool);
    if (endpointRole === "webhook") {
      skipped.push({
        ref: tool.source.ref,
        reason: "a webhook receives server callbacks; an agent has nothing to call",
      });
      continue;
    }

    const sideEffect = classifySideEffect(tool);
    tools.push({
      ...tool,
      sideEffect,
      endpointRole,
      riskTier: riskTierFor(sideEffect),
      hints: hintsFor(tool, sideEffect),
      // Reads work out of the box. Mutations, auth, and admin endpoints start
      // disabled: the working code is generated but commented out, so enabling
      // one is a deliberate edit, never an accident.
      enabledByDefault: sideEffect === "read" && endpointRole === "endpoint",
      // Withheld means not registered: a gated tool in the registry is a
      // dead end an agent can still pick. registerDisabled opts back into
      // visibility for those who want agents to know the capability exists.
      withheld: !(sideEffect === "read" && endpointRole === "endpoint") && !safety.registerDisabled,
      piiInOutput: findPiiFields(tool.outputSchema, safety.piiFields),
    });
  }

  return { tools, skipped };
}

/**
 * Step 3: audit the reviewed tools and report in plain language.
 * Errors block file writing (unless --force); warnings never do. This is
 * meant to run in CI like `npm audit`: exit codes, not vibes.
 */
export function auditTools(
  tools: ReviewedTool[],
  renames: { from: string; to: string }[] = [],
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const rename of renames) {
    findings.push({
      level: "warning",
      tool: rename.to,
      message: `Renamed "${rename.from}" -> "${rename.to}" to keep tool names unique.`,
    });
  }

  for (const tool of tools) {
    if (!tool.description || tool.description.trim().length === 0) {
      findings.push({
        level: "error",
        tool: tool.name,
        message: "No description. Agents pick tools by description. This tool is invisible.",
      });
      continue;
    }

    if (tool.descriptionSource === "generated-template") {
      findings.push({
        level: "warning",
        tool: tool.name,
        message:
          `Description is just "${tool.description}" (no summary in the source). ` +
          "Write one sentence about what it does and why. It goes straight into the agent's prompt.",
      });
    }

    if (AGENT_INSTRUCTION_PATTERN.test(tool.description)) {
      findings.push({
        level: "warning",
        tool: tool.name,
        message:
          "The description reads like instructions to the agent, not a description of the tool. " +
          "Describe what the tool does; never try to steer the agent from here.",
      });
    }

    if (tool.riskTier === "safe-read" && DESTRUCTIVE_WORDS.test(tool.name)) {
      findings.push({
        level: "error",
        tool: tool.name,
        message:
          `The name suggests something destructive but ${tool.httpMethod} is a safe verb. ` +
          "Check the spec: a GET named like a delete is either mislabeled or a design smell.",
      });
    }

    if (tool.piiInOutput.length > 0) {
      findings.push({
        level: "warning",
        tool: tool.name,
        message:
          `Response may expose ${tool.piiInOutput.join(", ")}. ` +
          "These fields reach the agent. Exclude them in execute() unless they are truly needed.",
      });
    }

    if (tool.requiresAuth && tool.riskTier !== "safe-read") {
      findings.push({
        level: "warning",
        tool: tool.name,
        message:
          "This mutating tool wraps an authenticated endpoint. It runs with the page's session, so " +
          "make sure your server-side authorization checks apply to tool calls too.",
      });
    }

    if (tool.endpointRole === "auth") {
      findings.push({
        level: "warning",
        tool: tool.name,
        message:
          "This looks like a sign-in or session endpoint. It is generated disabled: " +
          "agents should not drive authentication. Enable it by hand only if you are sure.",
      });
    }

    if (tool.endpointRole === "admin") {
      findings.push({
        level: "warning",
        tool: tool.name,
        message:
          "Admin endpoint. It is generated disabled: exposing admin operations to agents " +
          "should be a deliberate decision, reviewed endpoint by endpoint.",
      });
    }

    if (tool.httpMethod === "POST" && tool.sideEffect === "read") {
      findings.push({
        level: "warning",
        tool: tool.name,
        message:
          "A POST treated as a read (the name says search/query-style). If it actually " +
          "changes state, disable it: a mislabeled read skips the user-confirmation step.",
      });
    }

    // The rules below judge the *assembled* tool (post-merge, post-describe,
    // post-overrides), because that is what the agent will actually see.

    if (tool.sideEffect === "read" && !tool.outputSchema) {
      findings.push({
        level: "warning",
        tool: tool.name,
        message:
          "No output schema: the agent gets unstructured text back and has to guess at the " +
          "shape. Add a response schema to the contract so agents can use the results reliably.",
      });
    }

    const fieldNames = Object.keys(tool.inputSchema.properties ?? {});
    const synthesized = new Set(tool.synthesizedFields ?? []);
    if (fieldNames.length > 0 && fieldNames.every((name) => synthesized.has(name))) {
      findings.push({
        level: "warning",
        tool: tool.name,
        message:
          "No input field has a description. Constraints were synthesized from the schema; " +
          "one line of prose per field in your spec or schema is better.",
      });
    }

    findings.push(...findMissingProducerTools(tool, tools));
  }

  // Set-level: every tool competes for the agent's context window, and past
  // a point the surface is a catalog, not a toolkit. This fires once per run,
  // not per tool; the fix is fewer tools, and the person running it knows which.
  const registeredCount = tools.filter((tool) => !tool.withheld).length;
  if (registeredCount > TOOL_COUNT_SOFT_LIMIT) {
    findings.push({
      level: "warning",
      message:
        `${registeredCount} tools register on this surface. Agents hold a handful ` +
        "well; a catalog this size degrades tool selection. Narrow with `safety.exclude`, " +
        "withhold tools you have not reviewed, split per page, or declare the goal-shaped " +
        "actions with the schema source instead of exposing every operation.",
    });
  }

  return findings;
}

/**
 * Field text can point at another tool as the only way to fill it
 * ("Always get this from the search-places tool"). When that producer is not
 * in the run, the agent is sent to fetch a value from a tool that does not
 * exist, so the gap is a finding, not a surprise mid-conversation.
 * Deterministic on purpose: the dependency is declared in the field's own
 * words, never inferred from shapes.
 */
function findMissingProducerTools(tool: ReviewedTool, all: ReviewedTool[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const present = new Set(all.map((candidate) => candidate.name));
  const REFERENCE = /the ["'`]?([a-z][a-z0-9-]*)["'`]? tool\b/i;

  for (const [field, fieldSchema] of Object.entries(tool.inputSchema.properties ?? {})) {
    const description = (fieldSchema as JsonSchema).description;
    if (typeof description !== "string") continue;
    const referenced = REFERENCE.exec(description)?.[1];
    if (referenced && referenced !== tool.name && !present.has(referenced)) {
      findings.push({
        level: "warning",
        tool: tool.name,
        message:
          `Field "${field}" says it comes from the "${referenced}" tool, but no such tool ` +
          "exists in this run. Declare it, or document another source in the field's description.",
      });
    }
  }
  return findings;
}
