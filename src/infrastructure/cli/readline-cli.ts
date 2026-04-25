import { createInterface } from 'node:readline';
import type { ChatAgent } from '../../application/chat-agent.js';

// CLI 适配器：负责所有 I/O 交互，与业务逻辑完全解耦
// 替换成 HTTP server 或 WebSocket 时只改这一层
export async function runCLI(agent: ChatAgent): Promise<void> {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log('Super Agent v0.1 (type "exit" to quit)\n');

    function ask() {
        rl.question('\nYou: ', async (input) => {
            const trimmed = input.trim();
            if (!trimmed || trimmed === 'exit') {
                console.log('Bye!');
                rl.close();
                return;
            }

            process.stdout.write('Assistant: ');
            for await (const chunk of agent.chat(trimmed)) {
                process.stdout.write(chunk);
            }
            console.log();

            ask();
        });
    }

    ask();
}
