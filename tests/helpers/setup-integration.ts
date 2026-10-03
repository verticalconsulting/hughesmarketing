import { afterAll, beforeEach } from "vitest";
import { sql } from "@/lib/data/db";
import { resetDb } from "./db";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await sql.end();
});
