import { describe, expect, it } from "vitest";
import { normalizeToE164 } from "./phone";

describe("normalizeToE164", () => {
  it("keeps already-valid Norway E.164", () => {
    expect(normalizeToE164("+4790841234")).toBe("+4790841234");
  });

  it("adds + when Auth/Twilio receive digits-only 47… (error 21211)", () => {
    expect(normalizeToE164("4790841234")).toBe("+4790841234");
  });

  it("prefixes +47 for 8-digit Norwegian local numbers", () => {
    expect(normalizeToE164("90841234")).toBe("+4790841234");
  });

  it("strips spaces and 00 international prefix", () => {
    expect(normalizeToE164("+47 90 84 12 34")).toBe("+4790841234");
    expect(normalizeToE164("004790841234")).toBe("+4790841234");
  });

  it("rejects too-short input", () => {
    expect(normalizeToE164("123")).toBeNull();
    expect(normalizeToE164("")).toBeNull();
  });
});
