/**
 * The describe layer: assembling the field text an agent reads.
 *
 * Why this exists: agents fill tool inputs from field descriptions, and most
 * contracts carry none. A `{ type: "number", minimum: 30, maximum: 600 }`
 * reaches the agent as just "a number", the first call fails validation, and
 * the run dies in a retry loop. Chrome's own WebMCP examples put the
 * constraint in the prose ("Minutes worked on this task. A number from 30 to
 * 600."), so this layer renders constraints as plain language.
 *
 * The rules that keep it trustworthy:
 *
 *   - Append, never replace. Author text (a spec description, a `.describe()`)
 *     stays verbatim; synthesized constraints follow it. The author's words are
 *     always the better text.
 *   - Only fill silence. A field with no text at all gets a draft built from
 *     its name, type, and constraints, and that field is marked as
 *     machine-written so the audit can see it. Machine text is a floor, not a
 *     finish.
 *   - Deterministic. Same schema in, same text out, no key, no network. The
 *     audit is only meaningful if a CI run is reproducible.
 *
 * This module covers layers 1-3 of the assembly order (source text, merge,
 * synthesis). Layer 4 (LLM drafts) is advisory and lives in llm.ts; layer 5
 * (overrides) lives in the pipeline's override step, applied last so it wins.
 */

import pluralize from "pluralize";
import type { CandidateTool, JsonSchema } from "./types.js";

/**
 * Render a schema's constraints as plain-language sentences, or "" when there
 * is nothing worth saying. The wording mirrors the examples in Chrome's WebMCP
 * docs, so generated text reads like the documentation developers have seen.
 */
export function describeConstraints(schema: JsonSchema): string {
  const sentences: string[] = [];

  if (schema.const !== undefined) {
    sentences.push(`Always ${JSON.stringify(schema.const)}.`);
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const values = schema.enum.map((value) => JSON.stringify(value)).join(", ");
    sentences.push(`One of: ${values}.`);
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "number" || type === "integer") {
    const sentence = numberConstraintSentence(schema, type === "integer");
    if (sentence) sentences.push(sentence);
  }

  if (type === "string") {
    sentences.push(...stringConstraintSentences(schema));
  }

  if (type === "array") {
    const min = typeof schema.minItems === "number" ? schema.minItems : undefined;
    const max = typeof schema.maxItems === "number" ? schema.maxItems : undefined;
    if (min !== undefined && max !== undefined) {
      sentences.push(`A list of ${min} to ${max} items.`);
    } else if (max !== undefined) {
      sentences.push(`A list of at most ${max} items.`);
    } else if (min !== undefined && min > 0) {
      sentences.push(`A list of at least ${min} item${min === 1 ? "" : "s"}.`);
    }
  }

  return sentences.join(" ");
}

function numberConstraintSentence(schema: JsonSchema, whole: boolean): string | undefined {
  const noun = whole ? "A whole number" : "A number";
  const min = typeof schema.minimum === "number" ? schema.minimum : undefined;
  const max = typeof schema.maximum === "number" ? schema.maximum : undefined;
  const exMin = typeof schema.exclusiveMinimum === "number" ? schema.exclusiveMinimum : undefined;
  const exMax = typeof schema.exclusiveMaximum === "number" ? schema.exclusiveMaximum : undefined;

  if (min !== undefined && max !== undefined) return `${noun} from ${min} to ${max}.`;
  if (exMin !== undefined && exMax !== undefined) {
    return `${noun} greater than ${exMin} and less than ${exMax}.`;
  }
  if (min !== undefined) return `${noun}, at least ${min}.`;
  if (max !== undefined) return `${noun}, at most ${max}.`;
  if (exMin !== undefined) return `${noun} greater than ${exMin}.`;
  if (exMax !== undefined) return `${noun} less than ${exMax}.`;
  return undefined;
}

function stringConstraintSentences(schema: JsonSchema): string[] {
  const sentences: string[] = [];
  const min = typeof schema.minLength === "number" ? schema.minLength : undefined;
  const max = typeof schema.maxLength === "number" ? schema.maxLength : undefined;

  // minLength: 1 is the universal "required string" spelling (z.string().min(1));
  // saying "at least 1 characters" to an agent is noise, so it is skipped.
  if (min !== undefined && max !== undefined) {
    sentences.push(
      min <= 1 ? `At most ${max} characters.` : `Between ${min} and ${max} characters.`,
    );
  } else if (max !== undefined) {
    sentences.push(`At most ${max} characters.`);
  } else if (min !== undefined && min > 1) {
    sentences.push(`At least ${min} characters.`);
  }

  const format = FORMAT_SENTENCES[schema.format ?? ""];
  if (format) sentences.push(format);
  // A pattern next to a known format is the format's implementation (this is
  // how zod emits z.string().email()); the regex is noise in prose.
  if (typeof schema.pattern === "string" && !format) {
    sentences.push(`Must match /${schema.pattern}/.`);
  }
  return sentences;
}

