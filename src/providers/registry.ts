/**
 * 多 provider registry（s1 核心 · 后端核心，重点 review）。
 *
 * 价值：把「选哪个 LLM」收敛到一处。调用方只认 LanguageModelV2 接口、只调 createModel()，
 * 从不 import 具体 provider 包——换模型 = 改 LLM_PROVIDER 一个 env，业务代码零改动（Provider 模式 / 依赖倒置）。
 *
 * 默认 DeepSeek（OpenAI 兼容，走 @ai-sdk/openai + baseURL）；mock 零 key 可跑，是测试替身。
 */
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV2 } from '@ai-sdk/provider';
import { createMockModel } from './mock-model.js';
import { loadConfig, requireKey, type Config, type ProviderName } from '../config.js';
import { ConfigError } from '../errors.js';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

/**
 * 按名字造一个统一接口的 model。provider 缺省时取 config.provider（即 LLM_PROVIDER）。
 * 注意：只「构造」不「调用」——缺 key 在这里就抛 ConfigError（启动期失败），不留到首次网络请求。
 */
export function createModel(provider?: ProviderName, config: Config = loadConfig()): LanguageModelV2 {
  const p = provider ?? config.provider;
  switch (p) {
    case 'mock':
      return createMockModel();
    case 'deepseek':
      return createOpenAI({ baseURL: DEEPSEEK_BASE_URL, apiKey: requireKey('deepseek', config) }).chat('deepseek-chat');
    case 'openai':
      return createOpenAI({ apiKey: requireKey('openai', config) }).chat('gpt-4o-mini');
    case 'anthropic':
      return createAnthropic({ apiKey: requireKey('anthropic', config) })('claude-3-5-sonnet-latest');
    default:
      throw new ConfigError(`未知 provider: ${String(p)}（可选 deepseek|anthropic|openai|mock）`);
  }
}
