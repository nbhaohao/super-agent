import { jsonSchema } from 'ai';

export const checkStatusTool = {
    description: '检查异步任务的执行状态',
    inputSchema: jsonSchema({
        type: 'object',
        properties: {
            task_id: { type: 'string', description: '任务 ID' },
        },
        required: ['task_id'],
        additionalProperties: false,
    }),
    execute: async ({ task_id }: { task_id: string }) => {
        return { status: 'running', task_id, message: '任务仍在执行中，请稍后再试' };
    },
};
