import type { ModelMessage } from 'ai';

export class Conversation {
    private readonly messages: ModelMessage[] = [];

    addUserMessage(content: string): void {
        this.messages.push({ role: 'user', content });
    }

    addAssistantMessage(content: string): void {
        this.messages.push({ role: 'assistant', content });
    }

    appendMessages(newMessages: readonly ModelMessage[]): void {
        this.messages.push(...newMessages);
    }

    getHistory(): readonly ModelMessage[] {
        return this.messages;
    }
}
