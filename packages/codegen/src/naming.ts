/**
 * Tool naming.
 *
 * Tool names are the vocabulary an agent reasons over, so they should read
 * as intent ("generate-story"), not as machine routing
 * ("post-trips-trip-id-story-generate"). Every tool gets its name from the
 * best signal available, in order:
 *
 *   1. An explicit override (config or .webmcp-codegen.json) - always wins.
 *   2. A cleaned operationId, when the spec has one.
 *   3. An intent-shaped name derived from the route (analyzeRoute).
 *   4. The plain method+path concat - the total fallback that can never fail.
 *
 * resolveNames() runs the set-level pass: collisions are deepened with
 * parent context ("generate-story" -> "generate-trip-story"), and every
 * rename is reported.
 */

import pluralize from "pluralize";

/** The character set the WebMCP runtime accepts for tool names. */
export const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Turn an operationId or route fragment into a valid, readable tool name.
 *
 * Examples:
 *   "getOrderStatus"      -> "get-order-status"
 *   "GET /orders/{id}"    -> "get-orders-id"
 *   "list_pets"           -> "list-pets"
 */
export function toToolName(raw: string): string {
  const name = raw
    // Split acronym boundaries first: "getHTTPStatus" -> "get-HTTPStatus"
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    // Then camelCase and PascalCase boundaries: "getOrder" -> "get-Order"
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    // Path placeholders and separators become dashes: "/orders/{id}" -> "-orders-id"
    .replace(/[{}/_\s.]+/g, "-")
    // Anything left that isn't a letter, digit or dash is dropped
    .replace(/[^a-zA-Z0-9-]/g, "")
    .toLowerCase()
    // Collapse and trim dashes
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  // A name must start with a letter. If it doesn't (e.g. it came from a bare
  // numeric path), give it a neutral prefix rather than failing.
  const prefixed = /^[a-zA-Z]/.test(name) ? name : `tool-${name}`;
  return prefixed || "unnamed-tool";
}

/** "/v1/trips" and "/v2.1/trips" version their API in the path, not in intent. */
const VERSION_SEGMENT = /^v\d+([._-]\d+)*$/i;

/**
 * The plain method+path name, used when no intent mapping applies. Version
 * segments are dropped first: "v1" carries no information about intent, and
 * no tool should be called "get-v1-trips".
 */
export function nameFromRoute(method: string, path: string): string {
  const segments = path.split("/").filter((s) => s.length > 0 && !VERSION_SEGMENT.test(s));
  return toToolName(`${method.toLowerCase()} ${segments.join("/")}`);
}

/**
 * Clean the machine scaffolding specs put around operationIds. The author's
 * intent is the name; "TripsController_createTrip_v2" means "create-trip".
 * Conservative on purpose: only obvious scaffolding is stripped, anything
 * ambiguous stays exactly as the author wrote it.
 */
export function cleanOperationId(operationId: string): string {
  let id = operationId;

  // Drop a leading framework prefix: "TripsController_create" -> "create",
  // "user.service.getProfile" -> "getProfile". Everything up to and including
  // the first scaffolding marker goes, and only when something remains.
  const segments = id.split(/_|\./).filter(Boolean);
  const marker = segments.findIndex((s) => /(controller|service|api|handler)$/i.test(s));
  if (marker !== -1 && marker < segments.length - 1) {
    id = segments.slice(marker + 1).join("_");
  }

  // Drop a trailing version marker: "createTrip_v2" -> "createTrip".
  id = id.replace(/[._-]?v\d+$/i, "");

  return toToolName(id);
}

// --- The intent algorithm --------------------------------------------------

/**
 * The last segment of a path is an action when its first word is here. The
 * dictionary is deliberately small and explicit: a word that is not listed
 * is treated as a resource, never guessed at.
 */
