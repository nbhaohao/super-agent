import type { ToolDefinition } from './registry.js';

export const weatherTool: ToolDefinition = {
    name: 'get_weather',
    description: '查询指定城市的天气信息',
    parameters: {
        type: 'object',
        properties: {
            city: { type: 'string', description: '城市名称，如"北京"、"上海"' },
        },
        required: ['city'],
        additionalProperties: false,
    },
    isConcurrencySafe: true,
    isReadOnly: true,
    execute: async ({ city }: { city: string }) => {
        const data: Record<string, string> = {
            '北京': '晴，15-25°C，东南风 2 级',
            '上海': '多云，18-22°C，西南风 3 级',
            '深圳': '阵雨，22-28°C，南风 2 级',
        };
        return data[city] || `${city}：暂无数据`;
    },
};
