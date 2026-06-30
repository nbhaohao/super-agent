/**
 * 手动 Agent Loop（s2 核心，s3 加三层防护 · 后端核心，重点 review）。
 *
 * think → act → observe：调一次 streamText（默认只跑一步）→ 模型出文本或工具调用 → SDK 执行工具
 * → 把这一步的消息追加回 messages → 没有工具调用就结束，否则继续让模型看着结果想下一步。
 * 为什么手动而不用 SDK 的 stopWhen 自动多步：生产里要在每步之间插日志、查 token、检测死循环、判断中断。
 *
 * 三层防护（s3，都在边界做检查，不动主循环逻辑）：
 *   ① 循环检测（detector）  ② API 容错（isRetryable + 指数退避重试）  ③ Token 预算（budget 由调用方持有，跨轮累计）
 *
 * 返回结构化结果（steps/stoppedBy/text）而非只靠 console——便于上层与测试断言「为什么停」。
 */
import { streamText, type ModelMessage, type ToolSet } from "ai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { createLoopDetector, type LoopDetector } from "./loop-detection.js";
import { isRetryable, calculateDelay, sleep } from "./retry.js";
import { silentLogger, type Logger } from "../obs/logger.js";
import { ProviderError } from "../errors.js";

/** Token 预算：由调用方持有并跨多轮 query 持续累计——写进函数内部会每轮清零（隐蔽 bug）。 */
export interface BudgetState {
  used: number;
  limit: number;
}

export type StopReason = "final" | "max_steps" | "loop_detected" | "budget";
export interface LoopResult {
  steps: number;
  stoppedBy: StopReason;
  text: string;
}

export interface AgentLoopOptions {
  system?: string;
  budget?: BudgetState;
  detector?: LoopDetector;
  logger?: Logger;
  maxSteps?: number;
  maxRetries?: number;
  out?: { write(s: string): void };
}

export async function agentLoop(
  model: LanguageModelV2,
  tools: ToolSet,
  messages: ModelMessage[],
  options: AgentLoopOptions = {},
): Promise<LoopResult> {
  const { system, budget, maxSteps = 15, maxRetries = 3 } = options;
  const detector = options.detector ?? createLoopDetector();
  const log = options.logger ?? silentLogger;
  const out = options.out ?? process.stdout;

  detector.reset();
  let finalText = "";
  let step = 0;

  while (step < maxSteps) {
    step++;
    log.debug("agent-loop step", { step });

    let hasToolCall = false;
    let fullText = "";
    let shouldBreak = false;
    let lastToolCall: { name: string; input: unknown } | null = null;
    let stepResponse: Awaited<
      ReturnType<typeof streamText>["response"]
    > | null = null;
    let stepUsage: Awaited<ReturnType<typeof streamText>["usage"]> | null =
      null;

    // ② 步骤级重试：包裹整个 stream 消费过程；maxRetries:0 禁用 SDK 内置重试，由我们全权接管
    for (let attempt = 1; ; attempt++) {
      try {
        const result = streamText({
          model,
          system,
          tools,
          messages,
          maxRetries: 0,
        });
        for await (const part of result.fullStream) {
          switch (part.type) {
            case "text-delta":
              out.write(part.text);
              fullText += part.text;
              break;
            case "tool-call": {
              hasToolCall = true;
              lastToolCall = { name: part.toolName, input: part.input };
              // ① 执行前先问：卡住了吗？
              const d = detector.detect(part.toolName, part.input);
              if (d.stuck) {
                log.warn("loop-detection", {
                  detector: d.detector,
                  level: d.level,
                  count: d.count,
                });
                if (d.level === "critical") shouldBreak = true;
                else
                  messages.push({
                    role: "user",
                    content: `[系统提醒] ${d.message}。请换一个思路解决问题，不要重复同样的操作。`,
                  });
              }
              detector.record(part.toolName, part.input);
              break;
            }
            case "tool-result":
              if (lastToolCall)
                detector.recordResult(
                  lastToolCall.name,
                  lastToolCall.input,
                  part.output,
                );
              break;
            case "error":
              throw part.error;
          }
        }
        stepResponse = await result.response;
        stepUsage = await result.usage;
        break; // 本步成功
      } catch (err) {
        if (attempt > maxRetries || !isRetryable(err)) {
          throw new ProviderError("LLM 调用失败：不可重试或已达重试上限", {
            cause: err,
          });
        }
        const delay = calculateDelay(attempt);
        log.warn("retry", { attempt, maxRetries, delay });
        await sleep(delay);
        hasToolCall = false;
        fullText = "";
        shouldBreak = false;
        lastToolCall = null;
      }
    }

    if (shouldBreak) {
      log.info("agent-loop stop", { reason: "loop_detected", step });
      return { steps: step, stoppedBy: "loop_detected", text: finalText };
    }

    messages.push(...(stepResponse!.messages as ModelMessage[]));
    if (fullText) finalText = fullText;

    // ③ Token 预算：累计本步用量，超了就停
    if (budget) {
      const u = stepUsage!;
      budget.used += (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
      log.debug("budget", { used: budget.used, limit: budget.limit });
      if (budget.used > budget.limit) {
        log.info("agent-loop stop", { reason: "budget", step });
        return { steps: step, stoppedBy: "budget", text: finalText };
      }
    }

    // 退出条件：模型这一步没调工具 = 它认为可以直接回复了
    if (!hasToolCall) {
      log.info("agent-loop stop", { reason: "final", step });
      return { steps: step, stoppedBy: "final", text: finalText };
    }
  }

  log.info("agent-loop stop", { reason: "max_steps", step });
  return { steps: step, stoppedBy: "max_steps", text: finalText };
}
