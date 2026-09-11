/**
 * The text of the code the `tools` output writes.
 *
 * Heads up before reading on: every function here returns *TypeScript source
 * code as a string*. When you see `export const ...` inside quotes, that's
 * the output a user's repo will contain, not this module's own logic.
 * Building output from arrays of lines (rather than nested template strings)
 * keeps the quoting readable; the only escaping left is for code samples
 * inside the generated comments.
 *
 * Three kinds of output are built here:
 *   - generatedRegion()      the per-tool contract (regenerated freely)
 *   - ownedRegionScaffold()  the execute() body (written once, then owned)
 *   - runtimeSource() / barrelSource()   fully-generated support files
 *
 * The contract the output fulfills: read tools work out of the box (a real
 * request to the endpoint), mutation tools start disabled with the working
 * code generated but commented out, and the user-confirmation step for
 * mutations lives in the generated region so it cannot be edited away.
 * Registration skips quietly on browsers without WebMCP, the execute
 * context's signal reaches fetch, and failures return readable error
 * results. That error contract is load-bearing: the browser maps a
 * rejected execute to a bare UnknownError with the message discarded,
 * so a thrown failure would teach the agent nothing.
 */

import { jsonSchemaToTs, pascalCase } from "../json-schema.js";
import type { ReviewedTool } from "../types.js";
import { GENERATED_END, GENERATED_START } from "./tools.js";

/**
 * Everything above the end-marker of a per-tool file: the parts that must
 * track the API contract exactly: name, description, schema, input type,
 * hints, and the register() wrapper.
 */
