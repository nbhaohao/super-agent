import { streamText } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';
import { log } from '../lib/logger.js';

type Tools = NonNullable<Parameters<typeof streamText>[0]['tools']>;

const MAX_STEPS = 10;

// AgentStreamPart 是应用层与 CLI 层之间的契约
// CLI 只处理这三种事件，不需要关心 AI SDK 内部类型
export type AgentStreamPart =
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolName: string; input: unknown }
    | { type: 'tool-result'; toolName: string; output: unknown };

// agentLoop 实现手动 agent loop：每次只跑一步 streamText，靠 hasToolCall 决定是否继续
//
// 相比 SDK 内置的 stopWhen 方案，手写循环的好处：
//   - 每一步的 messages 完全可控，可以在步骤间插入自定义逻辑（记忆、审计、截断等）
//   - result.response.messages 包含完整的 tool-call / tool-result 消息对，追加后 LLM 能看到完整上下文
//   - 退出条件更直观：没有工具调用 = LLM 认为已经可以直接回复
export async function* agentLoop(
    model: LanguageModel,
    tools: Tools,
    messages: ModelMessage[], // 可变数组，每一步会追加新消息
    system: string,
): AsyncGenerator<AgentStreamPart> {
    let step = 0;

    while (step < MAX_STEPS) {
        step++;
        log(`--- Step ${step} ---`);

        const result = streamText({
            model,
            system,
            tools,
            messages,
            // 不设 stopWhen，每次只跑一步，由我们自己控制循环
        });

        let hasToolCall = false;
        let fullText = '';

        for await (const part of result.fullStream) {
            switch (part.type) {
                case 'text-delta':
                    fullText += part.text;
                    yield { type: 'text', text: part.text };
                    break;

                case 'tool-call':
                    hasToolCall = true;
                    log('tool-call', `${part.toolName}(${JSON.stringify(part.input)})`);
                    yield { type: 'tool-call', toolName: part.toolName, input: part.input };
                    break;

                case 'tool-result':
                    log('tool-result', `${part.toolName} → ${JSON.stringify(part.output)}`);
                    yield { type: 'tool-result', toolName: part.toolName, output: part.output };
                    break;
            }
        }

        // 拿到这一步的完整消息（含 tool-call / tool-result 对），追加到历史
        // 下一步 streamText 收到的 messages 就包含了工具调用结果，LLM 才能继续思考
        const stepResponse = await result.response;
        messages.push(...(stepResponse.messages as ModelMessage[]));
        log(`step ${step} messages appended`, `history now: ${messages.length}`);

        // 退出条件：LLM 没有调用任何工具，说明它已经直接给出了最终回复
        if (!hasToolCall) {
            if (fullText) log(`step ${step} done`, 'no tool call, loop complete');
            break;
        }

        // 还有工具调用 → 继续，让 LLM 看到工具结果后继续思考
        log(`step ${step}`, 'tool call detected, continuing...');
    }

    if (step >= MAX_STEPS) {
        log('agent loop', `MAX_STEPS (${MAX_STEPS}) reached, force stopped`);
        yield { type: 'text', text: '\n[达到最大步数限制，强制停止]' };
    }
}
