import { weatherTool } from './weather.js';
import { calculatorTool } from './calculator.js';

// 工具注册表：新增工具时只在这里加一行
export const tools = {
    get_weather: weatherTool,
    calculator: calculatorTool,
};
