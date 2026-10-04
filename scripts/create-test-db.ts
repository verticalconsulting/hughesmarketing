import postgres from "postgres";

const target = new URL(process.argv[2] ?? "postgresql://postgres:postgres@127.0.0.1:54322/hughes_test");
const dbName = target.pathname.slice(1);
const admin = new URL(target);
admin.pathname = "/postgres";

const sql = postgres(admin.toString(), { max: 1 });
const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
if (rows.length === 0) {
  await sql.unsafe(`CREATE DATABASE "${dbName}"`);
  console.log(`Created database ${dbName}`);
} else {
  console.log(`Database ${dbName} already exists`);
}
await sql.end();
