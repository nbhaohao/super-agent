import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { createMockModel } from './mock.js';
import { log } from '../lib/logger.js';

export function createLLMProvider(): LanguageModel {
    if (process.env.USE_MOCK === 'true') {
        log('LLM provider', 'mock (USE_MOCK=true)');
        console.log('[LLM] USE_MOCK=true, using mock model\n');
        return createMockModel() as unknown as LanguageModel;
    }

    if (process.env.DASHSCOPE_API_KEY) {
        const modelId = process.env.MODEL_ID!;
        log('LLM provider', `qwen / ${modelId}`);
        const qwen = createOpenAI({
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            apiKey: process.env.DASHSCOPE_API_KEY,
        });
        return qwen.chat(modelId) as LanguageModel;
    }

    log('LLM provider', 'mock (DASHSCOPE_API_KEY not set)');
    console.log('[LLM] DASHSCOPE_API_KEY not set, using mock model\n');
    return createMockModel() as unknown as LanguageModel;
}
