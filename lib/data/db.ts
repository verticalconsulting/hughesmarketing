import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __hmSql?: ReturnType<typeof postgres> };

// prepare:false is required for the Supabase transaction-mode pooler.
export const sql =
  globalForDb.__hmSql ?? postgres(process.env.DATABASE_URL ?? "", { prepare: false, max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.__hmSql = sql;

export const db = drizzle(sql, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