export function generatedRegion(
  tool: ReviewedTool,
  registration?: { exposedTo?: string[] },
): string {
  const pascal = pascalCase(tool.name);
  const camel = lowercaseFirst(pascal);
  const schemaJson = JSON.stringify(tool.inputSchema, null, 2);
  const inputType = jsonSchemaToTs(tool.inputSchema, undefined);
  const mutates = tool.riskTier !== "safe-read";

  // The second registerTool() argument: the AbortSignal always, plus the
  // configured origin exposure when the app shares tools with trusted
  // embedded documents (the spec's exposedTo).
  const registrationOptions = registration?.exposedTo?.length
    ? `{ signal, exposedTo: ${JSON.stringify(registration.exposedTo)} },`
    : `{ signal },`;

  // Import only what this file's regions actually use, so generated files
  // pass strict lint configs (no-unused-vars errors fail Next.js builds).
  // A disabled tool's request is commented out, so callApi/toolResult stay
  // out of its imports; a standalone schema tool has no route to call.
  const enabled = tool.enabledByDefault;
  // A withheld tool is not registered at all: its registration is a commented
  // fence, so the only runtime helper its live code uses is toolDisabled in
  // the execute scaffold (a defensive refusal if someone registers it by hand).
  const withheld = tool.withheld && !enabled;
  const hasRoute =
    Boolean(tool.compose) || Boolean(tool.httpMethod && tool.pathTemplate && tool.paramLocations);
  const runtimeImports = withheld
    ? hasRoute
      ? "callApi, toolDisabled"
      : "toolDisabled"
    : [
        "getModelContext",
        ...(mutates ? ["requestUserConfirmation"] : []),
        // Every endpoint-backed tool emits a live fetchX raw caller, so
        // callApi is imported whether the tool itself starts enabled or not.
        ...(hasRoute ? ["callApi"] : []),
        ...(enabled ? ["toolResult"] : []),
        "asToolError",
        ...(enabled ? [] : ["toolDisabled"]),
      ].join(", ");

  const registerBody = mutates
    ? [
        `  await modelContext.registerTool(`,
        `    {`,
        `      ...${camel}Tool,`,
        `      execute: async (input, context) => {`,
        `        // Cancellation wins over everything, including the confirmation.`,
        `        context?.signal?.throwIfAborted();`,
        `        // This tool changes things, so the user is always asked first. The`,
        `        // confirmation lives in the generated region: it cannot be edited away.`,
        `        const confirmed = await requestUserConfirmation(`,
        `          ${JSON.stringify(`Allow the agent to: ${tool.description}`)},`,
        `        );`,
        `        if (!confirmed) {`,
        `          return {`,
        `            content: [{ type: "text", text: "The user declined this action." }],`,
        `            isError: true,`,
        `          };`,
        `        }`,
        `        // The browser has already validated the agent's input against the schema.`,
        `        // A failure returns a readable result; it never throws (see asToolError).`,
        `        try {`,
        `          return await execute${pascal}(input as ${tool.inputTypeName}, context?.signal);`,
        `        } catch (error) {`,
        `          return asToolError(error);`,
        `        }`,
        `      },`,
        `    },`,
        `    ${registrationOptions}`,
        `  );`,
      ]
    : [
        `  await modelContext.registerTool(`,
        `    {`,
        `      ...${camel}Tool,`,
        `      // The browser has already validated the agent's input against the schema.`,
        `      // A failure returns a readable result; it never throws (see asToolError).`,
        `      execute: async (input, context) => {`,
        `        try {`,
        `          return await execute${pascal}(input as ${tool.inputTypeName}, context?.signal);`,
        `        } catch (error) {`,
        `          return asToolError(error);`,
        `        }`,
        `      },`,
        `    },`,
        `    ${registrationOptions}`,
        `  );`,
      ];

  return [
    `import { ${runtimeImports} } from "./runtime.webmcp";`,
    ``,
    GENERATED_START,
    `/**`,
    ` * ${tool.description}`,
    ` *`,
    ` * Source: ${tool.source.ref} (${tool.source.kind}). Risk: ${tool.riskTier}.`,
    ` * ${
      tool.enabledByDefault
        ? `Starts enabled (see execute${pascal} below).`
        : tool.withheld
          ? "Starts withheld: not registered until you enable it (see register" +
            `${pascal} below).`
          : `Starts disabled (see execute${pascal} below).`
    }`,
    ` * Regenerate with: npx @webmcp-stack/codegen generate`,
    ` */`,
    ``,
    `/** The exact contract advertised to the agent. Derived from the API spec. Do not hand-edit. */`,
    `export const ${camel}InputSchema = ${schemaJson};`,
    ``,
    `/** What \`execute\` receives. The browser validates agent input against the schema above. */`,
    `export type ${tool.inputTypeName} = ${inputType};`,
    ``,
    `/** Safety hints computed by webmcp-codegen. Informational metadata for hosts and UIs. */`,
    `export const ${camel}Hints = ${JSON.stringify(tool.hints)} as const;`,
    ``,
    `/** The tool definition, minus \`execute\` (which is yours, below the marker). */`,
    `export const ${camel}Tool = {`,
    `  name: ${JSON.stringify(tool.name)},`,
    `  title: ${JSON.stringify(titleFromName(tool.name))},`,
    `  description: ${JSON.stringify(tool.description)},`,
    `  inputSchema: ${camel}InputSchema,`,
    `  annotations: {`,
    `    readOnlyHint: ${tool.hints.readOnlyHint},`,
    `    untrustedContentHint: ${tool.hints.untrustedContentHint},`,
    `    consequentialHint: ${tool.riskTier === "destructive-confirm"},`,
    `  },`,
    `};`,
    ...(hasRoute
      ? [
          ``,
          `/** The bare request, without the agent-facing result wrapping. Journeys`,
          ` * and your own code compose this; execute${pascal} is the agent-facing one. */`,
          `export async function fetch${pascal}(input: ${tool.inputTypeName}, signal?: AbortSignal) {`,
          ...(tool.compose
            ? composedFetchBody(tool.compose)
            : [`  ${requestCall(tool)}`, `  return data;`]),
          `}`,
        ]
      : []),
    ``,
    ...(withheld
      ? [
          `/**`,
          ` * Withheld: this tool is not registered, so agents cannot see or pick`,
          ` * it. The registration below stays commented until you enable the tool`,
          ` * (uncomment it and the body of execute${pascal}, or flip it in the`,
          ` * dashboard and regenerate).`,
          ` */`,
          `export async function register${pascal}(signal?: AbortSignal): Promise<void> {`,
          `  void signal;`,
          `  // const modelContext = getModelContext();`,
          `  // if (!modelContext) return;`,
          // Comment out the body the way an editor's toggle-comment does:
          // the marker goes at a fixed column and the line keeps its own
          // indentation, so uncommenting restores working code, not mush.
          ...registerBody.map((line) => `  //${line ? ` ${line}` : ""}`),
          `}`,
        ]
      : [
          `/**`,
          ` * Register this tool with WebMCP. Call it once on page load, or use`,
          ` * registerAllTools() from the generated index.ts. Skips quietly when the`,
          ` * browser has no WebMCP runtime.`,
          ` *`,
          ` * Pass an AbortSignal to unregister later: controller.abort().`,
          ` */`,
          `export async function register${pascal}(signal?: AbortSignal): Promise<void> {`,
          `  const modelContext = getModelContext();`,
          `  if (!modelContext) return;`,
          ...registerBody,
          `}`,
        ]),
    ``,
    GENERATED_END,
  ].join("\n");
}

