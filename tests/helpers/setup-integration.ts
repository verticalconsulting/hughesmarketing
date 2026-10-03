import { afterAll, beforeEach } from "vitest";
import { sql } from "@/lib/data/db";
import { resetMemoryBlobStore } from "@/lib/storage/blob";
import { resetDb } from "./db";

beforeEach(async () => {
  await resetDb();
  resetMemoryBlobStore();
});

afterAll(async () => {
  await sql.end();
});
