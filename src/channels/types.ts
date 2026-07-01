/**
 * Channel 接口契约（m05 s19，gen 已就位，扫一眼）。
 *
 * Channel = agent 跟外界通信的通道。终端、飞书群、Telegram、邮件都是 Channel。
 * 每个 Channel 做三件事：接收外部消息 → 转成统一格式 → 把 agent 回复发回去。
 * Agent Loop 不关心消息从哪来，只看到 { role:'user', content } —— 加一个 Channel = 加一个适配器，核心零改动。
 */

// 统一入站/出站格式：不管从哪来，进 agent 前都转成这个结构
export interface IncomingMessage {
  channelId: string; // 会话标识（飞书 chat_id / Telegram chat.id）
  senderId: string; // 谁发的
  senderName: string;
  text: string;
  raw?: unknown;
}

export interface OutgoingMessage {
  channelId: string;
  recipientId: string;
  text: string;
}

export interface ChannelDefinition {
  name: string;
  description: string;

  start(): Promise<void> | void; // 生命周期：起 HTTP 服务/连接
  stop(): Promise<void> | void;
  send(message: OutgoingMessage): Promise<void>;

  // 回调注册：Channel 收到外部消息时调 handler，Gateway 据此统一处理
  onMessage?(handler: (msg: IncomingMessage) => void): void;
}
