import { streamText } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';
import { detect, recordCall, recordResult, resetHistory } from './loop-detection.js';
import { log } from '../lib/logger.js';

type Tools = NonNullable<Parameters<typeof streamText>[0]['tools']>;

const MAX_STEPS = 15;

export interface AgentOptions {
    detectLoops?: boolean; // default: true
}

export type AgentStreamPart =
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolName: string; input: unknown }
    | { type: 'tool-result'; toolName: string; output: unknown }
    | { type: 'stats'; steps: number; toolCalls: number; tokens: number; savedTokens: number; stoppedByDetection: boolean };

export async function* agentLoop(
    model: LanguageModel,
    tools: Tools,
    messages: ModelMessage[],
    system: string,
    options: AgentOptions = {},
): AsyncGenerator<AgentStreamPart> {
    const doDetect = options.detectLoops !== false;
    if (doDetect) resetHistory();

    let step = 0;
    let totalToolCalls = 0;
    let totalTokens = 0;
    let stoppedByDetection = false;
    let lastStepTokens = 0;

    while (step < MAX_STEPS) {
        step++;
        log(`--- Step ${step} ---`);

        // Simulate token cost: grows as conversation history grows
        lastStepTokens = 300 + messages.length * 60 + 50;
        totalTokens += lastStepTokens;

        const result = streamText({
            model,
            system,
            tools,
            messages,
            maxRetries: 0,
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
                    totalToolCalls++;
                    lastToolCall = { name: part.toolName, input: part.input };
                    yield { type: 'tool-call', toolName: part.toolName, input: part.input };

                    if (doDetect) {
                        const detection = detect(part.toolName, part.input);
                        if (detection.stuck) {
                            yield { type: 'text', text: `\n  ${detection.message}` };
                            log('loop-detection', detection.message);
                            if (detection.level === 'critical') {
                                stoppedByDetection = true;
                                shouldBreak = true;
                            } else {
                                messages.push({
                                    role: 'user' as const,
                                    content: `[系统提醒] ${detection.message}。请换一个思路解决问题，不要重复同样的操作。`,
                                });
                            }
                        }
                        recordCall(part.toolName, part.input);
                    }
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

    const savedTokens = stoppedByDetection
        ? Math.round((MAX_STEPS - step) * (totalTokens / step))
        : 0;

    yield { type: 'stats', steps: step, toolCalls: totalToolCalls, tokens: totalTokens, savedTokens, stoppedByDetection };
}
