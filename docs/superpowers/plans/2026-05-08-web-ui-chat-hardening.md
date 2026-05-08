# Web UI Chat Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the post-implementation gaps found during review and real-browser walkthrough so the Web UI chat flow is usable end-to-end.

**Architecture:** Keep the existing no-build Hono gateway architecture, and harden the behavior at the same boundaries already introduced by the Web UI plan: gateway routes, runtime creation, agent streaming, JSON session state, and plain browser modules. Each task starts with a failing test or browser-repro contract, implements the smallest fix, verifies with targeted tests plus full `pnpm test`, `pnpm run typecheck`, and `pnpm run build`, then commits independently.

**Tech Stack:** Node.js 22, TypeScript, pnpm workspace, Vitest, Hono, Server-Sent Events, OpenAI chat completions streaming, Catppuccin CSS variables, plain browser JavaScript.

---

## Scope

This is the third Web UI execution plan. Execute it after the initial workflow-core and Web UI plans:

- `docs/superpowers/plans/2026-05-07-agent-workflow-core.md`
- `docs/superpowers/plans/2026-05-07-web-ui-chat.md`

This plan hardens the first Web UI implementation by closing review gaps, browser-walkthrough failures, composer interaction issues, and runtime configuration refresh behavior.

## File Structure

- Modify `apps/gateway/src/app.ts`: pass active session history to agent streams, refresh runtime after settings save, validate settings payloads.
- Modify `apps/gateway/src/app.test.ts`: add gateway route, settings validation, runtime refresh, client contract, and browser-flow regression tests.
- Modify `apps/gateway/src/public/chat.js`: render failed messages, synchronize edit-resend active path, update theme toggle, support composer keyboard shortcuts.
- Modify `apps/gateway/src/public/settings.js`: add settings validation feedback, dynamic source/profile add/remove controls, optional numeric parsing.
- Modify `apps/gateway/src/public/styles.css`: fix narrow chat layout and theme the composer textarea.
- Modify `apps/gateway/src/settings/settings-service.ts`: validate required model and numeric settings before saving.
- Modify `apps/gateway/src/ui/chat-page.tsx`: add narrow-viewport navigation and theme icon wrapper.
- Modify `apps/gateway/src/ui/settings-page.tsx`: add labels, required fields, success/error regions, and add buttons for dynamic editors.
- Modify `apps/gateway/src/ui/icons.tsx`: add `IconPlus`.
- Modify `apps/gateway/src/ui/layout.tsx`: expose configured light/dark theme variants to the client.
- Modify `apps/cli/src/runtime.ts`: preserve `generateWithToolsStream()` through the lazy model wrapper.
- Modify `apps/cli/src/runtime.test.ts`: verify the lazy runtime wrapper keeps streaming behavior.
- Modify `packages/agent-core/src/agent-session.ts`: propagate active chat history to streaming model calls.
- Modify `packages/agent-core/src/agent-session.test.ts`: verify active history reaches the streaming model client.
- Modify `packages/agent-core/src/openai-model-client.ts`: use real OpenAI streaming chunks for `assistant.delta`.
- Create `packages/agent-core/src/openai-model-client.test.ts`: verify streaming chunks produce incremental assistant deltas.
- Modify `packages/tools/src/builtin-tools.ts`: skip disabled sources during crawl.
- Modify `packages/tools/src/builtin-tools.test.ts`: verify disabled sources are not fetched or counted.

## Task 1: Close Core Review Gaps

**Files:**
- Modify: `apps/gateway/src/app.ts`
- Test: `apps/gateway/src/app.test.ts`
- Modify: `packages/agent-core/src/agent-session.ts`
- Test: `packages/agent-core/src/agent-session.test.ts`
- Modify: `packages/agent-core/src/openai-model-client.ts`
- Create: `packages/agent-core/src/openai-model-client.test.ts`
- Modify: `packages/tools/src/builtin-tools.ts`
- Test: `packages/tools/src/builtin-tools.test.ts`
- Modify: `apps/gateway/src/public/chat.js`
- Modify: `apps/gateway/src/public/styles.css`
- Modify: `apps/gateway/src/ui/chat-page.tsx`
- Modify: `apps/gateway/src/ui/icons.tsx`
- Modify: `apps/gateway/src/ui/layout.tsx`

- [ ] **Step 1: Write failing tests for active chat history**

Add a gateway test proving the second streamed turn receives the active-path history:

```ts
expect(streamInputs[1]).toMatchObject({
  message: "第二问",
  history: [
    { role: "user", content: "第一问" },
    { role: "assistant", content: "完成" }
  ]
});
```

