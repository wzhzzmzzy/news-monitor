import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileArchiveStore } from "./file-archive-store.js";

const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "hot-board-archive-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileArchiveStore", () => {
  it("按类型写入、读取并列出 artifact", async () => {
    const store = new FileArchiveStore({ rootDir: await tempRoot() });
    const ref = await store.writeArtifact({
      type: "news.raw",
      data: { items: [{ id: "n1", title: "示例" }] },
      metadata: { source: "test" }
    });

    expect(ref.type).toBe("news.raw");
    expect(ref.path).toContain("artifacts/news/raw/");

    const artifact = await store.readArtifact(ref);
    expect(artifact.ref.id).toBe(ref.id);
    expect(artifact.data).toEqual({ items: [{ id: "n1", title: "示例" }] });
    expect(artifact.metadata).toEqual({ source: "test" });

    const refs = await store.listArtifacts({ type: "news.raw" });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.id).toBe(ref.id);
  });

  it("按创建时间倒序排列 artifact", async () => {
    let tick = 0;
    const store = new FileArchiveStore({
      rootDir: await tempRoot(),
      now: () => new Date(`2026-05-07T00:00:0${tick++}.000Z`)
    });
    const first = await store.writeArtifact({ type: "reports", data: { title: "第一份" } });
    const second = await store.writeArtifact({ type: "reports", data: { title: "第二份" } });

    const refs = await store.listArtifacts({ type: "reports" });
    expect(refs.map((ref) => ref.id)).toEqual([second.id, first.id]);
  });
});