const ACTION_VERBS = new Set([
  "accept",
  "activate",
  "approve",
  "archive",
  "batch",
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
  "import",
  "invite",
  "join",
  "leave",
  "lock",
  "login",
  "logout",
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
  "search",
  "send",
  "share",
  "signin",
  "signout",
  "signup",
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

/**
 * Auth actions the dictionary knows as one word but agents read better as
 * verb phrases. "signup" starts with a noun; "sign-up" starts with the act.
 */
const ACTION_VERB_FORMS: Record<string, string> = {
  signin: "sign-in",
  signout: "sign-out",
  signup: "sign-up",
};

/**
 * Actions that operate on a collection at once. "batch-block" would imply
 * one block; "batch-blocks" says what the endpoint actually does.
 */
const PLURAL_ACTIONS = new Set(["batch", "import", "export", "sync"]);

/**
 * Segments that group endpoints rather than name resources. "POST
 * /auth/login" is "login", not "login-auth"; the grouping word adds nothing
 * an agent can act on.
 */
const GROUPING_SEGMENTS = new Set(["auth", "authentication", "api", "admin", "internal", "public"]);

/**
 * Trailing segments that mean "the current one": GET /users/me is a member
 * read of the current user, not a collection called "me".
 */
const MEMBER_WORDS = new Set(["me", "self", "current"]);

export interface RouteAnalysis {
  /** The minimal intent-shaped name, e.g. "generate-story". */
  base: string;
  /**
   * "intent" names can absorb parent context on collision ("generate-story"
   * -> "generate-trip-story"); "fallback" names are fixed strings.
   */
  tier: "intent" | "fallback";
  /** The verb and noun the name is built from: verb + context + noun. */
  verb?: string;
  noun?: string;
  /** Ancestor resources, nearest first. minDepth of them are in the base. */
  context?: string[];
  /**
   * Grouping segments ("admin", "auth") dropped from the name for reading,
   * kept nearest-first as the last resort before a numeric suffix: spending
   * "admin" beats shipping "get-pricing-2".
   */
  reserve?: string[];
  /** How many context words the base already consumes (nested REST names). */
  minDepth?: number;
  /** True when a version segment was dropped from the path. */
  droppedVersion: boolean;
}

/** Singularize the last word of a phrase: "saved-places" -> "saved-place". */
function singularPhrase(phrase: string): string {
  const words = phrase.split("-");
  words[words.length - 1] = pluralize.singular(words[words.length - 1] as string);
  return words.join("-");
}

function isParam(segment: string): boolean {
  return segment.startsWith("{") || segment.startsWith(":");
}

/** The intent verbs each HTTP method implies when the path is plain REST. */
const METHOD_VERBS: Record<string, { member: string; collection: string }> = {
  get: { member: "get", collection: "list" },
  // POST on a member path attaches something to it (an association), so the
  // verb is "add" and the name carries the parent; "post" is a transport
  // word and names nothing.
  post: { member: "add", collection: "create" },
  put: { member: "update", collection: "update" },
  patch: { member: "update", collection: "update" },
  delete: { member: "delete", collection: "delete" },
};

/** Chrome's published guidance: tool names stay within 30 characters. */
const TOOL_NAME_MAX_LENGTH = 30;

function intentName(
  verb: string,
  noun: string,
  context: string[],
  minDepth: number,
  droppedVersion: boolean,
  reserve: string[] = [],
): RouteAnalysis {
  // Context is stored nearest-first, but names read outermost-first:
  // "list-explore-destination-candidates", not "list-destination-explore-...".
  const used = context.slice(0, minDepth).reverse();
  const base = [verb, ...used, noun].filter(Boolean).join("-");
  return { base, tier: "intent", verb, noun, context, minDepth, droppedVersion, reserve };
}

/**
 * Derive an intent-shaped name from an HTTP method and route path.
 *
 * Two shapes are recognized:
 *
 *   Action endpoints - the last segment starts with a known verb, so the
 *   name is the action: POST /trips/{id}/story/generate -> "generate-story".
 *   Action names stay minimal; parent context is spent only on collision.
 *
 *   Plain REST - the method implies the verb and the path shape says member
 *   or collection: POST /trips -> "create-trip", GET /trips/{id} ->
 *   "get-trip", GET /trips/{id}/blocks -> "list-trip-blocks". Nested reads
 *   and writes include the immediate parent, because every API nests list
 *   and get somewhere and parentless names collide constantly.
 *
 * Anything else falls back to the method+path concat, which can never fail
 * to produce a name - it can only produce a boring one.
 */
export function analyzeRoute(method: string, path: string): RouteAnalysis {
  const segments = path.split("/").filter(Boolean);
  const rest = segments.filter((s) => !VERSION_SEGMENT.test(s));
  const droppedVersion = rest.length !== segments.length;

  // Walk the path once, keeping resource segments in order and noting where
  // params sit between them - a param between two resources is what makes a
  // name nested ("trips/{id}/blocks" is nested; "trips/{id}" is not).
  // A member word mid-path merges into its parent as a scope marker:
  // "/users/me/stamps" is read as "current-user -> stamps", not "users, me,
  // stamps" - "me" names no resource of its own.
  const resources: { phrase: string; nestedUnderMember: boolean }[] = [];
  let sawParam = false;
  for (const segment of rest) {
    if (isParam(segment)) {
      sawParam = true;
      continue;
    }
    const phrase = toToolName(segment);
    const prev = resources[resources.length - 1];
    if (MEMBER_WORDS.has(phrase) && prev) {
      prev.phrase = `current-${singularPhrase(prev.phrase)}`;
      sawParam = true; // a member scope nests what follows, like a param does
      continue;
    }
    resources.push({ phrase, nestedUnderMember: sawParam && resources.length > 0 });
    sawParam = false;
  }
  const lastIsParam = rest.length > 0 && isParam(rest[rest.length - 1] as string);

  // Consecutive trailing params distinguish lookups: "/trips/{tripId}" is a
  // plain member read, but "/trips/{username}/{slug}" is "get-trip-by-slug".
  let trailingParams = 0;
  for (let i = rest.length - 1; i >= 0 && isParam(rest[i] as string); i--) trailingParams++;
  const lastParam =
    trailingParams >= 2
      ? toToolName((rest[rest.length - 1] as string).replace(/^[{:]|[}$]/g, ""))
      : null;

  const fallback: RouteAnalysis = {
    base: nameFromRoute(method, path),
    tier: "fallback",
    droppedVersion,
  };
  if (resources.length === 0) return fallback;

  const last = resources[resources.length - 1] as (typeof resources)[number];
  const firstWord = last.phrase.split("-")[0] as string;
  // Ancestors, nearest first. Grouping words leave the name ("auth" in a
  // deepened name only restates the obvious) but stay in reserve: when a
  // collision has nothing else left, "admin" beats a numeric suffix.
  const rawAncestors = resources
    .slice(0, -1)
    .map((r) => singularPhrase(r.phrase))
    .reverse();
  const ancestors = rawAncestors.filter((a) => !GROUPING_SEGMENTS.has(a));
  const reserve = rawAncestors.filter((a) => GROUPING_SEGMENTS.has(a));

  // "batch" is a modifier, never the verb: "batch-trip-blocks" reads as a
  // tool about batching, not as blocks being written. The verb comes from
  // the rest of the segment ("batch-delete" -> "delete-media-batch") or from
  // the method (".../blocks/batch" -> "update-trip-blocks-batch").
  if (firstWord === "batch" && resources.length > 1) {
    const prev = resources[resources.length - 2] as (typeof resources)[number];
    const rest = last.phrase.split("-").slice(1).join("-");
    const verb = ACTION_VERBS.has(rest) ? (ACTION_VERB_FORMS[rest] ?? rest) : "update";
    const noun = prev.phrase;
    return intentName(verb, `${noun}-batch`, ancestors.slice(1), 0, droppedVersion, reserve);
  }

  // Action endpoint: the last segment starts with a known verb.
  if (ACTION_VERBS.has(firstWord)) {
    const verb = ACTION_VERB_FORMS[firstWord] ?? firstWord;
    if (last.phrase.includes("-")) {
      // "verify-otp" already carries its object; the object is the noun, so
      // deepening reads "verify-trip-otp", not "verify-trip-verify-otp".
      const noun = last.phrase.split("-").slice(1).join("-");
      return intentName(verb, noun, ancestors, 0, droppedVersion, reserve);
    }
    const prev = resources.length > 1 ? resources[resources.length - 2] : undefined;
    if (!prev || GROUPING_SEGMENTS.has(prev.phrase)) {
      // "POST /auth/login" is just "login"; "POST /search" is just "search".
      return intentName(verb, "", [], 0, droppedVersion, reserve);
    }
    const noun = PLURAL_ACTIONS.has(firstWord) ? prev.phrase : singularPhrase(prev.phrase);
    return intentName(verb, noun, ancestors.slice(1), 0, droppedVersion, reserve);
  }

  // Plain REST: the method supplies the verb, the path shape the noun.
  const verbs = METHOD_VERBS[method.toLowerCase()];
  if (!verbs) return fallback; // HEAD, OPTIONS, WebDAV - honest concat.

  // A trailing "all" scopes the parent collection rather than naming one:
  // "GET /pricing/all" is "list-all-pricing", never "get-all".
  if (method.toLowerCase() === "get" && last.phrase === "all" && resources.length > 1) {
    const prev = resources[resources.length - 2] as (typeof resources)[number];
    const noun = prev.phrase;
    return intentName(
      verbs.collection,
      noun,
      ["all", ...ancestors.slice(1)],
      1,
      droppedVersion,
      reserve,
    );
  }

  if (lastIsParam) {
    // GET /trips/{id} -> the member named by the last resource segment. Two
    // or more trailing params are a lookup by the last one:
    // GET /trips/{username}/{slug} -> "get-trip-by-slug".
    const noun = lastParam
      ? `${singularPhrase(last.phrase)}-by-${lastParam}`
      : singularPhrase(last.phrase);
    // An association write ("add") is ambiguous without its parent:
    // "add-destination" to what? Member-POST names carry the parent.
    const minDepth = verbs.member === "add" && ancestors.length > 0 && !lastParam ? 1 : 0;
    return intentName(verbs.member, noun, ancestors, minDepth, droppedVersion, reserve);
  }

  if (MEMBER_WORDS.has(last.phrase)) {
    // A bare trailing member word with no parent ("/me"): no noun to build.
    return intentName(verbs.member, last.phrase, [], 0, droppedVersion, reserve);
  }

  // A trailing resource word that reads plural is a collection; a singular
  // one is a singleton sub-resource (GET /auth/session -> "get-session").
  const member = !pluralize.isPlural(last.phrase.split("-").pop() as string);
  // POST with a trailing resource always creates one of it, whether the word
  // reads singular or plural: "create-trip-template", "create-trip-block".
  const verb = member && method.toLowerCase() !== "post" ? verbs.member : verbs.collection;
  // Collection nouns stay plural when the verb acts on the whole set
  // ("list-trips", "delete-trips"); "create" makes one, so "create-trip".
  const noun = member || verb === "create" ? singularPhrase(last.phrase) : last.phrase;

  // Nested under a member ("/trips/{id}/blocks"): the immediate parent goes
  // into the base name, because parentless nested names collide constantly.
  const parent = resources.length > 1 ? resources[resources.length - 2] : undefined;
  if (last.nestedUnderMember && parent && !GROUPING_SEGMENTS.has(parent.phrase)) {
    return intentName(verb, noun, ancestors, 1, droppedVersion, reserve);
  }

  return intentName(verb, noun, ancestors, 0, droppedVersion, reserve);
}

// --- The set-level pass ----------------------------------------------------

export interface NameInput {
  name: string;
  /**
   * Declared names (schema/manual sources, cleaned operationIds) are fixed:
   * they win collisions and are never deepened, because a human or a spec
   * author chose them on purpose.
   */
  declared: boolean;
  httpMethod?: string;
  pathTemplate?: string;
}

export interface ResolvedNames {
  names: string[];
  renames: { from: string; to: string }[];
  notes: string[];
  /**
   * Names that took a numeric suffix because no context, grouping word, or
   * method could distinguish them. The pipeline reports these as errors:
   * a "-2" name is the algorithm giving up, and the fix is a chosen name,
   * not a shipped number.
   */
  collisions: string[];
}

/**
 * Assign final names to a whole tool set.
 *
 * Route-derived names start minimal ("generate-story") and absorb parent
 * context on collision ("generate-trip-story") - minimal first because the
 * short name is usually unique, deepening because a bare noun stops saying
 * which resource once a second API has one. Ties break in order: parent
 * context, grouping words kept in reserve ("admin" beats a number), the
 * HTTP method, and only then a numeric suffix, which is always reported as
 * an error. Declared names always win a collision. Names never exceed
 * Chrome's 30-character guidance: context is spent to stay under it, not
 * to exceed it. Every rename is returned for the report.
 */
export function resolveNames(inputs: NameInput[]): ResolvedNames {
  const analyses = inputs.map((input) =>
    !input.declared && input.httpMethod && input.pathTemplate
      ? analyzeRoute(input.httpMethod, input.pathTemplate)
      : null,
  );

  const notes: string[] = [];
  if (analyses.some((a) => a?.droppedVersion)) {
    notes.push("Dropped the API version prefix from route-derived tool names.");
  }

  // The deepening pool: real context first, grouping words last.
  const pools = analyses.map((a) => [...(a?.context ?? []), ...(a?.reserve ?? [])]);

  const buildName = (index: number, depth: number): string => {
    const analysis = analyses[index];
    if (analysis?.tier !== "intent") return analysis?.base ?? inputs[index]?.name ?? "";
    const used = pools[index]?.slice(0, depth).reverse() ?? [];
    return [analysis.verb, ...used, analysis.noun].filter(Boolean).join("-");
  };

  // The ceiling: spend less context before spending more. A base over 30
  // characters shrinks toward its minimum; one still over at depth 0 is
  // noted, not mangled.
  const minDepths = analyses.map((a) => a?.minDepth ?? 0);
  analyses.forEach((analysis, index) => {
    if (analysis?.tier !== "intent") return;
    let floor = minDepths[index] as number;
    while (floor > 0 && buildName(index, floor).length > TOOL_NAME_MAX_LENGTH) floor--;
    if (floor !== minDepths[index]) {
      analysis.minDepth = floor;
      analysis.base = buildName(index, floor);
      notes.push(`Kept "${analysis.base}" under 30 characters by spending less context.`);
    }
    if (analysis.base.length > TOOL_NAME_MAX_LENGTH) {
      notes.push(
        `"${analysis.base}" is over 30 characters at its shortest; consider a declared name.`,
      );
    }
  });

  // The name each candidate started with, so renames can be reported.
  const bases = inputs.map((input, index) => analyses[index]?.base ?? input.name);
  const depth = analyses.map((a) => a?.minDepth ?? 0);
  // Candidates that took a method/counter suffix are fixed from then on.
  const fixed: (string | null)[] = inputs.map(() => null);

  const nameAt = (index: number): string => {
    const pinned = fixed[index];
    if (pinned) return pinned;
    const analysis = analyses[index];
    if (analysis?.tier !== "intent") return bases[index] as string;
    return buildName(index, depth[index] as number);
  };

  const collisions: string[] = [];

  for (let guard = 0; guard < 32; guard++) {
    const current = inputs.map((_, index) => nameAt(index));
    const byName = new Map<string, number[]>();
    current.forEach((name, index) => {
      byName.set(name, [...(byName.get(name) ?? []), index]);
    });
    const colliding = [...byName.values()].filter((group) => group.length > 1);
    if (colliding.length === 0) break;

    let deepened = false;
    for (const group of colliding) {
      for (const index of group) {
        const analysis = analyses[index];
        if (fixed[index] || !analysis || analysis.tier !== "intent") continue;
        const nextDepth = (depth[index] as number) + 1;
        if (nextDepth > (pools[index]?.length ?? 0)) continue;
        // Deepening past 30 characters trades one failure for another; the
        // method suffix says more than a 34-character name does.
        if (buildName(index, nextDepth).length > TOOL_NAME_MAX_LENGTH) continue;
        depth[index] = nextDepth;
        deepened = true;
      }
    }
    if (deepened) continue;

    // Nobody can deepen. The declared name (or the first arrival) keeps the
    // spot; the rest take a method suffix, then a counter. A method suffix
    // that repeats the verb says nothing ("get-trip-get"), so those go
    // straight to the counter - and the counter is always an error, because
    // a numbered name means the spec needs a human's word, not our digit.
    for (const group of colliding) {
      const ordered = [...group].sort(
        (a, b) => Number(!inputs[a]?.declared) - Number(!inputs[b]?.declared),
      );
      for (let k = 1; k < ordered.length; k++) {
        const index = ordered[k] as number;
        const base = nameAt(index);
        const method = inputs[index]?.httpMethod?.toLowerCase();
        let candidate =
          method && !base.startsWith(`${method}-`) ? `${base}-${method}` : `${base}-2`;
        if (candidate === `${base}-2`) collisions.push(base);
        let counter = 2;
        while (inputs.some((_, j) => j !== index && nameAt(j) === candidate)) {
          candidate = `${base}-${counter}`;
          counter += 1;
        }
        fixed[index] = candidate;
      }
    }
  }

  const names = inputs.map((_, index) => nameAt(index));
  const renames = names
    .map((to, index) => ({ from: bases[index] as string, to }))
    .filter((rename) => rename.from !== rename.to);

  return { names, renames, notes, collisions };
}
