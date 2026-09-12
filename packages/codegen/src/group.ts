/**
 * The grouping step: find the endpoints that are one action split by API
 * shape, and emit the single coarse tool an agent should see instead.
 *
 * The canonical case is the upload handshake: POST /media/request-upload +
 * POST /media/uploads/{uploadId}/complete is not two decisions, it's one
 * upload split in two calls. An agent that must orchestrate the pair gets
 * hallucination room ("what's an uploadId again?"); one upload-media tool
 * closes it.
 *
 * Restraint is the whole game here (see the direction doc: naive 1:1 mapping
 * is the failure, but so is inventing cleverness). A pair merges ONLY when
 * every line holds deterministically:
 *
 *   - both are POST endpoints under the same first path segment (one resource)
 *   - the left name carries a begin-verb (request/begin/initiate/prepare/start)
 *     and the right name an end-verb (complete/commit/confirm/finish/end)
 *   - the right name carries the left's final token (the shared noun:
 *     "upload" in request-upload + complete-media-upload)
 *   - the shared noun token is at least 3 letters ("do" pairs nothing)
 *
 * Threading (how the merged call feeds the second request from the first
 * response) is exact-name only: the right side's path params must each match
 * a property on the left's response schema (`{uploadId}` <- `uploadId`). If a
 * path param can't be threaded, the pair is skipped - guessing data flow is
 * how plausible garbage gets shipped.
 *
 * The merged tool is withheld like any write: the merge is a proposal the
 * developer adopts by enabling it. Members are left untouched (they're
 * withheld writes already), so adopting never means losing the alternative.
 */

import pluralize from "pluralize";
import { pascalCase } from "./json-schema.js";
import type { CandidateTool, JsonSchema } from "./types.js";

/** Verbs that start a handshake, and the verbs allowed to end it. */
const BEGIN_VERBS = new Set(["request", "begin", "initiate", "prepare", "start"]);
const END_VERBS = new Set(["complete", "commit", "confirm", "finish", "end"]);

/** One HTTP call of a composed tool. */
export interface ComposedCall {
  httpMethod: NonNullable<CandidateTool["httpMethod"]>;
  pathTemplate: string;
  paramLocations: { path: string[]; query: string[]; body: string[] };
  serverUrl?: string;
  /** The input type of the endpoint this call came from. */
}

/** What a merged tool needs to emit its two-call request. */
export interface ComposedPlan {
  first: ComposedCall;
  second: ComposedCall;
  /** Second-call fields filled from the first response, keyed by field name. */
  threaded: Record<string, string>;
}

export interface GroupResult {
  tools: CandidateTool[];
  notes: string[];
}

/** The response property names a call's result exposes for threading. */
function responseFields(tool: CandidateTool): Set<string> {
  return new Set(Object.keys(tool.outputSchema?.properties ?? {}));
}

/** True when the right endpoint's path params can all be filled from left response fields. */
function threadingFor(
  left: CandidateTool,
  right: CandidateTool,
): Record<string, string> | undefined {
  const available = responseFields(left);
  const threaded: Record<string, string> = {};
  for (const param of right.paramLocations?.path ?? []) {
    if (!available.has(param)) return undefined;
    threaded[param] = param;
  }
  return threaded;
}

/** The verb tokens of a name, in order. */
function tokensOf(name: string): string[] {
  return name.split("-").filter(Boolean);
}

function firstPathSegment(pathTemplate: string | undefined): string | undefined {
  // Version prefixes ("v1", "v2") carry no resource identity of their own.
  return pathTemplate
    ?.split("/")
    .filter(Boolean)
    .find((segment) => !/^v\d+$/.test(segment));
}

/** Try the candidate's preferred names in order; return the first free one. */
function pickMergedName(noun: string, resource: string, taken: Set<string>): string | undefined {
  const resourceSingular = pluralize.singular(resource);
  const candidates =
    noun === resourceSingular || noun === resource
      ? [noun, `${noun}-flow`]
      : [`${noun}-${resourceSingular}`, `${noun}-${resource}`, `${noun}-flow`];
  return candidates.find((candidate) => !taken.has(candidate));
}

