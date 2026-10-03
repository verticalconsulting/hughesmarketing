import { describe, expect, it } from "vitest";
import { bypassEmail } from "./bypass";

describe("bypassEmail", () => {
  it("is enabled only with both flags and never on Vercel", () => {
    expect(bypassEmail({ ALLOW_AUTH_BYPASS: "true", AUTH_BYPASS_EMAIL: "a@b.c" } as NodeJS.ProcessEnv)).toBe("a@b.c");
    expect(bypassEmail({ ALLOW_AUTH_BYPASS: "false", AUTH_BYPASS_EMAIL: "a@b.c" } as NodeJS.ProcessEnv)).toBeNull();
    expect(bypassEmail({ ALLOW_AUTH_BYPASS: "true" } as NodeJS.ProcessEnv)).toBeNull();
    expect(bypassEmail({ ALLOW_AUTH_BYPASS: "true", AUTH_BYPASS_EMAIL: "a@b.c", VERCEL: "1" } as NodeJS.ProcessEnv)).toBeNull();
  });
});
