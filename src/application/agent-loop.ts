import { streamText } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';
import { detect, recordCall, recordResult, resetHistory } from './loop-detection.js';
import { log } from '../lib/logger.js';

type Tools = NonNullable<Parameters<typeof streamText>[0]['tools']>;

const MAX_STEPS = 15;

export type AgentStreamPart =
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolName: string; input: unknown }
    | { type: 'tool-result'; toolName: string; output: unknown };

export async function* agentLoop(
    model: LanguageModel,
    tools: Tools,
    messages: ModelMessage[],
    system: string,
): AsyncGenerator<AgentStreamPart> {
    resetHistory(); // 每轮对话开始时清空滑动窗口
    let step = 0;

    while (step < MAX_STEPS) {
        step++;
        log(`--- Step ${step} ---`);

        const result = streamText({
            model,
            system,
            tools,
            messages,
            maxRetries: 0,                    // 禁止重试，防止干扰死循环计数
            onError: (e) => log('streamText error', String(e)),
        });

        let hasToolCall = false;
        let fullText = '';
        let shouldBreak = false;
        let lastToolCall: { name: string; input: unknown } | null = null;

        for await (const part of result.fullStream) {
            switch (part.type) {
                case 'text-delta':
                    fullText += part.text;
                    yield { type: 'text', text: part.text };
                    break;

                case 'tool-call': {
                    hasToolCall = true;
                    lastToolCall = { name: part.toolName, input: part.input };

                    // detect 必须在 recordCall 之前调用
                    // 此时 history 里还没有当前这次调用，探测器依赖这个时序
                    const detection = detect(part.toolName, part.input);

                    yield { type: 'tool-call', toolName: part.toolName, input: part.input };

                    if (detection.stuck) {
                        yield { type: 'text', text: `\n  ${detection.message}` };
                        log('loop-detection', detection.message);

                        if (detection.level === 'critical') {
                            shouldBreak = true;
                        } else {
                            // 警告级别：向 LLM 注入系统提示，引导它换个思路
                            // 这条 user 消息会随 messages 同步回 Conversation，后续轮次 LLM 也能看到
                            messages.push({
                                role: 'user' as const,
                                content: `[系统提醒] ${detection.message}。请换一个思路解决问题，不要重复同样的操作。`,
                            });
                        }
                    }

                    recordCall(part.toolName, part.input);
                    break;
                }

                case 'tool-result':
                    if (lastToolCall) {
                        recordResult(lastToolCall.name, lastToolCall.input, part.output);
                    }
                    log('tool-result', `${part.toolName} → ${JSON.stringify(part.output)}`);
                    yield { type: 'tool-result', toolName: part.toolName, output: part.output };
                    break;
            }
        }

        // critical 检测触发：流已消费完，现在安全退出
        if (shouldBreak) {
            yield { type: 'text', text: '\n[循环检测触发，Agent 已停止]' };
            break;
        }

        const stepResponse = await result.response;
        messages.push(...(stepResponse.messages as ModelMessage[]));
        log(`step ${step} messages appended`, `history now: ${messages.length}`);

        if (!hasToolCall) {
            if (fullText) log(`step ${step} done`, 'no tool call, loop complete');
            break;
        }

        log(`step ${step}`, 'tool call detected, continuing...');
    }

    if (step >= MAX_STEPS) {
        log('agent loop', `MAX_STEPS (${MAX_STEPS}) reached, force stopped`);
        yield { type: 'text', text: '\n[达到最大步数限制，强制停止]' };
    }
}
