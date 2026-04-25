import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { createMockModel } from './mock.js';
import { log } from '../lib/logger.js';

export function createMockProvider(): LanguageModel {
    log('LLM provider', 'mock');
    return createMockModel() as unknown as LanguageModel;
}

export function createRealProvider(): LanguageModel | null {
    if (!process.env.DASHSCOPE_API_KEY) return null;
    const modelId = process.env.MODEL_ID!;
    log('LLM provider', `qwen / ${modelId}`);
    const qwen = createOpenAI({
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: process.env.DASHSCOPE_API_KEY,
    });
    return qwen.chat(modelId) as LanguageModel;
}
