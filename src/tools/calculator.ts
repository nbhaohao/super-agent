import { jsonSchema } from 'ai';

export const calculatorTool = {
    description: '计算数学表达式的结果。当用户提问涉及数学运算时使用',
    inputSchema: jsonSchema({
        type: 'object',
        properties: {
            expression: { type: 'string', description: '数学表达式，如 "2 + 3 * 4"' },
        },
        required: ['expression'],
        additionalProperties: false,
    }),
    execute: async ({ expression }: { expression: string }) => {
        try {
            const result = new Function(`return ${expression}`)();
            return `${expression} = ${result}`;
        } catch {
            return `无法计算: ${expression}`;
        }
    },
};
