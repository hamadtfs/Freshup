import { describe, expect, it } from "vitest";
import {
  capacityPctToTier,
  tierForAudience,
  tierShortLabel,
  tierTextClass,
} from "./tiers";

describe("demand tier inversion (provider vs customer)", () => {
  it("maps high capacity to red for customers and green for providers", () => {
    expect(capacityPctToTier(80)).toBe("red");
    expect(tierForAudience(80, "provider")).toBe("green");
  });

  it("maps low capacity to green for customers and red for providers", () => {
    expect(capacityPctToTier(10)).toBe("green");
    expect(tierForAudience(10, "provider")).toBe("red");
  });

  it("keeps normal capacity blue for both audiences", () => {
    expect(capacityPctToTier(50)).toBe("blue");
    expect(tierForAudience(50, "provider")).toBe("blue");
  });
});

describe("provider short labels match inverted tier colors", () => {
  it("green tier reads as high demand for providers", () => {
    expect(tierShortLabel("green", "provider", "en")).toBe("High demand");
    expect(tierTextClass("green")).toContain("green");
  });

  it("red tier reads as low demand for providers", () => {
    expect(tierShortLabel("red", "provider", "en")).toBe("Low demand");
    expect(tierTextClass("red")).toContain("red");
  });

  it("closed tier shows no-providers label for customers", () => {
    expect(tierShortLabel("closed", "customer", "en")).toBe(
      "No providers available right now",
    );
    expect(tierTextClass("closed")).toContain("gray");
  });
});
