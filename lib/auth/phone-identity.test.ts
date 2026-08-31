import { describe, expect, it } from "vitest"
import {
  isCustomerRegistrationIncomplete,
  phoneLookupVariants,
} from "./phone-identity"

describe("phoneLookupVariants", () => {
  it("includes E.164 and digits-only forms", () => {
    const v = phoneLookupVariants("+4790841234")
    expect(v).toContain("+4790841234")
    expect(v).toContain("4790841234")
    expect(v).toContain("90841234")
  })
})

describe("isCustomerRegistrationIncomplete", () => {
  it("requires a display name of at least 2 chars", () => {
    expect(isCustomerRegistrationIncomplete({})).toBe(true)
    expect(isCustomerRegistrationIncomplete({ displayName: "A" })).toBe(true)
    expect(isCustomerRegistrationIncomplete({ displayName: "Ada" })).toBe(false)
    expect(
      isCustomerRegistrationIncomplete({ metaFullName: "Ada Lovelace" }),
    ).toBe(false)
  })
})
