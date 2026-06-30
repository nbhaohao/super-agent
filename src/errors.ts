/**
 * 领域错误类型（m01 建，全程复用）。
 * 用具名错误类替代裸 Error，让上层能 instanceof 精确分流、日志能带 code。
 */

/** 配置缺失/非法：缺 API key、未知 provider 等，启动期就该抛。 */
export class ConfigError extends Error {
  readonly code = 'CONFIG' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** 调用 provider/LLM 时的错误（包装底层 SDK 错误，保留 cause）。 */
export class ProviderError extends Error {
  readonly code = 'PROVIDER' as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderError';
  }
}