Add an agent-core test proving `AgentSession.streamAsk()` forwards `history` into `generateWithToolsStream()`.

- [ ] **Step 2: Implement active-path history propagation**

In `apps/gateway/src/app.ts`, compute history from `session.activePath` before the latest user message:

```ts
const history = await activeHistoryBefore(input.sessionStore, input.sessionId, input.userMessageId);
for await (const event of input.runtime.agent.streamAsk({
  message: input.content,
  history,
  maxToolIterations: input.runtime.appConfig.llm.maxToolIterations
})) {
  // existing persistence and SSE publish path
}
```

In `packages/agent-core/src/agent-session.ts`, pass `input.history` into `generateWithToolsStream()`.

- [ ] **Step 3: Write failing tests for token streaming**

Create `packages/agent-core/src/openai-model-client.test.ts` with a mocked OpenAI client that yields chunks:

```ts
createMock.mockResolvedValueOnce(streamFrom([
  { choices: [{ delta: { content: "热" } }] },
  { choices: [{ delta: { content: "点" } }] },
  { choices: [{ delta: {}, finish_reason: "stop" }] }
]));
```

Expected events:

```ts
[
  { type: "assistant.thinking", payload: {} },
  { type: "assistant.created", payload: {} },
  { type: "assistant.delta", payload: { text: "热" } },
  { type: "assistant.delta", payload: { text: "点" } },
  { type: "assistant.completed", payload: {} }
]
```

- [ ] **Step 4: Implement real OpenAI streaming**

In `packages/agent-core/src/openai-model-client.ts`, call:

```ts
await this.client.chat.completions.create({
  model: this.model,
  ...this.reasoningOptions(),
  messages: messages as never,
  tools,
  tool_choice: "auto",
  stream: true
});
```

Accumulate streamed text and tool-call deltas, emitting each content chunk as an `assistant.delta` event.

- [ ] **Step 5: Write failing tests for disabled sources**

Add a `crawl_news` test with one enabled source and one disabled source, asserting:

```ts
expect(fetchedSourceIds).toEqual(["weibo"]);
expect(output.itemCount).toBe(1);
expect(artifact.metadata.sourceCount).toBe(1);
```

- [ ] **Step 6: Filter disabled sources**

In `packages/tools/src/builtin-tools.ts`, fetch only:

```ts
const enabledSources = options.sources.filter((source) => source.enabled);
```

Use `enabledSources.length` for `metadata.sourceCount`.

- [ ] **Step 7: Add client contracts for session status, mobile navigation, and theme tokens**

Add tests in `apps/gateway/src/app.test.ts` that assert:

```ts
expect(script).toContain("data-session-status");
expect(script).toContain("formatUpdatedAt");
expect(script).toContain("THEME_TOKENS");
expect(script).toContain("applyThemeTokens");
expect(html).toContain("data-mobile-settings");
```

- [ ] **Step 8: Implement UI contracts**

Update `chat.js`, `styles.css`, `chat-page.tsx`, `icons.tsx`, and `layout.tsx` so session list items show title/status/time, mobile has a visible settings path, and theme toggle applies token variables immediately.

- [ ] **Step 9: Verify and commit**

Run:

```bash
pnpm test packages/agent-core/src/agent-session.test.ts packages/agent-core/src/openai-model-client.test.ts packages/tools/src/builtin-tools.test.ts apps/gateway/src/app.test.ts
pnpm test
pnpm run typecheck
pnpm run build
```

Expected: all commands pass.

Commit:

```bash
git add apps/gateway/src packages/agent-core/src packages/tools/src
git commit -m "fix: close web chat review gaps"
```

## Task 2: Improve Interaction Errors And Settings Validation

**Files:**
- Modify: `apps/gateway/src/app.ts`
- Test: `apps/gateway/src/app.test.ts`
- Modify: `apps/gateway/src/public/chat.js`
- Modify: `apps/gateway/src/public/settings.js`
- Modify: `apps/gateway/src/public/styles.css`
- Modify: `apps/gateway/src/settings/settings-service.ts`
- Modify: `apps/gateway/src/ui/settings-page.tsx`

- [ ] **Step 1: Write failing tests for failed assistant rendering**

Add client contract tests:

```ts
expect(script).toContain("renderAssistantFailure");
expect(script).toContain("message.failedAt");
expect(script).toContain("payload.error");
```

- [ ] **Step 2: Render live and persisted assistant failures**

In `chat.js`, make `run.failed` call:

```js
renderAssistantFailure(assistant, payload.error ?? "运行失败");
state.currentAssistantNode = null;
await selectSession(state.currentSessionId);
```

In persisted render, use `message.failedAt || message.error` to show "生成失败" plus the stored error.

