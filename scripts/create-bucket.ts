// Creates the private Storage bucket the app uses for files. Idempotent: safe to re-run.
// Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm tsx scripts/create-bucket.ts [bucket]
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.argv[2] ?? process.env.SUPABASE_STORAGE_BUCKET ?? "files";
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data: existing, error: listError } = await supabase.storage.listBuckets();
if (listError) {
  console.error(`Could not list buckets: ${listError.message}`);
  process.exit(1);
}
const found = existing.find((b) => b.name === bucket);
if (found) {
  if (found.public) {
    console.error(`Bucket "${bucket}" exists but is PUBLIC. Make it private in the Supabase dashboard before continuing.`);
    process.exit(1);
  }
  console.log(`Bucket "${bucket}" already exists and is private.`);
} else {
  const { error } = await supabase.storage.createBucket(bucket, { public: false, fileSizeLimit: "50MB" });
  if (error) {
    console.error(`Could not create bucket: ${error.message}`);
    process.exit(1);
  }
  console.log(`Created private bucket "${bucket}".`);
}
