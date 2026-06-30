/**
 * 集中配置（m01 建）。env 解析 + 校验都收在这一处，别处不直接读 process.env。
 * 设计：解析不抛错（mock 零配置可跑）；要用某个真实 provider 时再 requireKey 校验，
 * 把「缺 key」的失败提前到一个清晰的 ConfigError，而不是等首次网络调用 500。
 */
import { ConfigError } from './errors.js';

export type ProviderName = 'deepseek' | 'anthropic' | 'openai' | 'mock';
const PROVIDERS: readonly ProviderName[] = ['deepseek', 'anthropic', 'openai', 'mock'];

export interface Config {
  provider: ProviderName;
  keys: Record<Exclude<ProviderName, 'mock'>, string | undefined>;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = (env.LLM_PROVIDER || 'deepseek').toLowerCase();
  const provider = (PROVIDERS as readonly string[]).includes(raw) ? (raw as ProviderName) : 'deepseek';
  return {
    provider,
    keys: {
      deepseek: env.DEEPSEEK_API_KEY,
      anthropic: env.ANTHROPIC_API_KEY,
      openai: env.OPENAI_API_KEY,
    },
  };
}

/** 取某 provider 的 key，缺了就抛清晰错误（mock 不需要 key）。 */
export function requireKey(provider: Exclude<ProviderName, 'mock'>, config: Config): string {
  const key = config.keys[provider];
  if (!key) {
    throw new ConfigError(
      `provider "${provider}" 需要 API key，但未设置。请在 .env 填入对应的 ${provider.toUpperCase()}_API_KEY（或把 LLM_PROVIDER 设成 mock 跑本地模拟）。`,
    );
  }
  return key;
}