/** Formats worth naming to an agent. Unknown formats are skipped: naming a
 *  format the model does not know helps nobody, and the validator still has
 *  the last word server-side. */
const FORMAT_SENTENCES: Record<string, string> = {
  date: "A date (YYYY-MM-DD).",
  "date-time": "A date-time in ISO 8601 format.",
  email: "An email address.",
  uri: "A URL.",
  url: "A URL.",
  uuid: "A UUID.",
};

/**
 * The constraint values a description would have to mention to count as
 * "already stated". Value-mention is deliberately crude: when in doubt we
 * append, because a duplicated constraint is harmless and a missing one is a
 * failed agent call. minLength: 1 is excluded, matching the sentence
 * renderer: it spells "required string", and no author writes "1" to say it.
 */
function statedValues(schema: JsonSchema): string[] {
  const values: string[] = [];
  for (const key of ["minimum", "maximum", "maxLength", "minItems", "maxItems"] as const) {
    const value = schema[key];
    if (typeof value === "number") values.push(String(value));
  }
  const minLength = schema.minLength;
  if (typeof minLength === "number" && minLength > 1) values.push(String(minLength));
  for (const member of Array.isArray(schema.enum) ? schema.enum : []) {
    values.push(String(member));
  }
  return values;
}

/** True when the author text already mentions every constraint value. */
function alreadyStatesConstraints(text: string, schema: JsonSchema): boolean {
  const values = statedValues(schema);
  return values.length > 0 && values.every((value) => text.includes(value));
}

/** "purchaseDate" / "purchase_date" / "purchase-date" → "Purchase date".
 *  Sentence case, matching the field text in Chrome's WebMCP examples; these
 *  are machine drafts that the audit flags, not final copy. */
function humanizeFieldName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Boolean names whose first word is a verb: hideBranding asks "whether to". */
const BOOLEAN_VERB_PREFIXES = new Set(["allow", "show", "hide", "enable", "disable"]);

/** Segments that follow the verb in a tool name but name nothing ("up" in "sign-up"). */
const NON_NOUN_SEGMENTS = new Set(["up", "in", "out", "off", "all", "by", "current"]);

/**
 * Conventional names carry meaning a bare schema does not: every `*Id` is an
 * identifier, every `*Url` is a URL, every `*At` is when something happened.
 * A small set of conventions that always holds, rendered as sentences with no
 * model involved. A name that matches nothing here falls back to its
 * humanized form; a pattern that would need guessing is not a pattern.
 *
 * `noun` is the subject to use when the name itself carries none ("id" inside
 * create-trip): the enclosing field's name, or the tool's noun at the top.
 */
function patternSentence(name: string, schema: JsonSchema, noun?: string): string | undefined {
  const words = humanizeFieldName(name).toLowerCase().split(" ").filter(Boolean);
  const last = words[words.length - 1];
  const stem = words.slice(0, -1).join(" ");
  const subject = stem || noun;

  if (last === "id" && subject) return `The unique identifier of the ${subject}.`;
  if (last === "url" && subject) return `The URL of the ${subject}.`;
  if (last === "at" && words.length > 1) {
    // The stem's last word is the event ("captured"); anything before it is
    // what it happened to ("email verified at" → the email).
    const happenedTo = words.slice(0, -2).join(" ") || noun;
    if (happenedTo) return `When the ${happenedTo} was ${words[words.length - 2]}.`;
  }
  if (last === "count" && stem) return `The number of ${pluralize.plural(stem)}.`;
  const first = words[0];
  if (schema.type === "boolean" && words.length > 1 && first && BOOLEAN_VERB_PREFIXES.has(first)) {
    return `Whether to ${words.join(" ")}.`;
  }
  return undefined;
}

/**
 * The noun a tool acts on, from its name: "create-trip" → "trip". Our own
 * naming rules put the verb first, so the next segment that means something
 * is the noun. Only a fallback subject for pattern sentences.
 */
function toolNounFromName(name: string): string | undefined {
  for (const segment of name.split("-").slice(1)) {
    if (!segment || NON_NOUN_SEGMENTS.has(segment) || /^v\d+$/.test(segment)) continue;
    return pluralize.singular(segment);
  }
  return undefined;
}

