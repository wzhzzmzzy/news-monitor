import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "./session-store.js";

const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "hot-board-sessions-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SessionStore", () => {
  it("creates a session and maintains index summaries", async () => {
    const store = new SessionStore({ sessionsDir: await tempRoot(), now: () => new Date("2026-05-07T11:07:00.000Z") });
    const session = await store.createSession();

    expect(session.title).toBe("新会话");
    expect(session.titleSource).toBe("default");
    expect(session.activePath).toEqual([]);

    const summaries = await store.listSessions();
    expect(summaries).toEqual([
      { id: session.id, title: "新会话", titleSource: "default", updatedAt: "2026-05-07T11:07:00.000Z", status: "idle" }
    ]);
  });

  it("adds user and assistant messages to the active path", async () => {
    const store = new SessionStore({ sessionsDir: await tempRoot(), now: () => new Date("2026-05-07T11:08:00.000Z") });
    const session = await store.createSession();
    const user = await store.addUserMessage(session.id, { content: "生成今日热点" });
    const assistant = await store.createAssistantMessage(session.id, { parentId: user.id });
    await store.appendAssistantDelta(session.id, assistant.id, "完成");
    await store.completeAssistantMessage(session.id, assistant.id);

    const loaded = await store.getSession(session.id);
    expect(loaded.activePath).toEqual([user.id, assistant.id]);
    expect(loaded.messages.find((message) => message.id === assistant.id)?.content).toBe("完成");
  });

  it("edit-resend creates a new user branch without deleting old messages", async () => {
    const store = new SessionStore({ sessionsDir: await tempRoot(), now: () => new Date("2026-05-07T11:09:00.000Z") });
    const session = await store.createSession();
    const firstUser = await store.addUserMessage(session.id, { content: "旧问题" });
    const firstAssistant = await store.createAssistantMessage(session.id, { parentId: firstUser.id });
    await store.completeAssistantMessage(session.id, firstAssistant.id);

    const edited = await store.editAndResendUserMessage(session.id, firstUser.id, { content: "新问题" });
    const loaded = await store.getSession(session.id);

    expect(edited.parentId).toBeNull();
    expect(loaded.activePath).toEqual([edited.id]);
    expect(loaded.messages.map((message) => message.content)).toContain("旧问题");
    expect(loaded.messages.map((message) => message.content)).toContain("新问题");
  });

  it("edit-resend on a middle user message keeps old descendants outside the new active path", async () => {
    const store = new SessionStore({ sessionsDir: await tempRoot(), now: () => new Date("2026-05-07T11:09:30.000Z") });
    const session = await store.createSession();
    const firstUser = await store.addUserMessage(session.id, { content: "第一问" });
    const firstAssistant = await store.createAssistantMessage(session.id, { parentId: firstUser.id });
    await store.completeAssistantMessage(session.id, firstAssistant.id);
    const secondUser = await store.addUserMessage(session.id, { content: "第二问旧版本", parentId: firstAssistant.id });
    const oldSecondAssistant = await store.createAssistantMessage(session.id, { parentId: secondUser.id });
    await store.completeAssistantMessage(session.id, oldSecondAssistant.id);

    const edited = await store.editAndResendUserMessage(session.id, secondUser.id, { content: "第二问新版本" });
    const loaded = await store.getSession(session.id);

    expect(edited.parentId).toBe(firstAssistant.id);
    expect(loaded.activePath).toEqual([firstUser.id, firstAssistant.id, edited.id]);
    expect(loaded.messages.map((message) => message.id)).toContain(oldSecondAssistant.id);
    expect(loaded.activePath).not.toContain(secondUser.id);
    expect(loaded.activePath).not.toContain(oldSecondAssistant.id);
  });

  it("rebuilds index while skipping corrupt session files", async () => {
    const root = await tempRoot();
    const store = new SessionStore({ sessionsDir: root, now: () => new Date("2026-05-07T11:10:00.000Z") });
    const session = await store.createSession();
    await writeFile(join(root, "broken.json"), "{");
    await rm(join(root, "index.json"), { force: true });

    const summaries = await store.listSessions();
    expect(summaries.map((item) => item.id)).toEqual([session.id]);

    const index = JSON.parse(await readFile(join(root, "index.json"), "utf8"));
    expect(index.sessions).toHaveLength(1);
  });
});
