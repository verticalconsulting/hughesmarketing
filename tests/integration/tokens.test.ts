import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { createApiToken, listApiTokens, revokeApiToken, verifyApiToken } from "@/lib/services/tokens";

describe("api tokens", () => {
  it("creates, verifies, lists, and revokes tokens", async () => {
    const actor = await createTestUser("corey@test.local");
    const { id, token } = await createApiToken(actor.userId, "Claude Desktop");
    expect(token).toMatch(/^hm_[A-Za-z0-9_-]{40,}$/);
    expect(await verifyApiToken(token)).toMatchObject({ tokenId: id, userId: actor.userId, name: "Claude Desktop", email: "corey@test.local" });
    expect(await verifyApiToken("hm_wrong")).toBeNull();
    const [listed] = await listApiTokens(actor.userId);
    expect(listed.lastUsedAt).toBeInstanceOf(Date);
    expect(listed).not.toHaveProperty("tokenHash");
    await revokeApiToken(actor.userId, id);
    expect(await verifyApiToken(token)).toBeNull();
  });

  it("does not let one user revoke another user's token", async () => {
    const a = await createTestUser("a@test.local");
    const b = await createTestUser("b@test.local");
    const { token, id } = await createApiToken(a.userId, "A");
    await revokeApiToken(b.userId, id);
    expect(await verifyApiToken(token)).not.toBeNull();
  });
});
