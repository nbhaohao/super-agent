import { weatherTool } from './weather.js';
import { calculatorTool } from './calculator.js';
import { checkStatusTool } from './check-status.js';

export const tools = {
    get_weather: weatherTool,
    calculator: calculatorTool,
};

// demo 场景专用：包含 check_status
export const demoTools = {
    get_weather: weatherTool,
    check_status: checkStatusTool,
};
