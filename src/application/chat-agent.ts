import { streamText } from 'ai';
import type { LanguageModel } from 'ai';
import { Conversation } from '../domain/conversation.js';

const SYSTEM_PROMPT = `你是 Super Agent，一个专注于软件开发的 AI 助手。
你说话简洁直接，喜欢用代码示例来解释问题。
如果用户的问题不够清晰，你会反问而不是瞎猜。`;

// ChatAgent 是应用服务：协调 LLM 调用与对话历史
// 返回 AsyncGenerator 让调用方自行处理流式输出，实现 I/O 分离
export class ChatAgent {
    private readonly conversation = new Conversation();

    constructor(private readonly model: LanguageModel) {}

    async *chat(userInput: string): AsyncGenerator<string> {
        this.conversation.addUserMessage(userInput);

        const result = streamText({
            model: this.model,
            messages: [...this.conversation.getHistory()],
            system: SYSTEM_PROMPT,
        });

        let fullResponse = '';
        for await (const chunk of result.textStream) {
            fullResponse += chunk;
            yield chunk;
        }

        // 流结束后才写入历史，保证历史里存的是完整回复
        this.conversation.addAssistantMessage(fullResponse);
    }
}
