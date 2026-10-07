import { writeFileSync } from "node:fs";
import { loadEnv } from "vite";
import { startFakeGoogle } from "./fake-google";

export default async function globalSetup() {
  Object.assign(process.env, loadEnv("test", process.cwd(), ""));
  const { resetDb, createTestUser } = await import("../helpers/db");
  const { createApiToken } = await import("@/lib/services/tokens");
  const { sql } = await import("@/lib/data/db");
  await resetDb();
  const actor = await createTestUser(process.env.AUTH_BYPASS_EMAIL);
  const { token } = await createApiToken(actor.userId, "e2e");
  writeFileSync("tests/e2e/.state.json", JSON.stringify({ token }));
  await sql.end();
  const fakeGoogle = await startFakeGoogle();
  return async () => {
    await new Promise<void>((resolve) => fakeGoogle.close(() => resolve()));
  };
}
