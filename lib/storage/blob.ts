import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

export interface BlobStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  signedUrl(key: string, seconds: number): Promise<string>;
}

// Kept on globalThis: Next compiles route handlers and server actions as separate bundles in dev,
// and each would otherwise get its own empty Map.
const globalForBlobs = globalThis as unknown as { __hmMemoryBlobs?: Map<string, { data: Uint8Array; contentType: string }> };
const memory = (globalForBlobs.__hmMemoryBlobs ??= new Map<string, { data: Uint8Array; contentType: string }>());

class MemoryBlobStore implements BlobStore {
  async put(key: string, data: Uint8Array, contentType: string) {
    memory.set(key, { data: new Uint8Array(data), contentType });
  }
  async get(key: string) {
    const v = memory.get(key);
    if (!v) throw new Error(`Blob not found: ${key}`);
    return v.data;
  }
  async signedUrl(key: string) {
    return `memory://${encodeURIComponent(key)}`;
  }
}

class SupabaseBlobStore implements BlobStore {
  private client = createClient(getEnv().NEXT_PUBLIC_SUPABASE_URL ?? "", getEnv().SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false },
  });
  private bucket = getEnv().SUPABASE_STORAGE_BUCKET;

  async put(key: string, data: Uint8Array, contentType: string) {
    const { error } = await this.client.storage.from(this.bucket).upload(key, data, { contentType, upsert: true });
    if (error) throw new Error(`Storage upload failed for ${key}: ${error.message}`);
  }
  async get(key: string) {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) throw new Error(`Storage download failed for ${key}: ${error?.message}`);
    return new Uint8Array(await data.arrayBuffer());
  }
  async signedUrl(key: string, seconds: number) {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(key, seconds);
    if (error || !data) throw new Error(`Signed URL failed for ${key}: ${error?.message}`);
    return data.signedUrl;
  }
}

let store: BlobStore | undefined;
export function getBlobStore(): BlobStore {
  store ??= getEnv().BLOB_DRIVER === "memory" ? new MemoryBlobStore() : new SupabaseBlobStore();
  return store;
}

export function resetMemoryBlobStore(): void {
  memory.clear();
}
