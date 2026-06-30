/**
 * 已就位（AI 生成）—— 两个演示工具（s2）。
 *
 * 一个工具 = description（给模型看，决定何时调）+ inputSchema（参数 JSON Schema，SDK 据此
 * 校验+拦截非法参数）+ execute（真正干活的 async 函数，返回值被序列化塞回对话）。
 * 工具的 description / 参数 description 本质就是 prompt——写得越准，模型调用越精准。
 */
import { tool, jsonSchema } from 'ai';

const MOCK_WEATHER: Record<string, string> = {
  北京: '晴，15-25°C，东南风 2 级',
  上海: '多云，18-22°C，西南风 3 级',
  深圳: '阵雨，22-28°C，南风 2 级',
};

export const weatherTool = tool({
  description: '查询指定城市的实时天气信息（温度、风向等）',
  inputSchema: jsonSchema<{ city: string }>({
    type: 'object',
    properties: { city: { type: 'string', description: '城市名称，如"北京"、"上海"' } },
    required: ['city'],
    additionalProperties: false,
  }),
  execute: async ({ city }) => MOCK_WEATHER[city] ?? `${city}：暂无数据`,
});

export const calculatorTool = tool({
  description: '计算数学表达式的结果。当用户提问涉及数学运算时使用',
  inputSchema: jsonSchema<{ expression: string }>({
    type: 'object',
    properties: { expression: { type: 'string', description: '数学表达式，如 "2 + 3 * 4"' } },
    required: ['expression'],
    additionalProperties: false,
  }),
  execute: async ({ expression }) => {
    try {
      // ponytail: new Function 仅供演示，生产里换成真正的表达式求值器（安全沙箱）。
      const result = new Function(`return (${expression})`)();
      return `${expression} = ${result}`;
    } catch {
      return `无法计算: ${expression}`;
    }
  },
});

export const tools = { get_weather: weatherTool, calculator: calculatorTool };