- [ ] **Step 3: Write failing tests for edit-resend DOM synchronization**

Add a client contract test asserting:

```ts
expect(script).toContain("await selectSession(state.currentSessionId)");
expect(script).toContain("state.currentAssistantNode = null");
```

- [ ] **Step 4: Synchronize edit-resend from server state**

In `chat.js`, after edit-resend returns:

```js
await selectSession(state.currentSessionId);
state.currentAssistantNode = document.querySelector(`[data-message-id="${run.assistantMessageId}"]`);
connectRun(run.runId, run.assistantMessageId);
```

This removes stale edit forms and duplicate pending assistant placeholders.

- [ ] **Step 5: Write failing tests for settings validation**

Add a gateway route test:

```ts
expect(response.status).toBe(400);
await expect(response.json()).resolves.toEqual({
  error: "settings.validation_failed",
  fields: { "llm.model": "请填写主模型名称" }
});
```

- [ ] **Step 6: Validate settings on the server**

In `settings-service.ts`, add `validateSettings()` that requires:

- `llm.model`
- positive integer `llm.timeoutMs`
- positive integer `llm.maxToolIterations`
- positive integer `flash.timeoutMs`
- positive integer `newsnow.timeoutMs`
- positive integer `newsnow.maxItemsPerSource`
- valid `gateway.port`

In `app.ts`, reject invalid settings with HTTP 400 before writing config files.

- [ ] **Step 7: Improve settings UI feedback and dynamic editors**

In `settings-page.tsx`, add:

```tsx
<div data-settings-error></div>
<div data-settings-success></div>
```

Mark required fields with `required`, add `data-add-source`, add `data-add-profile`, and replace internal-only labels with user-facing labels.

In `settings.js`, add:

- field-level validity reporting via `setCustomValidity()`
- success text after save
- add/remove source controls
- add/remove profile controls
- labeled dynamic inputs
- `optionalNumberValue()` so blank numeric fields do not become `0`

- [ ] **Step 8: Fix narrow viewport navigation**

In `styles.css`, make narrow viewports use:

```css
.hot-board-shell {
  grid-template-columns: 1fr;
}

.sidebar {
  display: none;
}

.mobile-nav {
  display: inline-flex;
}
```

- [ ] **Step 9: Verify in tests and browser**

Run:

```bash
pnpm test apps/gateway/src/app.test.ts
pnpm test
pnpm run typecheck
pnpm run build
```

Then restart gateway and verify:

- `/chat` renders failed messages as "生成失败".
- `/settings` shows required model, add-source, and add-profile controls.
- Browser console reports zero errors.

Commit:

```bash
git add apps/gateway/src
git commit -m "fix: improve gateway interaction errors"
```

## Task 3: Polish Chat Composer Interactions

**Files:**
- Test: `apps/gateway/src/app.test.ts`
- Modify: `apps/gateway/src/public/chat.js`
- Modify: `apps/gateway/src/public/styles.css`

- [ ] **Step 1: Write failing tests for keyboard behavior**

Add client contract assertions:

```ts
expect(script).toContain("handleComposerKeydown");
expect(script).toContain("event.key === \"Enter\"");
expect(script).toContain("event.metaKey");
expect(script).toContain("insertTextAtCursor(input, \"\\n\")");
```

- [ ] **Step 2: Write failing tests for theme-aware composer styling**

Add CSS contract assertions:

```ts
expect(css).toContain(".composer textarea");
expect(css).toContain("background: var(--base)");
expect(css).toContain("color: var(--text)");
expect(css).toContain("caret-color: var(--blue)");
expect(css).toContain(".composer textarea:focus");
```

- [ ] **Step 3: Implement keyboard handling**

In `chat.js`, add:

```js
function handleComposerKeydown(event) {
  if (!(event.key === "Enter") || event.isComposing) {
    return;
  }
  const input = event.currentTarget;
  if (event.metaKey) {
    event.preventDefault();
    insertTextAtCursor(input, "\n");
    return;
  }
  event.preventDefault();
  submitComposer(input);
}
```

Use `Enter` to send, and `Command+Enter` to insert a newline at the cursor.

- [ ] **Step 4: Theme the composer textarea**

In `styles.css`, make `.composer textarea` use:

```css
background: var(--base);
color: var(--text);
caret-color: var(--blue);
border: 1px solid var(--surface0);
```

Add a focus state with `border-color: var(--blue)` and an outline derived from `var(--blue)`.

- [ ] **Step 5: Verify in tests and browser**

Run:

```bash
pnpm test apps/gateway/src/app.test.ts
pnpm test
pnpm run typecheck
pnpm run build
```

