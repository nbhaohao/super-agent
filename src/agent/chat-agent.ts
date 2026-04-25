import type { LanguageModel, ModelMessage } from 'ai';
import { Conversation } from './conversation.js';
import { agentLoop } from './agent-loop.js';
import { ToolRegistry } from '../tools/registry.js';
import { log } from '../lib/logger.js';

export type { AgentStreamPart, AgentOptions } from './agent-loop.js';

const SYSTEM_PROMPT = `你是 Super Agent，一个有工具调用能力的 AI 助手。
需要时主动使用工具获取信息，不要编造数据。`;

export class ChatAgent {
    private readonly conversation = new Conversation();

    constructor(
        private model: LanguageModel,
        private readonly registry: ToolRegistry = new ToolRegistry(),
    ) {}

    setModel(model: LanguageModel): void {
        this.model = model;
    }

    getHistory(): readonly ModelMessage[] {
        return this.conversation.getHistory();
    }

    async *chat(userInput: string, options = {}) {
        const toolNames = this.registry.getAll().map(t => t.name).join(', ');
        log('chat() turn start', `history: ${this.conversation.getHistory().length} messages, tools: [${toolNames}]`);

        this.conversation.addUserMessage(userInput);

        const messages = [...this.conversation.getHistory()];
        const priorLength = messages.length;

        yield* agentLoop(this.model, this.registry, messages, SYSTEM_PROMPT, options);

        this.conversation.appendMessages(messages.slice(priorLength));
        log('turn complete', `history now: ${this.conversation.getHistory().length} messages`);
    }
}
