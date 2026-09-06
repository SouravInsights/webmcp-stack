import { describe, expect, it } from "vitest";
import {
  describeCandidateInputs,
  describeCandidateTool,
  describeConstraints,
  describeField,
} from "./describe.js";
import type { CandidateTool } from "./types.js";

describe("describeConstraints", () => {
  it("renders a number range the way the WebMCP docs do", () => {
    expect(describeConstraints({ type: "number", minimum: 30, maximum: 600 })).toBe(
      "A number from 30 to 600.",
    );
  });

  it("renders one-sided number bounds", () => {
    expect(describeConstraints({ type: "number", minimum: 1 })).toBe("A number, at least 1.");
    expect(describeConstraints({ type: "integer", maximum: 10 })).toBe(
      "A whole number, at most 10.",
    );
  });

  it("renders exclusive bounds without pretending they are inclusive", () => {
    expect(describeConstraints({ type: "number", exclusiveMinimum: 0, exclusiveMaximum: 5 })).toBe(
      "A number greater than 0 and less than 5.",
    );
  });

  it("renders enums as a value list", () => {
    expect(describeConstraints({ enum: ["a", "b"] })).toBe('One of: "a", "b".');
  });

  it("renders string lengths, skipping the minLength-1 noise", () => {
    // z.string().min(1) is the universal "required string" spelling; naming it
    // would put "at least 1 characters" on half the fields in the world.
    expect(describeConstraints({ type: "string", minLength: 1, maxLength: 40 })).toBe(
      "At most 40 characters.",
    );
    expect(describeConstraints({ type: "string", minLength: 1 })).toBe("");
    expect(describeConstraints({ type: "string", minLength: 3 })).toBe("At least 3 characters.");
  });

  it("renders known formats and patterns", () => {
    expect(describeConstraints({ type: "string", format: "date" })).toBe("A date (YYYY-MM-DD).");
    expect(describeConstraints({ type: "string", pattern: "^[A-Z]{2}-\\d+$" })).toBe(
      "Must match /^[A-Z]{2}-\\d+$/.",
    );
    // A format the model likely does not know helps nobody; silence is honest.
    expect(describeConstraints({ type: "string", format: "cuid2" })).toBe("");
  });

  it("does not render a known format's own regex as prose", () => {
    // zod emits z.string().email() as format + pattern; the pattern is the
    // format's implementation, and a regex dump helps no agent.
    const result = describeConstraints({ type: "string", format: "email", pattern: "^\\S+@\\S+$" });
    expect(result).toBe("An email address.");
  });

  it("renders array sizes", () => {
    expect(describeConstraints({ type: "array", minItems: 1, maxItems: 5 })).toBe(
      "A list of 1 to 5 items.",
    );
  });

  it("says nothing when there is nothing worth saying", () => {
    expect(describeConstraints({ type: "boolean" })).toBe("");
    expect(describeConstraints({ type: "object" })).toBe("");
  });
});

describe("describeField", () => {
  it("keeps author text verbatim and appends missing constraints", () => {
    const result = describeField("minutes_worked", {
      type: "number",
      minimum: 30,
      maximum: 600,
      description: "Minutes worked on this task.",
    });
    expect(result.description).toBe("Minutes worked on this task. A number from 30 to 600.");
    expect(result.synthesized).toBe(false);
  });

  it("does not append constraints the author text already states", () => {
    const result = describeField("title", {
      type: "string",
      maxLength: 40,
      description: "Name of the trip, 40 characters max.",
    });
    expect(result.description).toBe("Name of the trip, 40 characters max.");
  });

  it("drafts a marked description for silent fields", () => {
    const result = describeField("purchaseDate", { type: "string", format: "date" });
    expect(result.description).toBe("Purchase date. A date (YYYY-MM-DD).");
    expect(result.synthesized).toBe(true);
  });
});

describe("describeCandidateInputs", () => {
  function candidateWith(properties: Record<string, object>): CandidateTool {
    return {
      id: "schema:book-trip",
      name: "book-trip",
      source: { kind: "schema", ref: "book-trip" },
      inputSchema: { type: "object", properties: properties as never, required: [] },
      inputTypeName: "BookTripInput",
      sideEffect: "unknown",
      requiresAuth: false,
      description: "Book a trip.",
      descriptionSource: "declared",
    };
  }

  it("records exactly which fields were machine-drafted", () => {
    const candidate = candidateWith({
      title: { type: "string", maxLength: 40, description: "Name of the trip." },
      guests: { type: "number", minimum: 1, maximum: 10 },
    });
    describeCandidateInputs(candidate);
    expect(candidate.synthesizedFields).toEqual(["guests"]);
    expect(candidate.inputSchema.properties?.title?.description).toBe(
      "Name of the trip. At most 40 characters.",
    );
    expect(candidate.inputSchema.properties?.guests?.description).toBe(
      "Guests. A number from 1 to 10.",
    );
  });

  it("leaves a fieldless candidate alone", () => {
    const candidate = candidateWith({});
    describeCandidateInputs(candidate);
    expect(candidate.synthesizedFields).toEqual([]);
  });
});

