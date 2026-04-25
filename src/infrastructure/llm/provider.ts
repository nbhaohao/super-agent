import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { createMockModel } from './mock.js';

// LLM 工厂：根据环境变量决定使用真实模型还是 Mock
// 新增其他 provider（OpenAI、Claude 等）时只改这里
export function createLLMProvider(): LanguageModel {
    if (process.env.DASHSCOPE_API_KEY) {
        const qwen = createOpenAI({
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            apiKey: process.env.DASHSCOPE_API_KEY,
        });
        return qwen.chat(process.env.MODEL_ID!) as LanguageModel;
    }

    console.log('[LLM] DASHSCOPE_API_KEY not set, using mock model\n');
    return createMockModel() as unknown as LanguageModel;
}
