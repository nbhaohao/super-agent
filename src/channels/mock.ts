/**
 * MockChannel —— 内存 Channel 测试替身（m05 s19，gen 已就位，扫一眼）。
 *
 * 不连任何外部服务：emit() 模拟「外部来了条消息」，sent[] 捕获所有发出去的回复。
 * 用它单测 Gateway 路由逻辑（不烧 token、确定性）。飞书/Telegram 只是把 emit/send 换成真 IO。
 */
import type {
  ChannelDefinition,
  IncomingMessage,
  OutgoingMessage,
} from "./types.js";

export class MockChannel implements ChannelDefinition {
  description = "内存测试通道";
  sent: OutgoingMessage[] = [];
  private handler?: (msg: IncomingMessage) => void;

  constructor(public name = "mock") {}

  start(): void {}
  stop(): void {}

  async send(message: OutgoingMessage): Promise<void> {
    this.sent.push(message);
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.handler = handler;
  }

  // 模拟外部推来一条消息，触发 Gateway 的 onMessage 回调
  emit(msg: IncomingMessage): void {
    this.handler?.(msg);
  }
}
