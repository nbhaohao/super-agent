import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LanguageModel } from 'ai';
import type { ChatAgent } from '../agent/chat-agent.js';

interface Models {
    mockModel: LanguageModel;
    realModel: LanguageModel | null;
}

export function runWebServer(agent: ChatAgent, models: Models): void {
    const app = new Hono();

    let useMock = !models.realModel || process.env.USE_MOCK === 'true';

    if (useMock) agent.setModel(models.mockModel);

    app.get('/', (c) => {
        const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf-8');
        return c.html(html);
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

    const port = parseInt(process.env.PORT ?? '3000');
    serve({ fetch: app.fetch, port }, () => {
        console.log(`\nSuper Agent Web UI → http://localhost:${port}\n`);
    });
}