/**
 * The scaffold below the marker, written exactly once (when the file is
 * first created). After that the developer owns it and regeneration never
 * touches it. That promise is the whole reason the marker split exists.
 *
 * The scaffold is real code, not a TODO: the spec knows the method, the
 * path, and which fields go where, so the default implementation actually
 * calls the endpoint from the page, with the signed-in user's session.
 * Reads are born working; mutations are born disabled (the working code is
 * right there, commented out, one deliberate edit away from live).
 */
export function ownedRegionScaffold(tool: ReviewedTool): string {
  const pascal = pascalCase(tool.name);
  const hasRoute =
    Boolean(tool.compose) || Boolean(tool.httpMethod && tool.pathTemplate && tool.paramLocations);
  // Endpoint-backed tools compose the raw caller from the generated region
  // (fetchX), so the default execute stays one line and journeys reuse the
  // exact same request. Schema-only tools keep the honest TODO.
  const call = hasRoute ? `const data = await fetch${pascal}(input, signal);` : requestCall(tool);
  // An endpoint-backed tool scaffolds a call to its route. A standalone schema
  // tool has no route: the honest scaffold says "wire this to your app's own
  // action" and names nothing we made up.
  const endpointBacked = Boolean(tool.endpointRef) || tool.source.kind === "openapi";
  const calledWhat = tool.endpointRef ?? tool.source.ref;
  const lines: string[] = [
    ``,
    `/**`,
    ` * What actually happens when the agent calls "${tool.name}".`,
    ` *`,
    ...(endpointBacked
      ? [
          ` * Default implementation: calls ${calledWhat} from this page, with the`,
          ` * signed-in user's session. Replace it with your app's own API client`,
          ` * whenever you like; the contract above never changes.`,
        ]
      : [
          ` * This tool was declared from a schema, not derived from an endpoint,`,
          ` * so there is no default request to scaffold. Wire it to your app's own`,
          ` * action (the function your UI already calls), with the signed-in`,
          ` * user's session. The contract above never changes.`,
        ]),
  ];

  if (endpointBacked && resolveApiBase(tool.serverUrl)) {
    lines.push(
      ` *`,
      ` * Calls the API at ${resolveApiBase(tool.serverUrl)} (from your spec's servers list).`,
    );
  } else if (endpointBacked) {
    lines.push(` *`, ` * Calls the API on this page's own origin (same-origin by default).`);
  }

  if (tool.riskTier !== "safe-read") {
    lines.push(
      ` *`,
      ` * This tool is ${tool.riskTier}: it ${
        tool.riskTier === "destructive-confirm" ? "cannot easily be undone" : "changes things"
      }.`,
      ` * The user is asked to confirm every call (built into the generated region).`,
    );
  }
  lines.push(` */`);

  if (tool.piiInOutput.length > 0) {
    lines.push(
      `//`,
      `// ⚠ webmcp-codegen flagged these response fields as likely PII: ${tool.piiInOutput.join(", ")}.`,
      `// Everything you return reaches the agent. Leave those fields out of what you`,
      `// return unless the agent genuinely needs them, and say so in a comment if you keep them.`,
    );
  }

  if (tool.enabledByDefault) {
    lines.push(
      `export async function execute${pascal}(input: ${tool.inputTypeName}, signal?: AbortSignal) {`,
      `  ${call}`,
      // The co-browsing affordance: a call that changes what the human sees
      // should change it on screen, not just in the response.
      ...(endpointBacked
        ? [
            `  // Make the effect visible: an agent acts while a human watches this`,
            `  // page. If this call changes what is on screen, update the UI here`,
            `  // (navigate, invalidate a query, dispatch an event).`,
          ]
        : []),
      `  return toolResult(data);`,
      `}`,
    );
  } else {
    lines.push(
      `export async function execute${pascal}(input: ${tool.inputTypeName}, signal?: AbortSignal) {`,
      ...(tool.withheld
        ? [
            `  // This tool is withheld: nothing registers it, so agents cannot see`,
            `  // or call it. To enable it, uncomment the request below and the`,
            // Route-backed tools import callApi already (fetchX uses it).
            hasRoute
              ? `  // registration above, and add toolResult to the import.`
              : `  // registration above, and add callApi and toolResult to the import.`,
          ]
        : [
            `  // This tool starts disabled: it ${
              tool.endpointRole === "endpoint"
                ? "changes things"
                : `wraps an ${tool.endpointRole} endpoint`
            }. Agents can see it, and calling it tells`,
            `  // them it is disabled. To enable it, delete the line below, uncomment`,
            hasRoute
              ? `  // the code, and add toolResult to the import above.`
              : `  // the code, and add callApi and toolResult to the import above.`,
          ]),
      `  void signal; // passed to fetch once you enable the call below`,
      `  return toolDisabled("${tool.name}.webmcp.ts");`,
      ``,
      `  // ${call}`,
      `  // return toolResult(data);`,
      `}`,
    );
  }

  return lines.join("\n");
}

