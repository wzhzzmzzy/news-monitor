export type ArtifactType =
  | "news.raw"
  | "news.annotated"
  | "topics.index"
  | "reports"
  | "runs"
  | "logs";

export interface ArtifactRef {
  id: string;
  type: ArtifactType;
  path: string;
  createdAt: string;
}

export interface Artifact<TData = unknown> {
  ref: ArtifactRef;
  data: TData;
  metadata: Record<string, unknown>;
}

export interface WriteArtifactInput<TData = unknown> {
  type: ArtifactType;
  data: TData;
  metadata?: Record<string, unknown>;
}

export interface ArtifactQuery {
  type?: ArtifactType;
  limit?: number;
}

export interface ArchiveStore {
  writeArtifact<TData>(input: WriteArtifactInput<TData>): Promise<ArtifactRef>;
  readArtifact<TData = unknown>(ref: ArtifactRef): Promise<Artifact<TData>>;
  listArtifacts(query?: ArtifactQuery): Promise<ArtifactRef[]>;
}