describe("stub descriptions and format-aware drafts", () => {
  it("treats a stub description as absent, not author intent", () => {
    const result = describeField("x", { type: "number", description: "X.", minimum: 0 });
    expect(result.synthesized).toBe(true);
    // The stub "X." restates the field name and adds nothing; the draft is
    // the name plus the constraint text, marked as machine-written.
    expect(result.description).toBe("X. A number, at least 0.");
    expect(result.description).not.toBe("X.");
  });

  it("keeps real author text", () => {
    const result = describeField("title", { type: "string", description: "Name of the trip." });
    expect(result.synthesized).toBe(false);
    expect(result.description).toBe("Name of the trip.");
  });

  it("drafts carry the format when the name already says the noun", () => {
    const result = describeField("tripId", { type: "string", format: "uuid" });
    expect(result.description).toBe("The unique identifier of the trip. A UUID.");
    expect(result.synthesized).toBe(true);
  });
});

describe("pattern sentences", () => {
  it("reads conventional names as the sentences they carry", () => {
    expect(describeField("tripId", { type: "string" }).description).toBe(
      "The unique identifier of the trip.",
    );
    expect(describeField("coverImageUrl", { type: "string" }).description).toBe(
      "The URL of the cover image.",
    );
    expect(describeField("photoCount", { type: "integer" }).description).toBe(
      "The number of photos.",
    );
    expect(describeField("hideBranding", { type: "boolean" }).description).toBe(
      "Whether to hide branding.",
    );
  });

  it("uses the enclosing noun when the name has no stem", () => {
    expect(describeField("id", { type: "string" }, { noun: "trip" }).description).toBe(
      "The unique identifier of the trip.",
    );
    expect(describeField("createdAt", { type: "string" }, { noun: "trip" }).description).toBe(
      "When the trip was created.",
    );
    expect(describeField("emailVerifiedAt", { type: "string" }, { noun: "user" }).description).toBe(
      "When the email was verified.",
    );
  });

  it("falls back to the humanized name when no pattern holds", () => {
    expect(describeField("id", { type: "string" }).description).toBe("Id.");
    expect(describeField("title", { type: "string" }).description).toBe("Title.");
    // The whether-to reading is only safe on booleans.
    expect(describeField("hideBranding", { type: "string" }).description).toBe("Hide branding.");
  });

  it("lets the format sentence stand alone when it already says the noun", () => {
    const result = describeField("email", { type: "string", format: "email" });
    expect(result.description).toBe("An email address.");
    expect(result.synthesized).toBe(true);
    // A name the format does not cover still leads the draft.
    expect(describeField("contactEmail", { type: "string", format: "email" }).description).toBe(
      "Contact email. An email address.",
    );
  });

  it("threads the tool's noun into top-level fields", () => {
    const candidate = {
      name: "create-trip",
      inputSchema: { type: "object", properties: { id: { type: "string" } } },
    } as unknown as CandidateTool;
    describeCandidateInputs(candidate);
    expect(candidate.inputSchema.properties?.id?.description).toBe(
      "The unique identifier of the trip.",
    );
  });
});

