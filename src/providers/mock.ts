type Intent = 'dead_loop' | 'ping_pong' | 'polling' | 'retry_success' | 'retry_fail' | 'normal';

function getMessageText(msg: any): string {
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) return msg.content.map((c: any) => c.text || '').join('');
    return '';
}

function detectIntent(prompt: any[]): Intent {
    const userTexts = (prompt || [])
        .filter((m: any) => m.role === 'user')
        .map(getMessageText);
    for (const text of userTexts) {
        if (text.includes('测试死循环')) return 'dead_loop';
        if (text.includes('测试乒乓')) return 'ping_pong';
        if (text.includes('测试轮询')) return 'polling';
        if (text.includes('测试重试成功')) return 'retry_success';
        if (text.includes('测试持续失败')) return 'retry_fail';
    }
    return 'normal';
}

const RESPONSES: Record<string, string> = {
    default: '你好！我是模拟模型。填了 DASHSCOPE_API_KEY 后会自动切换到真实的 Qwen。',
    greeting: '你好！虽然是模拟的，但流式输出的效果和真实 API 一致 :)',
    name: '你刚才告诉我了呀！我能"记住"是因为代码把对话历史传给了我。',
    intro: '我是通义千问（模拟版），在本地模拟回复，机制和真实 API 完全一致。',
    retrySuccess: '重试成功！服务已恢复，本次请求正常完成。',
};

function pickTextResponse(prompt: any[]): string {
    const userMsgs = (prompt || []).filter((m: any) => m.role === 'user');
    const text = getMessageText(userMsgs[userMsgs.length - 1]).toLowerCase();
    if (text.includes('介绍你自己') || text.includes('你是谁')) return RESPONSES.intro;
    if (text.includes('你好') || text.includes('hello')) return RESPONSES.greeting;
    if (text.includes('叫什么') || text.includes('记住')) return RESPONSES.name;
    return RESPONSES.default;
}

const MOCK_USAGE = {
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 20, text: 20, reasoning: undefined },
};

function createDelayedStream(chunks: any[], delayMs = 30): ReadableStream {
    return new ReadableStream({
        start(controller) {
            let i = 0;
            function next() {
                if (i < chunks.length) {
                    controller.enqueue(chunks[i++]);
                    setTimeout(next, delayMs);
                } else {
                    controller.close();
                }
            }
            next();
        },
    });
}

function textChunks(text: string): any[] {
    const id = 'text-1';
    return [
        { type: 'text-start', id },
        ...text.split('').map((char) => ({ type: 'text-delta', id, delta: char })),
        { type: 'text-end', id },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: MOCK_USAGE },
    ];
}

function deadLoopChunks(): any[] {
    return [
        { type: 'tool-call', toolCallId: 'tool-1', toolName: 'get_weather', input: '{"city":"北京"}' },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: MOCK_USAGE },
    ];
}

function countToolCalls(prompt: any[]): number {
    let count = 0;
    for (const msg of prompt) {
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content) {
            if (part.type === 'tool-call') count++;
        }
    }
    return count;
}

function pingPongChunks(prompt: any[]): any[] {
    const total = countToolCalls(prompt);
    const city = total % 2 === 0 ? '北京' : '上海';
    return [
        { type: 'tool-call', toolCallId: `tool-${total + 1}`, toolName: 'get_weather', input: `{"city":"${city}"}` },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: MOCK_USAGE },
    ];
}

function pollingChunks(prompt: any[]): any[] {
    const total = countToolCalls(prompt);
    return [
        { type: 'tool-call', toolCallId: `tool-${total + 1}`, toolName: 'check_status', input: '{"task_id":"task-001"}' },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: MOCK_USAGE },
    ];
}

// Tracks how many times the retry_success scenario has been attempted in the current demo run
let retrySuccessAttempts = 0;

export function resetRetryCounters(): void {
    retrySuccessAttempts = 0;
}

export function createMockModel() {
    return {
        specificationVersion: 'v2' as const,
        provider: 'mock',
        modelId: 'mock-model',
        get supportedUrls() { return Promise.resolve({}); },

        async doGenerate({ prompt }: any) {
            const intent = detectIntent(prompt);
            if (intent === 'retry_fail') throw Object.assign(new Error('Service Unavailable'), { statusCode: 503 });
            if (intent === 'retry_success') {
                retrySuccessAttempts++;
                if (retrySuccessAttempts <= 2) throw Object.assign(new Error('Internal Server Error'), { statusCode: 500 });
                return {
                    content: [{ type: 'text', text: RESPONSES.retrySuccess }],
                    finishReason: { unified: 'stop', raw: undefined },
                    usage: MOCK_USAGE,
                    warnings: [],
                };
            }
            return {
                content: [{ type: 'text', text: pickTextResponse(prompt) }],
                finishReason: { unified: 'stop', raw: undefined },
                usage: MOCK_USAGE,
                warnings: [],
            };
        },

        async doStream({ prompt }: any) {
            const intent = detectIntent(prompt);
            if (intent === 'retry_fail') throw Object.assign(new Error('Service Unavailable'), { statusCode: 503 });
            if (intent === 'retry_success') {
                retrySuccessAttempts++;
                if (retrySuccessAttempts <= 2) throw Object.assign(new Error('Internal Server Error'), { statusCode: 500 });
                return { stream: createDelayedStream(textChunks(RESPONSES.retrySuccess), 30) };
            }
            if (intent === 'dead_loop') return { stream: createDelayedStream(deadLoopChunks(), 10) };
            if (intent === 'ping_pong') return { stream: createDelayedStream(pingPongChunks(prompt), 10) };
            if (intent === 'polling') return { stream: createDelayedStream(pollingChunks(prompt), 10) };
            return { stream: createDelayedStream(textChunks(pickTextResponse(prompt)), 30) };
        },
    };
}