/** Merge two schemas' properties; left wins on name conflict. */
function mergedInputSchema(
  left: CandidateTool,
  right: CandidateTool,
  threaded: Record<string, string>,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {
    ...(right.inputSchema.properties ?? {}),
    ...(left.inputSchema.properties ?? {}),
  };
  for (const field of Object.keys(threaded)) delete properties[field];
  const required = new Set([
    ...(left.inputSchema.required ?? []),
    ...(right.inputSchema.required ?? []),
  ]);
  for (const field of Object.keys(threaded)) required.delete(field);
  return {
    type: "object",
    properties,
    ...(required.size > 0 ? { required: [...required].sort() } : {}),
  };
}

/**
 * Detect handshake pairs among named candidates and append merged proposals.
 * Members stay in the list exactly as they were; the merged tool arrives
 * marked so the safety layer gives it the write treatment its members have.
 */
export function groupHandshakes(candidates: CandidateTool[]): GroupResult {
  const notes: string[] = [];
  const added: CandidateTool[] = [];
  const taken = new Set(candidates.map((tool) => tool.name));

  const posts = candidates.filter(
    (tool) => tool.httpMethod === "POST" && tool.pathTemplate && tool.paramLocations,
  );

  const consumed = new Set<string>();
  for (const left of posts) {
    if (consumed.has(left.id)) continue;
    const leftTokens = tokensOf(left.name);
    if (!leftTokens.some((token) => BEGIN_VERBS.has(token))) continue;
    const noun = leftTokens[leftTokens.length - 1];
    if (!noun || noun.length < 3) continue;
    const resource = firstPathSegment(left.pathTemplate);
    if (!resource) continue;

    const right = posts.find(
      (candidate) =>
        candidate !== left &&
        !consumed.has(candidate.id) &&
        firstPathSegment(candidate.pathTemplate) === resource &&
        tokensOf(candidate.name).some((token) => END_VERBS.has(token)) &&
        tokensOf(candidate.name).includes(noun),
    );
    if (!right) continue;

    const threaded = threadingFor(left, right);
    if (threaded === undefined) {
      notes.push(
        `${left.name} + ${right.name} look like one flow, but "${right.name}" takes path params the first response doesn't provide - left as separate tools.`,
      );
      continue;
    }

    const name = pickMergedName(noun, resource, taken);
    if (!name) {
      notes.push(
        `${left.name} + ${right.name} look like one flow, but every merged name collided - left as separate tools.`,
      );
      continue;
    }

    taken.add(name);
    consumed.add(left.id);
    consumed.add(right.id);

    const resourceSingular = pluralize.singular(resource);
    added.push({
      id: `${left.id} + ${right.id}`,
      name,
      source: { kind: "openapi", ref: `${left.source.ref} + ${right.source.ref}` },
      inputSchema: mergedInputSchema(left, right, threaded),
      outputSchema: right.outputSchema,
      inputTypeName: `${pascalCase(name)}Input`,
      sideEffect: "write",
      requiresAuth: left.requiresAuth || right.requiresAuth,
      description: `Complete the ${resourceSingular} ${noun}. One action the API split into two calls; they run in order. Returns the completed ${noun}.`,
      descriptionSource: "generated-template",
      compose: {
        first: {
          httpMethod: left.httpMethod as NonNullable<CandidateTool["httpMethod"]>,
          pathTemplate: left.pathTemplate as string,
          paramLocations: left.paramLocations as ComposedCall["paramLocations"],
          serverUrl: left.serverUrl,
        },
        second: {
          httpMethod: right.httpMethod as NonNullable<CandidateTool["httpMethod"]>,
          pathTemplate: right.pathTemplate as string,
          paramLocations: right.paramLocations as ComposedCall["paramLocations"],
          serverUrl: right.serverUrl,
        },
        threaded,
      },
    });
    notes.push(
      `Grouped ${left.name} + ${right.name} into ${name} - one action the API split in two calls. It starts withheld like its members; enable ${name} instead of the pair when you're satisfied.`,
    );
  }

  return { tools: [...candidates, ...added], notes };
}
