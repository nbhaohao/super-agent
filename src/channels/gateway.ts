/**
 * ChannelGateway —— Channel 系统的中枢（m05 s19，后端核心，重点 review）。
 *
 * 注册所有 Channel，统一路由消息：收到任一 Channel 的消息 → 丢给 Agent Loop → 拿回复 → 原路发回。
 * 每个「Channel + 发送者」是一条独立会话（sessionKey），各自保留历史，互不串台。
 *
 * runAgent 是注入的：生产里它包一层真实 agentLoop（唯一碰真 API 的地方），测试里注入一个
 * 确定性替身（往 messages 追加 assistant 回复），这样路由逻辑单测不烧 token。
 * ⚠️ 源课直接 import agentLoop(model, registry, messages, system)；本课按「registry 依赖注入」纪律
 *    改成注入 runAgent，语义一致（都 mutate messages 追加 assistant 回复）。
 *
 * gen 已就位：register / startAll / stopAll / extractText（回复抽取）。
 * ✍️ 你写（s19 核心）：handleIncoming —— 按 sender 分会话、跑 agent、抽回复、原路发回。
 */
import type { ModelMessage } from "ai";
import type { ChannelDefinition, IncomingMessage } from "./types.js";

export interface GatewayOptions {
  buildSystem: () => string;
  // 注入的 agent 执行器：把 messages 跑一轮，追加 assistant 回复（生产=agentLoop 包装，测试=替身）
  runAgent: (messages: ModelMessage[], system: string) => Promise<void>;
}

export class ChannelGateway {
  private channels = new Map<string, ChannelDefinition>();
  private sessions = new Map<string, ModelMessage[]>();
  private options: GatewayOptions;

  constructor(options: GatewayOptions) {
    this.options = options;
  }

  // gen：注册 Channel + 挂上入站回调
  register(channel: ChannelDefinition): void {
    this.channels.set(channel.name, channel);
    channel.onMessage?.((msg) => {
      void this.handleIncoming(channel.name, msg);
    });
  }

  async startAll(): Promise<void> {
    for (const [name, ch] of this.channels) {
      try {
        await ch.start();
        console.log(`  [gateway] ✓ ${name} 已启动`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [gateway] ✗ ${name} 启动失败: ${msg}`);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const [, ch] of this.channels) await ch.stop();
  }

  /**
   * ✍️ 你写（s19 核心）：处理一条入站消息 —— 分会话跑 agent，把回复原路发回。
   *
   * 步骤：
   *   1. sessionKey = `${channelName}:${msg.senderId}`（每个发送者一条独立会话）。
   *   2. this.sessions 里没有该 key → set 成 []；取出 messages 数组。
   *   3. push 一条 { role:'user', content: msg.text } 进 messages。
   *   4. system = this.options.buildSystem()；await this.options.runAgent(messages, system)
   *      （runAgent 会往 messages 追加 assistant 回复）。
   *   5. 取 messages 最后一条；若 role==='assistant'，用 extractText(content) 抽出 replyText。
   *   6. replyText 非空 → 拿 this.channels.get(channelName)，await channel.send({
   *        channelId: msg.channelId, recipientId: msg.senderId, text: replyText })。
   */
  private async handleIncoming(
    channelName: string,
    msg: IncomingMessage,
  ): Promise<void> {
    const sessionKey = `${channelName}:${msg.senderId}`;
    if (!this.sessions.has(sessionKey)) {
      this.sessions.set(sessionKey, []);
    }
    const messages = this.sessions.get(sessionKey)!;
    messages.push({ role: "user", content: msg.text });

    const system = this.options.buildSystem();
    await this.options.runAgent(messages, system);

    const last = messages[messages.length - 1];
    if (last.role === "assistant") {
      const replyText = extractText(last.content);
      if (replyText) {
        const channel = this.channels.get(channelName);
        if (channel) {
          await channel.send({
            channelId: msg.channelId,
            recipientId: msg.senderId,
            text: replyText,
          });
        }
      }
    }
  }
}

/** gen：从 assistant 消息 content 抽纯文本（string 直接用，parts 数组取 text 拼接）。 */
export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");
  }
  return "";
}