/**
 * The one working request line inside a scaffold, built from what the spec
 * knows: the path template becomes a template literal, query params become
 * the search string, body fields become the JSON body.
 *
 *   "/pets/{id}" + DELETE  →  const data = await callApi(`/pets/${input.id}`, { method: "DELETE" });
 *
 * When the source carries no route information, we fall back to an honest
 * TODO instead of inventing a URL.
 */
/**
 * Decide the API base URL a generated tool should call. A spec's servers[0]
 * is frequently a local dev URL (http://localhost:3001); baking that into the
 * generated fetch makes every deployed tool call the visitor's own machine.
 * So: a non-local absolute URL is kept (the API genuinely lives elsewhere),
 * a local one returns undefined so the tool falls back to same-origin —
 * which is where a deployed app's API actually is.
 */
export function resolveApiBase(serverUrl: string | undefined): string | undefined {
  if (!serverUrl) return undefined;
  try {
    const { hostname } = new URL(serverUrl);
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return undefined;
    }
    return serverUrl;
  } catch {
    return undefined;
  }
}

/**
 * The arguments to one callApi(...): the path expression (template params
 * interpolated, non-local server URLs kept) plus method/query/body/signal.
 * `pathRef` says where each path param's value comes from — ordinary tools
 * read `input`, the second call of a composed tool reads the first result.
 */
