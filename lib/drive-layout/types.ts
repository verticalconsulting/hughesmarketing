export type FileEntry = {
  /** Path relative to the client folder, forward slashes. */
  path: string;
  sha256: string;
  mtimeMs: number;
  /** First 14 lines of text files; "" for anything else. */
  head: string;
};

export type MoveReason = "topic-folder" | "local-service-pages" | "workflow-results" | "duplicate" | "strip-suffix";

export type Move = {
  /** Relative to the AI Assets root, forward slashes, e.g. "Myelitegutters.com/seo/a.md". */
  from: string;
  to: string;
  reason: MoveReason;
  /** Applied only when the caller passes includeOptional. */
  optional?: boolean;
  detail?: string;
};

export type Conflict = {
  /** Root-relative path of the file that was left alone. */
  path: string;
  kind: "duplicate-differs" | "destination-exists";
  detail: string;
};

export type Note = { path: string; message: string };

export type ClientPlan = { client: string; moves: Move[]; conflicts: Conflict[]; notes: Note[] };
