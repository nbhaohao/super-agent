import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LanguageModel } from 'ai';
import { ChatAgent } from '../agent/chat-agent.js';
import { ToolRegistry, truncateResult, type ToolDefinition } from '../tools/registry.js';
import { demoToolDefs } from '../tools/index.js';
import { resetRetryCounters } from '../providers/mock.js';

interface ToolMeta {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    isConcurrencySafe: boolean;
    isReadOnly: boolean;
    maxResultChars?: number;
}

interface Models {
    mockModel: LanguageModel;
    realModel: LanguageModel | null;
}

const DEMO_TRIGGERS: Record<string, string> = {
    generic_repeat: '测试死循环',
    ping_pong:      '测试乒乓',
    polling:        '测试轮询',
    retry_success:  '测试重试成功',
    retry_fail:     '测试持续失败',
};

function generateSampleData(): string {
    const records = Array.from({ length: 30 }, (_, i) => ({
        id: i + 1,
        username: `user_${String(i + 1).padStart(3, '0')}`,
        email: `user${i + 1}@example.com`,
        role: ['admin', 'editor', 'viewer'][i % 3],
        createdAt: `2024-${String((i % 12) + 1).padStart(2, '0')}-01T00:00:00Z`,
        lastLogin: `2025-0${(i % 9) + 1}-15T12:30:00Z`,
        profile: {
            bio: `这是 user_${String(i + 1).padStart(3, '0')} 的个人简介，包含该用户的基本描述信息与偏好设置。`,
            location: ['北京', '上海', '深圳', '杭州', '成都'][i % 5],
            score: ((i + 1) * 37) % 1000,
            tags: [`tag_${i % 8}`, `tag_${(i + 3) % 8}`],
        },
    }));
    return JSON.stringify({ status: 'ok', total: records.length, records }, null, 2);
}

export function runWebServer(agent: ChatAgent, models: Models, registry: ToolRegistry): void {
    const app = new Hono();

    let useMock = !models.realModel || process.env.USE_MOCK === 'true';

    if (useMock) agent.setModel(models.mockModel);

    app.get('/', (c) => {
        const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf-8');
        return c.html(html);
    });

    app.get('/api/tools', (c) => {
        const tools: ToolMeta[] = registry.getAll().map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
            isConcurrencySafe: t.isConcurrencySafe ?? false,
            isReadOnly: t.isReadOnly ?? false,
            maxResultChars: t.maxResultChars,
        }));
        return c.json(tools);
    });

    app.get('/api/config', (c) => {
        return c.json({ useMock, hasRealModel: !!models.realModel });
    });

    app.post('/api/config', async (c) => {
        const { mock } = await c.req.json<{ mock: boolean }>();
        useMock = mock || !models.realModel;
        agent.setModel(useMock ? models.mockModel : models.realModel!);
        return c.json({ useMock });
    });

    app.post('/api/chat', async (c) => {
        const { message } = await c.req.json<{ message: string }>();

        return streamSSE(c, async (stream) => {
            try {
                for await (const event of agent.chat(message)) {
                    await stream.writeSSE({ data: JSON.stringify(event) });
                }
                await stream.writeSSE({
                    data: JSON.stringify({ type: 'messages', data: agent.getHistory() }),
                });
            } catch (e) {
                await stream.writeSSE({
                    data: JSON.stringify({ type: 'error', message: String(e) }),
                });
            }
        });
    });

    app.post('/api/demo', async (c) => {
        const { scenario, detectLoops, retryEnabled } = await c.req.json<{
            scenario: string;
            detectLoops: boolean;
            retryEnabled?: boolean;
        }>();

        const trigger = DEMO_TRIGGERS[scenario];
        if (!trigger) return c.json({ error: 'unknown scenario' }, 400);

        resetRetryCounters();
        const demoRegistry = new ToolRegistry();
        demoRegistry.register(...demoToolDefs);
        const demoAgent = new ChatAgent(models.mockModel, demoRegistry);

        return streamSSE(c, async (stream) => {
            try {
                for await (const event of demoAgent.chat(trigger, {
                    detectLoops,
                    retryEnabled: retryEnabled ?? true,
                })) {
                    await stream.writeSSE({ data: JSON.stringify(event) });
                }
            } catch (e) {
                await stream.writeSSE({
                    data: JSON.stringify({ type: 'error', message: String(e) }),
                });
            }
        });
    });

    app.post('/api/truncation-demo', async (c) => {
        const { maxChars } = await c.req.json<{ maxChars?: number }>();
        const limit = maxChars ?? 1000;
        const original = generateSampleData();
        const result = truncateResult(original, limit);
        return c.json({
            originalLength: original.length,
            resultLength: result.length,
            dropped: Math.max(0, original.length - result.length),
            wasTruncated: result !== original,
            original,
            result,
        });
    });

    app.post('/api/lock-demo', async (c) => {
        // unsafe = isConcurrencySafe:true  → no exclusive lock → race condition on shared state
        // safe   = isConcurrencySafe:false → exclusive lock    → serialised, correct result
        const { scenario } = await c.req.json<{ scenario: 'unsafe' | 'safe' }>();

        return streamSSE(c, async (stream) => {
            const startTime = Date.now();
            const markedSafe = scenario === 'unsafe'; // "unsafe" wrongly marks the tool as concurrency-safe

            let fileContent = '';

            const demoRegistry = new ToolRegistry();

            const makeWriteTool = (toolName: string, line: string): ToolDefinition => ({
                name: toolName,
                description: `Write tool ${toolName}`,
                parameters: { type: 'object', properties: {}, additionalProperties: false },
                isConcurrencySafe: markedSafe,
                isReadOnly: false,
                execute: async () => {
                    // --- read phase ---
                    const snapshot = fileContent;
                    stream.writeSSE({ data: JSON.stringify({
                        type: 'op', toolName, op: 'read',
                        content: snapshot || '(empty)',
                        elapsed: Date.now() - startTime,
                    }) }).catch(() => {});

                    // simulate processing delay (race window)
                    await new Promise(r => setTimeout(r, 300));

                    // --- write phase: based on snapshot, not current content ---
                    fileContent = snapshot === '' ? line : `${snapshot}\n${line}`;
                    stream.writeSSE({ data: JSON.stringify({
                        type: 'op', toolName, op: 'write',
                        content: fileContent,
                        elapsed: Date.now() - startTime,
                    }) }).catch(() => {});

                    return fileContent;
                },
            });

            demoRegistry.register(
                makeWriteTool('write_A', 'line_a'),
                makeWriteTool('write_B', 'line_b'),
            );

            demoRegistry.setLockEventHandler((evt) => {
                stream.writeSSE({ data: JSON.stringify({
                    type: 'lock-event',
                    toolName: evt.toolName,
                    event: evt.type,
                    elapsed: Date.now() - startTime,
                }) }).catch(() => {});
            });

            const tools = demoRegistry.toAISDKFormat();

            await Promise.all([
                tools['write_A'].execute({}),
                tools['write_B'].execute({}),
            ]);

            const isCorrect = fileContent.includes('line_a') && fileContent.includes('line_b');

            await stream.writeSSE({ data: JSON.stringify({
                type: 'done',
                elapsed: Date.now() - startTime,
                finalContent: fileContent,
                isCorrect,
            }) });
        });
    });

    const port = parseInt(process.env.PORT ?? '3000');
    serve({ fetch: app.fetch, port }, () => {
        console.log(`\nSuper Agent Web UI → http://localhost:${port}\n`);
    });
}
