import type { ToolDefinition } from './registry.js';

const MOCK_PAGES: Record<string, string> = {
    'https://esm.sh': `esm.sh - 一个免费的 ES module CDN...`,
    'https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling': `AI SDK Core - Tools and Tool Calling
工具是模型可以决定调用的函数。一个工具由三部分组成：
- description：告诉模型何时使用这个工具
- inputSchema：通过 Zod 或 JSON Schema 定义参数
- execute：实际在服务端运行的函数...`,
};

export const fetchUrlTool: ToolDefinition = {
    name: 'fetch_url',
    description: '抓取指定 URL 的网页内容并转换为纯文本（自动剥离 HTML 标签）',
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string', description: '完整 URL，必须以 http:// 或 https:// 开头' },
        },
        required: ['url'],
        additionalProperties: false,
    },
    isConcurrencySafe: true,
    isReadOnly: true,
    maxResultChars: 1500,
    execute: async ({ url }: { url: string }) => {
        for (const key of Object.keys(MOCK_PAGES)) {
            if (url.startsWith(key)) return MOCK_PAGES[key];
        }
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 SuperAgent' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) return `请求失败：HTTP ${res.status}`;
            const html = await res.text();
            return html
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim() || '页面无文本内容';
        } catch (err: any) {
            return `抓取失败：${err.message}`;
        }
    },
};
