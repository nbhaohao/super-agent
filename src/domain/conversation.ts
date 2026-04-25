import type { ModelMessage } from 'ai';

// Conversation 是核心聚合根，负责维护对话历史
// 后续可在这里加 token 计数、历史截断、持久化等能力
export class Conversation {
    private readonly messages: ModelMessage[] = [];

    addUserMessage(content: string): void {
        this.messages.push({ role: 'user', content });
    }

    addAssistantMessage(content: string): void {
        this.messages.push({ role: 'assistant', content });
    }

    // 返回只读快照，防止外部直接修改历史
    getHistory(): readonly ModelMessage[] {
        return this.messages;
    }
}