Browser verification:

- `Command+Enter` keeps the draft and inserts a newline.
- `Enter` submits.
- Console errors remain zero.

Commit:

```bash
git add apps/gateway/src/app.test.ts apps/gateway/src/public/chat.js apps/gateway/src/public/styles.css
git commit -m "fix: polish chat composer interactions"
```

## Task 4: Refresh Runtime After Settings Save

**Files:**
- Modify: `apps/gateway/src/app.ts`
- Test: `apps/gateway/src/app.test.ts`
- Modify: `apps/cli/src/runtime.ts`
- Test: `apps/cli/src/runtime.test.ts`

- [ ] **Step 1: Reproduce and document runtime/config evidence**

Confirm via local gateway API that saved settings contain model config without printing the secret API key:

```json
{
  "llm": {
    "baseUrlSet": true,
    "apiKeySet": true,
    "model": "configured-model",
    "thinking": "high",
    "timeoutMs": 120000,
    "maxToolIterations": 8
  }
}
```

Before the fix, reproduce that the next chat still reports the stale-runtime error even after settings save:

```text
必须提供 OpenAI model。请传入 model 或设置 OPENAI_MODEL。
```

Root cause: settings were persisted to XDG config, but the gateway kept using the `runtime` created at process start.

- [ ] **Step 2: Write failing test for runtime refresh**

Add `apps/gateway/src/app.test.ts` coverage that creates a gateway with `runtimeFactory`, saves settings with `llm.model = "configured-model"`, sends a message, and asserts the streamed runtime saw:

```ts
expect(seenModels).toEqual(["configured-model"]);
```

- [ ] **Step 3: Add runtime factory support to gateway**

In `apps/gateway/src/app.ts`, allow:

```ts
runtimeFactory?: () => Promise<Awaited<ReturnType<typeof createRuntime>>>;
```

Initialize runtime with:

```ts
const runtimeFactory = options.runtimeFactory ?? (() => createRuntime({ paths }));
let runtime = options.runtime ?? await runtimeFactory();
```

After successful settings save, refresh runtime unless a fixed test runtime was explicitly injected:

```ts
if (!options.runtime || options.runtimeFactory) {
  runtime = await runtimeFactory();
}
```

- [ ] **Step 4: Write failing test for streaming wrapper preservation**

Add `apps/cli/src/runtime.test.ts` coverage that injects a `modelClient.generateWithToolsStream()` and expects `runtime.agent.streamAsk()` to emit:

```ts
{ type: "assistant.delta", payload: { text: "streamed" } }
```

and not fall back to structured output.

- [ ] **Step 5: Preserve streaming in lazy runtime wrapper**

In `apps/cli/src/runtime.ts`, add:

```ts
generateWithToolsStream: (input) => {
  const activeClient = getClient();
  if (!activeClient.generateWithToolsStream) {
    throw new Error("当前 model client 不支持 streaming tool calling");
  }
  return activeClient.generateWithToolsStream(input);
}
```

- [ ] **Step 6: Verify and restart gateway**

Run:

```bash
pnpm test apps/gateway/src/app.test.ts apps/cli/src/runtime.test.ts
pnpm test
pnpm run typecheck
pnpm run build
pnpm run cli gateway stop
pnpm run gateway
```

Expected:

- Tests pass.
- Typecheck passes.
- Build passes.
- Local gateway restarts on `http://127.0.0.1:14577`.
- `/api/settings` shows saved model/baseUrl/apiKey are present.
- `/chat` loads with zero browser console errors.

Commit:

```bash
git add apps/cli/src/runtime.ts apps/cli/src/runtime.test.ts apps/gateway/src/app.ts apps/gateway/src/app.test.ts
git commit -m "fix: refresh gateway runtime after settings save"
```

## Final Verification

- [ ] Run `pnpm test` and confirm all tests pass.
- [ ] Run `pnpm run typecheck` and confirm it passes.
- [ ] Run `pnpm run build` and confirm it passes.
- [ ] Restart the local gateway.
- [ ] Load `http://127.0.0.1:14577/chat` in the in-app browser.
- [ ] Confirm browser console errors are zero after final reload.
- [ ] Confirm gateway settings summary shows model/baseUrl/apiKey are present without printing the secret API key.

## Self-Review

- [ ] Spec coverage: all review and browser-walkthrough issues are addressed by Tasks 1-4.
- [ ] Placeholder scan: no placeholder markers or unspecified implementation steps remain.
- [ ] Type consistency: `RuntimeConfigOverrides`, `runtimeFactory`, `generateWithToolsStream`, `activeHistoryBefore`, `renderAssistantFailure`, and composer helper names match implemented code.
