"use server";
import { requireUser } from "@/lib/auth/session";
import { attempt } from "@/lib/action-result";
import { createApiToken, listApiTokens, revokeApiToken } from "@/lib/services/tokens";

export async function createTokenAction(name: string) {
  const user = await requireUser();
  return attempt(async () => ({ token: (await createApiToken(user.id, name)).token }));
}

export async function listTokensAction() {
  const user = await requireUser();
  return listApiTokens(user.id);
}

export async function revokeTokenAction(id: string) {
  const user = await requireUser();
  await revokeApiToken(user.id, id);
}
