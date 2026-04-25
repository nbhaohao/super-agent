import type { ToolDefinition } from './registry.js';

export const checkStatusTool: ToolDefinition = {
    name: 'check_status',
    description: '检查异步任务的执行状态',
    parameters: {
        type: 'object',
        properties: {
            task_id: { type: 'string', description: '任务 ID' },
        },
        required: ['task_id'],
        additionalProperties: false,
    },
    isConcurrencySafe: true,
    isReadOnly: true,
    execute: async ({ task_id }: { task_id: string }) => {
        return { status: 'running', task_id, message: '任务仍在执行中，请稍后再试' };
    },
};
