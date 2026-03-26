import { describe, expect, it } from "vitest";

import {
  buildReferralCodeSeed,
  buildReferralLink,
  normalizeReferralCode,
} from "@/lib/referrals";

describe("referrals helpers", () => {
  it("normalizes referral codes removing accents and unsupported characters", () => {
    expect(normalizeReferralCode(" fábrí_código 2026 ")).toBe("FABRI-CODIGO-2026");
  });

  it("creates a stable uppercase seed from the user name", () => {
    expect(buildReferralCodeSeed("João da Silva")).toBe("JOAO");
  });

  it("builds a public referral URL without duplicate slashes", () => {
    expect(buildReferralLink("https://dialogy.com.br/", "FABRI-1234")).toBe(
      "https://dialogy.com.br/r/FABRI-1234"
    );
  });
});
