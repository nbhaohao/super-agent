# Super Agent — CLAUDE.md

## Project overview

This is a **tutorial-following learning project** for building LLM agents. The user reads a tutorial chapter, pastes the new code here, and we integrate it into our architecture. The original tutorial uses a flat or DDD-style layout; we maintain a simplified intuitive structure.

The project runs as a web app (`pnpm start`) with a dark-theme single-page UI at `http://localhost:3000`.

---

## Directory structure

```
src/
  index.ts          # Composition root — wires model + tools + server, no business logic
  agent/
    chat-agent.ts   # ChatAgent class (public API): chat(), setModel(), getHistory()
    agent-loop.ts   # Core async generator loop, yields AgentStreamPart, tracks stats
    conversation.ts # Immutable message history wrapper around ModelMessage[]
    loop-detection.ts # Hash-based detectors: generic_repeat, ping_pong, global_circuit_breaker
  tools/
    index.ts        # Exports tools (production) and demoTools (demo scenarios)
    weather.ts      # get_weather — mock data for 北京/上海/深圳
    calculator.ts   # calculator — evals math expressions
    check-status.ts # check_status — always returns { status: 'running' } (polling demo)
  providers/
    provider.ts     # createMockProvider() / createRealProvider() (null if no API key)
    mock.ts         # Mock LanguageModel — intent-based streaming responses
  server/
    http.ts         # Hono server: GET /, GET+POST /api/config, POST /api/chat, POST /api/demo
  lib/
    logger.ts       # log(label, data?) — only outputs when DEBUG=true
web/
  index.html        # Single-file SPA — sidebar nav, chat view, loop detection demo view
```

**Why this layout (not DDD):** The original tutorial used `domain/application/infrastructure`. We renamed to `agent/tools/providers/server` for readability. Same separation of concerns, more obvious names.

---

## Tutorial integration workflow

When the user pastes tutorial code:

1. **Read it first** — understand what it does before touching anything.
2. **Identify the layer** — which folder does it belong to?
   - Agent loop / conversation / detection → `src/agent/`
   - Tool definitions → `src/tools/`
   - LLM provider / mock → `src/providers/`
   - HTTP / streaming → `src/server/`
3. **Fix imports** — tutorial uses old DDD paths; map them:
   - `../../application/chat-agent` → `./agent/chat-agent.js`
   - `../../domain/conversation` → `./conversation.js`
   - `../../infrastructure/llm/provider` → `../providers/provider.js`
   - Always use `.js` extension (ES modules)
4. **Check for overlap** — we may have already implemented something differently. Don't blindly overwrite; merge carefully.
5. **TypeScript check** — run `npx tsc --noEmit` after integration.

---

## Mock model — trigger phrases

`src/providers/mock.ts` detects intent by scanning **all user messages** (not just the last one — during a loop the last message may be a tool-result).

| 触发词 | Intent | Mock behavior |
|--------|--------|---------------|
| `测试死循环` | `dead_loop` | Always calls `get_weather("北京")` |
| `测试乒乓` | `ping_pong` | Alternates `get_weather` 北京 ↔ 上海 |
| `测试轮询` | `polling` | Always calls `check_status("task-001")` |
| `测试重试` | `retry_error` | Throws `Error('Rate limit exceeded')` with statusCode 429 |
| (anything else) | `normal` | Returns a text response |

To add a new demo scenario: add a trigger phrase + intent here, add chunk generator, update `doStream`.

---

## Key architectural invariants

These are non-obvious constraints discovered through debugging. Do not change without understanding them.

**1. `detect()` before `recordCall()`**
`getPingPongCount()` assumes the current call is NOT yet in history. Calling `recordCall` first breaks the ping-pong counter.

**2. `result.response` after the `fullStream` loop**
The AI SDK executes tool calls internally during streaming. `await result.response` must come after the `for await` loop — otherwise tool results aren't ready yet and `stepResponse.messages` is incomplete.

**3. Mock `tool-call` chunk format (AI SDK v2 spec)**
```ts
{ type: 'tool-call', toolCallId: 'tool-1', toolName: 'get_weather', input: '{"city":"北京"}' }
// input is a JSON STRING, not a parsed object
```
The v2 compat layer in the SDK handles parsing. Using the multi-chunk format (`tool-call-start/delta/end`) doesn't work with our mock.

**4. `stepResponse.messages` pushes 2 messages per tool step**
One `role: 'assistant'` (tool-call) + one `role: 'tool'` (tool-result). Not merged into one.

---

## AgentStreamPart event types

```ts
{ type: 'text';    text: string }
{ type: 'tool-call';   toolName: string; input: unknown }
{ type: 'tool-result'; toolName: string; output: unknown }
{ type: 'stats';   steps: number; toolCalls: number; tokens: number; savedTokens: number; stoppedByDetection: boolean }
{ type: 'messages'; data: ModelMessage[] }   // emitted by http.ts after chat turn, not from agentLoop
{ type: 'error';   message: string }         // emitted by http.ts on exception
```

---

## Web UI conventions

- **Single file**: `web/index.html` — no build step, no framework, vanilla JS + CSS.
- **Sidebar navigation**: `switchView(name)` shows/hides `.view` divs.
- **Two views**:
  - `#view-chat` — chat interface + conversation history panel on right
  - `#view-demo` — three loop detection scenario cards
- **SSE streaming**: uses `fetch` + `ReadableStream` reader (not `EventSource` — POST requires fetch).
- **Dark theme**: CSS variables in `:root` (`--bg`, `--surface`, `--border`, `--text`, `--muted`, `--blue`, `--green`, `--yellow`, `--red`).
- Keep it a single file. If frontend complexity grows significantly (React migration mentioned in tutorial), move to `web/` with a proper bundler then.

---

## Demo scenario conventions

Each demo card corresponds to one loop type. To add a new scenario:

1. **`src/providers/mock.ts`** — add trigger phrase to `detectIntent()`, add chunk generator function, update `doStream` switch.
2. **`src/tools/`** — add a new tool if the scenario needs one (add to `demoTools` in `tools/index.ts`).
3. **`web/index.html`** — add a card in `#view-demo` with matching `id="card-{scenario}"`, update `DEMO_TRIGGERS` in `http.ts`.

---

## Environment variables

| Variable | Effect |
|----------|--------|
| `DEBUG=true` | Enables `[debug]` log output via `src/lib/logger.ts` |
| `USE_MOCK=true` | Forces mock model even when `DASHSCOPE_API_KEY` is set |
| `DASHSCOPE_API_KEY` | Enables real Qwen provider via Aliyun DashScope |
| `MODEL_ID` | Model name for Qwen (e.g. `qwen-plus`) |
| `PORT` | HTTP port (default `3000`) |

---

## Scripts

```bash
pnpm start    # Start server (http://localhost:3000)
pnpm dev      # Start with tsx watch (auto-restart on changes)
pnpm debug    # Start with --inspect-brk for WebStorm/VS Code attach debugging
```

**WebStorm debug tip**: Run `pnpm debug` in terminal, then attach WebStorm to `localhost:9229`. Don't use the built-in Run config with `--import tsx` in Node parameters — it conflicts with the bundled tsx loader.

---

## Worktree sync

Claude edits happen in a git worktree under `.claude/worktrees/`. After changes are verified, sync to the main project:

```bash
cp .claude/worktrees/<name>/src/path/to/file.ts src/path/to/file.ts
cp .claude/worktrees/<name>/web/index.html web/index.html
# etc.
```

Always run `npx tsc --noEmit` in the worktree before syncing to catch type errors.