describe("describeCandidateTool", () => {
  const base = { name: "list-trips", inputSchema: { type: "object" as const } };

  it("appends the return shape when the description never says it", () => {
    const candidate = {
      ...base,
      description: "List all trips for the authenticated user",
      descriptionSource: "openapi-summary" as const,
      outputSchema: { type: "array" as const, items: { type: "object" as const } },
    };
    describeCandidateTool(candidate as never);
    expect(candidate.description).toBe(
      "List all trips for the authenticated user. Returns an array of trips.",
    );
  });

  it("leaves descriptions that already say what comes back alone", () => {
    const candidate = {
      ...base,
      description: "List all trips. Returns the user's trips.",
      descriptionSource: "openapi-summary" as const,
      outputSchema: { type: "array" as const, items: { type: "object" as const } },
    };
    describeCandidateTool(candidate as never);
    expect(candidate.description).toBe("List all trips. Returns the user's trips.");
  });

  it("normalizes Title Case UI labels into sentences", () => {
    const candidate = {
      ...base,
      description: "Get My Unlocked Stamps",
      descriptionSource: "openapi-summary" as const,
    };
    describeCandidateTool(candidate as never);
    expect(candidate.description).toBe("Get my unlocked stamps.");
  });

  it("keeps acronyms capitalized in labels", () => {
    const candidate = {
      ...base,
      description: "Verify OTP Code",
      descriptionSource: "openapi-summary" as const,
    };
    describeCandidateTool(candidate as never);
    expect(candidate.description).toBe("Verify OTP code.");
  });

  it("drafts a marked description for a tool with none", () => {
    const candidate = {
      ...base,
      description: "",
      descriptionSource: "generated-template" as const,
      outputSchema: { type: "object" as const },
    };
    describeCandidateTool(candidate as never);
    expect(candidate.description).toBe("List trips. Returns the trips.");
    expect(candidate.descriptionSource).toBe("generated-template");
  });

  it("a member with a nested array is not an envelope", () => {
    const candidate = {
      ...base,
      name: "get-trip",
      description: "Get a single trip by ID.",
      descriptionSource: "openapi-summary" as const,
      outputSchema: {
        type: "object" as const,
        properties: { photos: { type: "array" as const, items: { type: "object" as const } } },
      },
    };
    describeCandidateTool(candidate as never);
    expect(candidate.description).toBe("Get a single trip by ID. Returns the trip.");
  });

  it("a conventional wrapper key is an envelope", () => {
    const candidate = {
      ...base,
      description: "List all trips.",
      descriptionSource: "openapi-summary" as const,
      outputSchema: {
        type: "object" as const,
        properties: { items: { type: "array" as const, items: { type: "object" as const } } },
      },
    };
    describeCandidateTool(candidate as never);
    expect(candidate.description).toBe("List all trips. Returns an array of trips.");
  });
});

describe("describeCandidateInputs nested walk", () => {
  it("describes array item fields and nested object fields", () => {
    const candidate = {
      name: "generate-story",
      inputSchema: {
        type: "object",
        properties: {
          photos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                capturedAt: { type: "string", format: "date-time" },
                location: {
                  type: "object",
                  properties: { lat: { type: "number", minimum: -90, maximum: 90 } },
                },
              },
            },
          },
        },
      },
    } as unknown as CandidateTool;
    describeCandidateInputs(candidate);
    const photos = candidate.inputSchema.properties?.photos;
    const items = photos?.items;
    expect(items?.properties?.capturedAt?.description).toBe(
      "When the photo was captured. A date-time in ISO 8601 format.",
    );
    expect(items?.properties?.location?.properties?.lat?.description).toBe(
      "Lat. A number from -90 to 90.",
    );
    expect(candidate.synthesizedFields).toContain("photos[].capturedAt");
    expect(candidate.synthesizedFields).toContain("photos[].location.lat");
  });
});

describe("describeCandidateInputs through nullable wrappers", () => {
  it("describes the fields of a nullable object instead of shipping them bare", () => {
    const candidate = {
      name: "create-trip",
      inputSchema: {
        type: "object",
        properties: {
          location: {
            anyOf: [
              {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
              { type: "null" },
            ],
          },
        },
      },
    } as unknown as CandidateTool;
    describeCandidateInputs(candidate);
    const location = candidate.inputSchema.properties?.location;
    expect(location?.description).toBe("Location.");
    expect(location?.anyOf?.[0]?.properties?.name?.description).toBe("Name.");
    expect(candidate.synthesizedFields).toEqual(["location", "location.name"]);
  });

  it("reads constraints and formats through the wrapper", () => {
    const candidate = {
      name: "create-trip",
      inputSchema: {
        type: "object",
        properties: {
          startDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        },
      },
    } as unknown as CandidateTool;
    describeCandidateInputs(candidate);
    expect(candidate.inputSchema.properties?.startDate?.description).toBe(
      "Start date. A date (YYYY-MM-DD).",
    );
  });

  it("keeps author text written inside the wrapper", () => {
    const candidate = {
      name: "create-trip",
      inputSchema: {
        type: "object",
        properties: {
          bio: {
            anyOf: [
              { type: "string", description: "A short biography shown on the profile." },
              { type: "null" },
            ],
          },
        },
      },
    } as unknown as CandidateTool;
    describeCandidateInputs(candidate);
    expect(candidate.inputSchema.properties?.bio?.description).toBe(
      "A short biography shown on the profile.",
    );
    expect(candidate.synthesizedFields).toEqual([]);
  });
});
