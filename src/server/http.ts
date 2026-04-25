import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatAgent } from '../agent/chat-agent.js';

export function runWebServer(agent: ChatAgent): void {
    const app = new Hono();

    app.get('/', (c) => {
        const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf-8');
        return c.html(html);
    });

    app.post('/api/chat', async (c) => {
        const { message } = await c.req.json<{ message: string }>();

        return streamSSE(c, async (stream) => {
            try {
                for await (const event of agent.chat(message)) {
                    await stream.writeSSE({ data: JSON.stringify(event) });
                }
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