/** The subject a field's children fall back to: the field's own name,
 *  singularized for arrays ("photos[]" fields each describe one photo). */
function fieldNoun(name: string, schema: JsonSchema): string {
  const words = humanizeFieldName(name).toLowerCase().split(" ").filter(Boolean);
  const lastIndex = words.length - 1;
  if (schema.type === "array" && lastIndex >= 0) {
    words[lastIndex] = pluralize.singular(words[lastIndex] as string);
  }
  return words.join(" ");
}

/**
 * A spec author writing "X." or "The id." has not described the field; they
 * have closed their editor. Stub text is treated as absent: the field gets a
 * synthesized draft and the audit warns, rather than the stub passing as
 * author intent and shipping to the agent.
 */
function isStubDescription(text: string): boolean {
  const words = text
    .replace(/[.\s]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return words.length <= 3;
}

/**
 * Assemble one field's description. Returns the text plus whether the text is
 * machine-drafted (no author text existed at all), which the audit reports on.
 */
export function describeField(
  name: string,
  schema: JsonSchema,
  context?: { noun?: string },
): { description: string; synthesized: boolean } {
  const raw = typeof schema.description === "string" ? schema.description.trim() : "";
  const authorText = raw && !isStubDescription(raw) ? raw : "";
  const constraints = describeConstraints(schema);

  if (authorText) {
    const needsConstraints = constraints && !alreadyStatesConstraints(authorText, schema);
    return {
      description: needsConstraints ? `${authorText} ${constraints}` : authorText,
      synthesized: false,
    };
  }

  // A conventional name ("tripId", "coverImageUrl") reads as a real sentence;
  // that beats the bare humanized name because it says what the name only
  // hints at. Anything else gets the name plus whatever the schema proves.
  const nameText = humanizeFieldName(name);
  const pattern = patternSentence(name, schema, context?.noun);
  if (pattern) {
    const suffix = constraints || FORMAT_SENTENCES[schema.format ?? ""] || "";
    return { description: suffix ? `${pattern} ${suffix}` : pattern, synthesized: true };
  }
  const format = FORMAT_SENTENCES[schema.format ?? ""];
  // "Email. An email address." says one thing twice: when the format sentence
  // already carries the noun, it is the draft on its own.
  if (format && constraints === format && format.toLowerCase().includes(nameText.toLowerCase())) {
    return { description: format, synthesized: true };
  }
  const draft =
    format && !constraints
      ? `${nameText} (${format.replace(/^An?\s+/i, "").replace(/\.$/, "")}).`
      : `${nameText}.${constraints ? ` ${constraints}` : ""}`;
  return { description: draft, synthesized: true };
}

/**
 * Nullable is usually spelled anyOf: [T, { type: "null" }] (TypeBox's
 * Type.Union, zod's .nullable()). The wrapper carries no meaning of its own:
 * the real schema is the non-null member, and that is where the constraints,
 * the format, and any nested properties live. Describe through it, or every
 * nullable object ships its inner fields bare.
 */
function unwrapNullable(schema: JsonSchema): JsonSchema {
  if (!Array.isArray(schema.anyOf) || schema.anyOf.length !== 2) return schema;
  const nonNull = schema.anyOf.filter((member) => member?.type !== "null");
  return nonNull.length === 1 && nonNull[0] ? nonNull[0] : schema;
}

/**
 * Run the describe layer over a candidate's input fields, in place. Fields
 * with author text keep it (constraints appended when missing); fields with
 * none get a marked draft. The walk covers array items and nested objects
 * two levels down: an agent fills `photos[].capturedAt` from its description
 * too, and a bare nested field fails the same way a bare top-level one does.
 * Records which fields were machine-drafted (dotted paths for nested ones)
 * so the audit can warn when a tool has nothing but.
 */
export function describeCandidateInputs(candidate: CandidateTool): void {
  const synthesized: string[] = [];

  const walk = (
    prefix: string,
    properties: Record<string, JsonSchema> | undefined,
    depth: number,
    noun: string | undefined,
  ): void => {
    if (!properties || depth > 2) return;
    for (const [name, fieldSchema] of Object.entries(properties)) {
      const path = prefix ? `${prefix}.${name}` : name;
      const inner = unwrapNullable(fieldSchema);
      // Author text sits on either side of a nullable wrapper; both are the
      // author's. The assembled text is written on the wrapper, so the shape
      // the agent reads is unchanged apart from the words.
      const { description, synthesized: wasSynthesized } = describeField(
        name,
        {
          ...inner,
          description: fieldSchema.description ?? inner.description,
        },
        { noun },
      );
      if (description) fieldSchema.description = description;
      if (wasSynthesized) synthesized.push(path);
      const childNoun = fieldNoun(name, inner);
      walk(path, inner.properties, depth + 1, childNoun);
      if (inner.items) walk(`${path}[]`, inner.items.properties, depth + 1, childNoun);
    }
  };

  walk("", candidate.inputSchema.properties, 0, toolNounFromName(candidate.name));
  candidate.synthesizedFields = synthesized;
}

/**
 * A Title Case label with no sentence punctuation is a UI string that
 * wandered into a description field ("Get My Unlocked Stamps"). Sentence
 * case it; all-caps acronyms (OTP, API) survive.
 */
function normalizeLabel(text: string): string {
  const words = text
    .replace(/[.!?]+$/, "")
    .split(/\s+/)
    .filter(Boolean);
  const isLabel =
    words.length > 1 && words.every((word) => /^[A-Z]/.test(word) || /^[^a-zA-Z]/.test(word));
  if (!isLabel) return text;
  const lowered = words
    .map((word, index) => (index === 0 || /^[A-Z0-9]+$/.test(word) ? word : word.toLowerCase()))
    .join(" ");
  return `${lowered}.`;
}

/** Words that mean the description already covers what comes back. */
const RETURN_LANGUAGE =
  /\b(returns?|response|responds?|yields?|gives? back|provides?|contains?)\b/i;

/** Keys that conventionally wrap the real payload: "{ data: [...] }". */
const WRAPPER_KEYS = new Set(["data", "items", "results", "records", "entries", "list"]);

/**
 * Build the "what it returns" sentence from the output schema, or "" when
 * the shape says nothing useful. The noun comes from the tool's own name:
 * "list-trips" returns an array of trips; "get-trip" returns the trip.
 */
/** Verb forms that occupy two words of the name: "sign-up", "log-out". */
const PHRASAL_VERBS = new Set(["sign-up", "sign-in", "sign-out", "log-in", "log-out"]);

function returnShapeSentence(toolName: string, output: JsonSchema): string {
  const words = toolName.split("-");
  // The noun is what the verb leaves behind — and a phrasal verb is two words.
  const firstTwo = words.slice(0, 2).join("-");
  const nounWords = PHRASAL_VERBS.has(firstTwo) ? words.slice(2) : words.slice(1);
  const nounPhrase = nounWords.join(" ").replace(/ by \w+$/, "");
  if (!nounPhrase) return "";
  const type = Array.isArray(output.type) ? output.type[0] : output.type;
  if (type === "array") return `Returns an array of ${nounPhrase}.`;
  if (type === "object") {
    // Only a conventional wrapper key makes this an envelope; an object that
    // merely contains an array somewhere ("{ trip: { photos: [...] } }")
    // still returns the thing itself.
    const wrapper = Object.entries(output.properties ?? {}).find(
      ([key, prop]) => WRAPPER_KEYS.has(key) && prop.type === "array",
    );
    if (wrapper) return `Returns an array of ${nounPhrase}.`;
    return `Returns the ${nounPhrase}.`;
  }
  return "";
}

/**
 * Assemble the tool-level description, in place. Author text wins verbatim
 * except for label normalization; a description that never says what comes
 * back gets the return-shape sentence appended from the output schema; a
 * tool with no description at all gets a marked draft from its name.
 */
export function describeCandidateTool(candidate: CandidateTool): void {
  const raw = typeof candidate.description === "string" ? candidate.description.trim() : "";

  if (!raw) {
    const words = candidate.name.split("-").join(" ");
    const sentence = words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}.` : "";
    const returns = candidate.outputSchema
      ? returnShapeSentence(candidate.name, candidate.outputSchema)
      : "";
    candidate.description = [sentence, returns].filter(Boolean).join(" ");
    candidate.descriptionSource = "generated-template";
    return;
  }

  const normalized = normalizeLabel(raw);
  const returns =
    candidate.outputSchema && !RETURN_LANGUAGE.test(normalized)
      ? returnShapeSentence(candidate.name, candidate.outputSchema)
      : "";
  // The join is between sentences: the base earns its period first.
  const base = returns && !/[.!?]$/.test(normalized) ? `${normalized}.` : normalized;
  candidate.description = [base, returns].filter(Boolean).join(" ");
}
