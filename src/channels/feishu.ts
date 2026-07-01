/**
 * 飞书 Channel 适配器（m05 s19，gen 已就位，扫一眼）。
 *
 * 把统一的 ChannelDefinition 落到飞书：start() 起一个 HTTP 服务收 webhook 事件，
 * onMessage 收到消息回调给 Gateway；send() 调飞书开放平台 API 把回复发回群里。
 * 需要 FEISHU_WEBHOOK_PORT + FEISHU_TENANT_TOKEN（真接时配）。核心零改动——只是把 emit/send 换成真 IO。
 */
import http from "node:http";
import type {
  ChannelDefinition,
  IncomingMessage,
  OutgoingMessage,
} from "./types.js";

export interface FeishuOptions {
  port?: number;
  tenantToken?: string; // 飞书 tenant_access_token，发消息鉴权用
}

export class FeishuChannel implements ChannelDefinition {
  name = "feishu";
  description = "飞书机器人通道（webhook 收 + 开放平台 API 发）";
  private handler?: (msg: IncomingMessage) => void;
  private server?: http.Server;
  private opts: FeishuOptions;

  constructor(opts: FeishuOptions = {}) {
    this.opts = opts;
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.handler = handler;
  }

  start(): Promise<void> {
    const port = this.opts.port ?? Number(process.env.FEISHU_WEBHOOK_PORT) ?? 3000;
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        if (req.method !== "POST") {
          res.end("ok");
          return;
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const evt = JSON.parse(body);
            // 飞书 URL 验证挑战
            if (evt.type === "url_verification") {
              res.end(JSON.stringify({ challenge: evt.challenge }));
              return;
            }
            const m = evt.event?.message;
            if (m) {
              this.handler?.({
                channelId: m.chat_id,
                senderId: evt.event.sender?.sender_id?.open_id ?? "unknown",
                senderName: evt.event.sender?.sender_id?.open_id ?? "user",
                text: JSON.parse(m.content ?? "{}").text ?? "",
                raw: evt,
              });
            }
          } catch {
            /* 忽略非法 payload */
          }
          res.end("ok");
        });
      });
      this.server.listen(port, () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
  }

  async send(message: OutgoingMessage): Promise<void> {
    const token = this.opts.tenantToken ?? process.env.FEISHU_TENANT_TOKEN;
    if (!token) {
      console.log(`  [feishu] (未配 token，跳过发送) → ${message.text}`);
      return;
    }
    await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: message.channelId,
        msg_type: "text",
        content: JSON.stringify({ text: message.text }),
      }),
    });
  }
}
