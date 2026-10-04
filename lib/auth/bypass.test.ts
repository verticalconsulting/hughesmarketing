import { describe, expect, it } from "vitest";
import { bypassEmail } from "./bypass";

describe("bypassEmail", () => {
  it("is enabled only with both flags and never on Vercel", () => {
    expect(bypassEmail({ ALLOW_AUTH_BYPASS: "true", AUTH_BYPASS_EMAIL: "a@b.c" })).toBe("a@b.c");
    expect(bypassEmail({ ALLOW_AUTH_BYPASS: "false", AUTH_BYPASS_EMAIL: "a@b.c" })).toBeNull();
    expect(bypassEmail({ ALLOW_AUTH_BYPASS: "true" })).toBeNull();
    expect(bypassEmail({ ALLOW_AUTH_BYPASS: "true", AUTH_BYPASS_EMAIL: "a@b.c", VERCEL: "1" })).toBeNull();
  });
});