function buildCallExpr(options: {
  httpMethod: string;
  pathTemplate: string;
  paramLocations: { path: string[]; query: string[]; body: string[] };
  serverUrl?: string;
  pathRef?: (param: string) => string;
  skipFields?: Set<string>;
}): string {
  const {
    httpMethod,
    pathTemplate,
    paramLocations,
    serverUrl,
    pathRef = inputRef,
    skipFields = new Set<string>(),
  } = options;
  const { path: pathParams, query: queryParamsAll, body: bodyParamsAll } = paramLocations;
  const queryParams = queryParamsAll.filter((name) => !skipFields.has(name));
  const bodyParams = bodyParamsAll.filter((name) => !skipFields.has(name));

  // "/pets/{id}" → `/pets/${input.id}`. Params the schema knows by name.
  let pathExpr = `\`${pathTemplate.replace(/\{([^}]+)\}/g, (_m, param: string) => `\${${pathRef(param)}}`)}\``;
  if (pathParams.length === 0) pathExpr = JSON.stringify(pathTemplate);

  // Base URL: default to the page's own origin so a deployed app calls its
  // own API. Baking the spec's servers[0] (often http://localhost:3001) into
  // the generated fetch would make every deployed tool call the visitor's
  // own machine. A non-local public server URL is kept as the default base;
  // a local one is not.
  const base = resolveApiBase(serverUrl);
  if (base) {
    const b = base.endsWith("/") ? base.slice(0, -1) : base;
    pathExpr = `\`${b}\${${pathExpr}}\``;
  }

  const args: string[] = [`method: ${JSON.stringify(httpMethod)}`];
  if (queryParams.length > 0) {
    const entries = queryParams.map((name) => `${safeKey(name)}: ${inputRef(name)}`).join(", ");
    args.push(`query: { ${entries} }`);
  }
  if (bodyParams.length > 0) {
    if (bodyParams.length === 1 && bodyParams[0] === "body") {
      // A non-object request body arrives as a single "body" field.
      args.push(`body: input.body`);
    } else {
      const entries = bodyParams.map((name) => `${safeKey(name)}: ${inputRef(name)}`).join(", ");
      args.push(`body: { ${entries} }`);
    }
  }
  // The execute context's signal reaches fetch, so a cancelled call stops.
  args.push("signal");

  return `${pathExpr}, { ${args.join(", ")} }`;
}

function requestCall(tool: ReviewedTool): string {
  if (!tool.httpMethod || !tool.pathTemplate || !tool.paramLocations) {
    return `const data = null; // TODO: call your app's existing code here.`;
  }
  return `const data = await callApi(${buildCallExpr({
    httpMethod: tool.httpMethod,
    pathTemplate: tool.pathTemplate,
    paramLocations: tool.paramLocations,
    serverUrl: tool.serverUrl,
  })});`;
}

/** "uploadId" on the first response: dot access when the name allows it. */
function firstResultRef(param: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(param)
    ? `firstResult.${param}`
    : `firstResult[${JSON.stringify(param)}]`;
}

/**
 * The two calls of a grouped handshake tool: the first request runs, its
 * response fields fill the second request's path params by exact name, and
 * the second response is the tool's result. Threaded fields never reach the
 * agent-facing input — that's the point of the composition.
 */
function composedFetchBody(plan: NonNullable<ReviewedTool["compose"]>): string[] {
  const threaded = new Set(Object.keys(plan.threaded));
  return [
    `  const firstResult = (await callApi(${buildCallExpr(plan.first)})) as Record<string, unknown>;`,
    `  const data = await callApi(${buildCallExpr({
      ...plan.second,
      pathRef: (param) => (threaded.has(param) ? firstResultRef(param) : inputRef(param)),
      skipFields: threaded,
    })});`,
    `  return data;`,
  ];
}

/**
 * How generated code reads a field off `input`. Dot access for identifier
 * names ("input.limit"), bracket access for the rest ("input["pet-id"]").
 */
