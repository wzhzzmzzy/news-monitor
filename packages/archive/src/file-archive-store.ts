import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { ArchiveStore, Artifact, ArtifactQuery, ArtifactRef, ArtifactType, WriteArtifactInput } from "./types.js";

export interface FileArchiveStoreOptions {
  rootDir: string;
  now?: () => Date;
  idFactory?: () => string;
}

const typeDirs: Record<ArtifactType, string> = {
  "news.raw": "artifacts/news/raw",
  "news.annotated": "artifacts/news/annotated",
  "topics.index": "artifacts/topics",
  reports: "artifacts/reports",
  runs: "artifacts/runs",
  logs: "artifacts/logs"
};

export class FileArchiveStore implements ArchiveStore {
  private readonly rootDir: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: FileArchiveStoreOptions) {
    this.rootDir = options.rootDir;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  async writeArtifact<TData>(input: WriteArtifactInput<TData>): Promise<ArtifactRef> {
    const createdAt = this.now().toISOString();
    const id = `${input.type.replace(".", "-")}-${this.idFactory()}`;
    const relPath = join(typeDirs[input.type], `${createdAt.replaceAll(":", "-")}-${id}.json`);
    const absPath = join(this.rootDir, relPath);
    const ref: ArtifactRef = { id, type: input.type, path: relPath, createdAt };
    const artifact: Artifact<TData> = {
      ref,
      data: input.data,
      metadata: input.metadata ?? {}
    };

    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    return ref;
  }

  async readArtifact<TData = unknown>(ref: ArtifactRef): Promise<Artifact<TData>> {
    const raw = await readFile(join(this.rootDir, ref.path), "utf8");
    return JSON.parse(raw) as Artifact<TData>;
  }

  async listArtifacts(query: ArtifactQuery = {}): Promise<ArtifactRef[]> {
    const types = query.type ? [query.type] : (Object.keys(typeDirs) as ArtifactType[]);
    const refs: ArtifactRef[] = [];

    for (const type of types) {
      const dir = join(this.rootDir, typeDirs[type]);
      const files = await this.safeReadDir(dir);
      for (const file of files.filter((name) => name.endsWith(".json"))) {
        const raw = await readFile(join(dir, file), "utf8");
        const artifact = JSON.parse(raw) as Artifact;
        refs.push({
          ...artifact.ref,
          path: relative(this.rootDir, join(dir, file))
        });
      }
    }

    refs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return typeof query.limit === "number" ? refs.slice(0, query.limit) : refs;
  }

  private async safeReadDir(dir: string): Promise<string[]> {
    try {
      return await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}
