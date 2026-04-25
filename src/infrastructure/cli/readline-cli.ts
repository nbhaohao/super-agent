import { createInterface } from 'node:readline';
import type { ChatAgent, AgentStreamPart } from '../../application/chat-agent.js';

export async function runCLI(agent: ChatAgent): Promise<void> {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log('Super Agent v0.2 — Agent Loop (type "exit" to quit)\n');

    function ask() {
        rl.question('\nYou: ', async (input) => {
            const trimmed = input.trim();
            if (!trimmed || trimmed === 'exit') {
                console.log('Bye!');
                rl.close();
                return;
            }

            process.stdout.write('Assistant: ');
            for await (const part of agent.chat(trimmed)) {
                renderPart(part);
            }
            console.log();

            ask();
        });
    }

    ask();
}

function renderPart(part: AgentStreamPart): void {
    switch (part.type) {
        case 'text':
            process.stdout.write(part.text);
            break;
        case 'tool-call':
            console.log(`\n  [调用工具: ${part.toolName}(${JSON.stringify(part.input)})]`);
            break;
        case 'tool-result':
            console.log(`  [工具返回: ${JSON.stringify(part.output)}]`);
            break;
    }
}
