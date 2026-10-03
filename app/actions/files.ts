"use server";
import { actorFor, requireUser } from "@/lib/auth/session";
import { attempt } from "@/lib/action-result";
import { splitFrontMatter } from "@/lib/domain/front-matter";
import { getBrandBySlug } from "@/lib/services/brands";
import { ValidationError } from "@/lib/services/errors";
import { fileDownloadUrl, listFiles, listVersions, readFile, writeFile } from "@/lib/services/files";

const brandIdFor = async (slug: string | null) => (slug ? (await getBrandBySlug(slug)).id : null);

export async function listFilesAction(brandSlug: string | null) {
  await requireUser();
  return listFiles({ brandId: await brandIdFor(brandSlug) });
}

export async function readFileAction(brandSlug: string | null, path: string, version?: number) {
  await requireUser();
  return attempt(async () => {
    const brandId = await brandIdFor(brandSlug);
    const f = await readFile({ brandId, path, version });
    return {
      path: f.path,
      version: f.version,
      contentType: f.contentType,
      size: f.size,
      text: f.text,
      downloadUrl: await fileDownloadUrl({ brandId, path: f.path, version: f.version }),
    };
  });
}

export async function listVersionsAction(brandSlug: string | null, path: string) {
  await requireUser();
  return listVersions({ brandId: await brandIdFor(brandSlug), path });
}

export async function uploadFileAction(formData: FormData) {
  const user = await requireUser();
  return attempt(async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a file to upload", "file");
    const slug = String(formData.get("brandSlug") ?? "") || null;
    const folder = String(formData.get("folder") ?? "").trim().replace(/^\/+|\/+$/g, "");
    const path = folder ? `${folder}/${file.name}` : file.name;
    const r = await writeFile({
      brandId: await brandIdFor(slug),
      path,
      content: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || undefined,
      actor: actorFor(user),
    });
    return { path: r.path, version: r.version };
  });
}

export async function listSkillsAction() {
  await requireUser();
  const all = await listFiles({ brandId: null, prefix: "skills/" });
  const skillFiles = all.filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f.path));
  return Promise.all(
    skillFiles.map(async (f) => {
      const { text } = await readFile({ brandId: null, path: f.path });
      const { data } = splitFrontMatter(text ?? "");
      return {
        name: f.path.split("/")[1],
        description: typeof data?.description === "string" ? data.description : "",
      };
    }),
  );
}