function inputRef(name: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)
    ? `input.${name}`
    : `input[${JSON.stringify(name)}]`;
}

/** Quote an object key only when it needs it. */
function safeKey(name: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

/**
 * The shared runtime: the minimal WebMCP browser types plus the helpers the
 * generated files use. Kept tiny on purpose: this is the only browser
 * coupling in the output.
 */
export function runtimeSource(): string {
  return `/**
 * Generated by webmcp-codegen. This file is fully regenerated on every run.
 * Do not edit by hand; your changes will be lost.
 */

/** The result shape tools return (same as MCP tool results). */
export interface WebMcpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

/** A tool as the browser runtime understands it. */
export interface WebMcpToolDefinition {
  name: string;
  /** A human-facing label for native UIs (the spec's USVString title). */
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  /** Hints the agent reads to decide how careful to be with this tool. */
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
    consequentialHint?: boolean;
  };
  execute: (
    input: Record<string, unknown>,
    context?: { signal?: AbortSignal },
  ) => unknown | Promise<unknown>;
}

/** The slice of the WebMCP draft spec the generated code uses. */
export interface ModelContext {
  registerTool(
    tool: WebMcpToolDefinition,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<void>;
}

/* Most browsers do not have WebMCP yet, so a missing model context is a
 * normal page load, not an error. It gets one quiet log line per load,
 * never one per tool. */
let announcedUnavailable = false;

/**
 * The page's WebMCP model context, or null when the browser has none.
 * Registration callers skip quietly on null; a missing runtime must never
 * surface in the human-facing page (no throws, no console spam).
 */
export function getModelContext(): ModelContext | null {
  const modelContext = (document as unknown as { modelContext?: ModelContext }).modelContext;
  if (!modelContext && !announcedUnavailable) {
    announcedUnavailable = true;
    console.info(
      "[webmcp-codegen] WebMCP is not available in this browser; tools were not registered.",
    );
  }
  return modelContext ?? null;
}

/**
 * Register every journey exported from the modules the barrel found in
 * journeys/. Anything with a .register() method counts (createJourney's
 * return shape); anything else is skipped quietly. One journey failing never
 * takes the others down with it.
 */
export async function registerJourneys(
  modules: Record<string, unknown>[],
  signal?: AbortSignal,
): Promise<void> {
  for (const module of modules) {
    for (const value of Object.values(module)) {
      const journey = value as { register?: unknown } | null;
      if (journey !== null && typeof journey === "object" && typeof journey.register === "function") {
        try {
          await (journey.register as (signal?: AbortSignal) => Promise<void>)(signal);
        } catch (error) {
          console.warn("[webmcp-codegen] a journey failed to register:", error);
        }
      }
    }
  }
}

/**
 * Call your API from the page. Same origin by default (pass a full URL when
 * the API lives on another host), always with the signed-in user's session
 * cookies. Throws on HTTP errors; returns the parsed JSON body, or raw text
 * when the response is not JSON. Pass the signal from execute's context so
 * a cancelled tool call stops the request.
 */
export async function callApi(
  path: string,
  options: {
    method?: string;
    query?: Record<string, unknown>;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<unknown> {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: options.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error("Request failed: " + response.status + " " + response.statusText);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Chrome's output budget: one tool result stays under ~1.5K characters. */
const TOOL_OUTPUT_MAX = 1536;

const TRUNCATED_NOTICE =
  "\\n… [truncated to fit the 1.5K output budget — return a smaller slice or paginate]";

/**
 * Wrap a result in the MCP shape, so tool bodies stay one line. The result
 * text is capped at Chrome's ~1.5K per-call output budget: oversized payloads
 * cost the agent context and can trip guardrails, so they are cut with a
 * notice rather than delivered whole. The cap lives here in the shared
 * runtime, so it cannot be edited away per tool.
 */
export function toolResult(data: unknown): WebMcpToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const fitted =
    text.length <= TOOL_OUTPUT_MAX
      ? text
      : text.slice(0, TOOL_OUTPUT_MAX - TRUNCATED_NOTICE.length) + TRUNCATED_NOTICE;
  return {
    content: [{ type: "text", text: fitted }],
  };
}

/**
 * A failure the agent can read and act on. The one hard rule of the execute
 * contract: never throw for failure. The browser maps a rejected execute to
 * a bare UnknownError and discards the message, so a thrown failure teaches
 * the agent nothing. Cancellation is the only exception, which is why
 * asToolError re-throws AbortError.
 */
export function toolError(message: string): WebMcpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Convert any thrown failure into a readable error result. */
export function asToolError(error: unknown): WebMcpToolResult {
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  return toolError(error instanceof Error ? error.message : "The tool failed.");
}

/**
 * What a disabled tool tells the agent. The tool stays visible (so the agent
 * knows it exists and can ask the human to enable it) but does nothing.
 */
export function toolDisabled(fileName: string): WebMcpToolResult {
  return {
    content: [
      {
        type: "text",
        text:
          "This tool is currently disabled by the app developer. Ask them to enable it " +
          "(uncomment the implementation in " + fileName + ").",
      },
    ],
    isError: true,
  };
}

/**
 * Default "agent proposes, human confirms" gate for write/destructive tools.
 * Deliberately minimal (window.confirm). Replace it with your app's own
 * dialog when you outgrow it. The point is that the user always gets a say.
 */
export function requestUserConfirmation(message: string): Promise<boolean> {
  return Promise.resolve(window.confirm(message));
}
`;
}

/** The barrel: one import that registers every generated tool. */
export function barrelSource(tools: ReviewedTool[], journeyFiles: string[] = []): string {
  const imports = tools
    .map((tool) => `import { register${pascalCase(tool.name)} } from "./${tool.name}.webmcp";`)
    .join("\n");
  const names = tools.map((tool) => `register${pascalCase(tool.name)}`).join(",\n  ");

  const journeyImports = journeyFiles
    .map(
      (file, index) =>
        `import * as journeyModule${index} from "./journeys/${file.replace(/\.ts$/, "")}";`,
    )
    .join("\n");
  const journeyModuleNames = journeyFiles.map((_, index) => `journeyModule${index}`).join(", ");

  return `/**
 * Generated by webmcp-codegen. This file is fully regenerated on every run.
 * Import registerAllTools() once at app startup:
 *
 *   import { registerAllTools } from "./webmcp";
 *   await registerAllTools();
 */

${imports}
${journeyFiles.length > 0 ? `\nimport { registerJourneys } from "./runtime.webmcp";\n${journeyImports}\n` : ""}
const registrations = [
  ${names}
];
${journeyFiles.length > 0 ? `\nconst journeyModules = [${journeyModuleNames}];\n` : ""}
/**
 * Register every generated tool with WebMCP. One tool failing (for example
 * because the page's Permissions-Policy disables tools) never takes the
 * others down with it. The failure is logged and registration continues.
 */
export async function registerAllTools(signal?: AbortSignal): Promise<void> {
  for (const register of registrations) {
    try {
      await register(signal);
    } catch (error) {
      console.warn("[webmcp-codegen] a tool failed to register:", error);
    }
  }
  ${
    journeyFiles.length > 0
      ? `// Journeys come last: their steps compose the tools above.
  await registerJourneys(journeyModules, signal);`
      : `// Drop journey definitions into ./journeys/ and re-run \`generate\`:
  // the next barrel registers every createJourney() export it finds there.`
  }
}
`;
}

/** "GetOrderStatus" → "getOrderStatus" (for the generated const names). */
/**
 * The spec's human-facing `title`: "list-trips" → "List Trips". Derived from
 * the name so the two never disagree.
 */
function titleFromName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function lowercaseFirst(pascal: string): string {
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
