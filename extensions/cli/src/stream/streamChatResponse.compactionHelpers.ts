import { ModelConfig } from "@continuedev/config-yaml";
import { BaseLlmApi } from "@continuedev/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions.mjs";

import { services } from "../services/index.js";
import { ToolCall } from "../tools/index.js";
import { logger } from "../util/logger.js";
import { validateContextLength } from "../util/tokenizer.js";

import { handleAutoCompaction } from "./streamChatResponse.autoCompaction.js";
import { BackgroundSummarizer } from "./backgroundSummarizer.js";
import { StreamCallbacks } from "./streamChatResponse.types.js";

interface CompactionHelperOptions {
  model: ModelConfig;
  llmApi: BaseLlmApi;
  isCompacting: boolean;
  isHeadless: boolean;
  callbacks?: StreamCallbacks;
  systemMessage: string;
  tools?: ChatCompletionTool[];
  backgroundSummarizer?: BackgroundSummarizer | null;
}

/**
 * Apply a completed background compaction result to the chat history.
 * Returns the updated history and a flag indicating whether compaction was applied.
 */
async function applyBackgroundCompactionIfReady(
  backgroundSummarizer: BackgroundSummarizer | null | undefined,
): Promise<{
  chatHistory: ChatHistoryItem[];
  wasCompacted: boolean;
}> {
  if (!backgroundSummarizer) {
    return { chatHistory: [], wasCompacted: false };
  }

  // Wait briefly for in-flight compaction if it's already close to done
  if (backgroundSummarizer.state === "InProgress") {
    // Don't wait long — the caller will fall back to foreground if needed
    try {
      await Promise.race([
        backgroundSummarizer.waitForCompletion(),
        new Promise((resolve) => setTimeout(resolve, 150)),
      ]);
    } catch {}
  }

  const result = backgroundSummarizer.consumeAndReset();
  if (!result) {
    return { chatHistory: [], wasCompacted: false };
  }

  logger.debug(
    `[BackgroundCompaction] applying pre-computed summary (${result.compactionContent.length} chars)`,
  );

  // Update history via service if available
  const chatHistorySvc = services.chatHistory;
  let updatedHistory = result.compactedHistory;
  if (
    typeof chatHistorySvc?.isReady === "function" &&
    chatHistorySvc.isReady()
  ) {
    chatHistorySvc.setHistory(updatedHistory);
    updatedHistory = chatHistorySvc.getHistory();
  }

  return { chatHistory: updatedHistory, wasCompacted: true };
}

/**
 * Handle pre-API auto-compaction if needed
 */
export async function handlePreApiCompaction(
  chatHistory: ChatHistoryItem[],
  options: CompactionHelperOptions,
): Promise<{ chatHistory: ChatHistoryItem[]; wasCompacted: boolean }> {
  const {
    model,
    llmApi,
    isCompacting,
    isHeadless,
    callbacks,
    systemMessage,
    tools,
    backgroundSummarizer,
  } = options;

  if (isCompacting) {
    return { chatHistory, wasCompacted: false };
  }

  // First, check if a background compaction is already completed and can be applied
  if (backgroundSummarizer?.state === "Completed") {
    const bgResult =
      await applyBackgroundCompactionIfReady(backgroundSummarizer);
    if (bgResult.wasCompacted) {
      return { chatHistory: bgResult.chatHistory, wasCompacted: true };
    }
  }

  const { wasCompacted, chatHistory: preCompactHistory } =
    await handleAutoCompaction(chatHistory, model, llmApi, {
      isHeadless,
      callbacks: {
        onSystemMessage: callbacks?.onSystemMessage,
        onContent: callbacks?.onContent,
      },
      systemMessage,
      tools,
    });

  if (wasCompacted) {
    logger.debug("Pre-API compaction occurred, updating chat history");
    const chatHistorySvc = services.chatHistory;
    if (
      typeof chatHistorySvc?.isReady === "function" &&
      chatHistorySvc.isReady()
    ) {
      chatHistorySvc.setHistory(preCompactHistory);
      return { chatHistory: chatHistorySvc.getHistory(), wasCompacted: true };
    }
    return { chatHistory: [...preCompactHistory], wasCompacted: true };
  }

  return { chatHistory, wasCompacted: false };
}

/**
 * Validate and handle context overflow after tool execution
 */
export async function handlePostToolValidation(
  toolCalls: ToolCall[],
  chatHistory: ChatHistoryItem[],
  options: CompactionHelperOptions,
): Promise<{ chatHistory: ChatHistoryItem[]; wasCompacted: boolean }> {
  const {
    model,
    llmApi,
    isHeadless,
    callbacks,
    systemMessage,
    tools,
    backgroundSummarizer,
  } = options;

  if (toolCalls.length === 0) {
    return { chatHistory, wasCompacted: false };
  }

  // Get updated history after tool execution
  const chatHistorySvc = services.chatHistory;
  if (
    typeof chatHistorySvc?.isReady === "function" &&
    chatHistorySvc.isReady()
  ) {
    chatHistory = chatHistorySvc.getHistory();
  }

  const SAFETY_BUFFER = 100;
  const postToolValidation = validateContextLength({
    chatHistory,
    model,
    safetyBuffer: SAFETY_BUFFER,
    systemMessage,
    tools,
  });

  // If tool results pushed us over limit, force compaction regardless of threshold
  if (!postToolValidation.isValid) {
    logger.warn("Tool execution caused context overflow, forcing compaction", {
      inputTokens: postToolValidation.inputTokens,
      contextLimit: postToolValidation.contextLimit,
    });

    // First, try to apply a background compaction if it's ready
    if (backgroundSummarizer?.state === "Completed") {
      const bgResult =
        await applyBackgroundCompactionIfReady(backgroundSummarizer);
      if (bgResult.wasCompacted) {
        chatHistory = bgResult.chatHistory;

        // Verify compaction brought us under the limit
        const postCompactionValidation = validateContextLength({
          chatHistory,
          model,
          safetyBuffer: SAFETY_BUFFER,
          systemMessage,
          tools,
        });

        if (postCompactionValidation.isValid) {
          logger.info(
            "Successfully applied background compaction after tool overflow",
          );
          return { chatHistory, wasCompacted: true };
        }

        logger.warn(
          "Background compaction didn't bring context under limit, falling back to foreground",
        );
      }
    }

    // Force compaction (compaction now accounts for system message during pruning)
    const { wasCompacted, chatHistory: compactedHistory } =
      await handleAutoCompaction(chatHistory, model, llmApi, {
        isHeadless,
        callbacks: {
          onSystemMessage: callbacks?.onSystemMessage,
          onContent: callbacks?.onContent,
        },
        systemMessage,
        tools,
      });

    if (wasCompacted) {
      // Use the service to update history if available, otherwise use local copy
      if (chatHistorySvc && typeof chatHistorySvc.setHistory === "function") {
        chatHistorySvc.setHistory(compactedHistory);
        chatHistory = chatHistorySvc.getHistory();
      } else {
        // Fallback: use the compacted history directly when service unavailable
        chatHistory = compactedHistory;
      }

      // Verify compaction brought us under the limit
      const postCompactionValidation = validateContextLength({
        chatHistory,
        model,
        safetyBuffer: SAFETY_BUFFER,
        systemMessage,
        tools,
      });

      if (!postCompactionValidation.isValid) {
        logger.error(
          "Compaction failed to bring context under limit, stopping execution",
          {
            inputTokens: postCompactionValidation.inputTokens,
            contextLimit: postCompactionValidation.contextLimit,
          },
        );
        throw new Error(
          `Context limit exceeded even after compaction: ${postCompactionValidation.error}`,
        );
      }

      logger.info("Successfully compacted after tool overflow", {
        inputTokens: postCompactionValidation.inputTokens,
        contextLimit: postCompactionValidation.contextLimit,
      });
      return { chatHistory, wasCompacted: true };
    } else {
      // Compaction failed, cannot continue
      logger.error("Failed to compact history after tool execution overflow");
      throw new Error(
        "Context limit exceeded and compaction failed. Unable to continue.",
      );
    }
  }

  return { chatHistory, wasCompacted: false };
}

/**
 * Handle normal auto-compaction check at 80% threshold
 */
export async function handleNormalAutoCompaction(
  chatHistory: ChatHistoryItem[],
  shouldContinue: boolean,
  options: CompactionHelperOptions,
): Promise<{ chatHistory: ChatHistoryItem[]; wasCompacted: boolean }> {
  const {
    model,
    llmApi,
    isHeadless,
    callbacks,
    systemMessage,
    tools,
    backgroundSummarizer,
  } = options;

  if (!shouldContinue) {
    return { chatHistory, wasCompacted: false };
  }

  const chatHistorySvc = services.chatHistory;
  if (
    typeof chatHistorySvc?.isReady === "function" &&
    chatHistorySvc.isReady()
  ) {
    chatHistory = chatHistorySvc.getHistory();
  }

  // First, try to apply a background compaction if it's ready
  if (backgroundSummarizer?.state === "Completed") {
    const bgResult =
      await applyBackgroundCompactionIfReady(backgroundSummarizer);
    if (bgResult.wasCompacted) {
      return { chatHistory: bgResult.chatHistory, wasCompacted: true };
    }
  }

  const { wasCompacted, chatHistory: updatedChatHistory } =
    await handleAutoCompaction(chatHistory, model, llmApi, {
      isHeadless,
      callbacks: {
        onSystemMessage: callbacks?.onSystemMessage,
        onContent: callbacks?.onContent,
      },
      systemMessage,
      tools,
    });

  if (wasCompacted) {
    // Use the service to update history if available, otherwise use local copy
    if (chatHistorySvc && typeof chatHistorySvc.setHistory === "function") {
      chatHistorySvc.setHistory(updatedChatHistory);
      return {
        chatHistory: chatHistorySvc.getHistory(),
        wasCompacted: true,
      };
    }
    // Fallback: return the compacted history directly when service unavailable
    return { chatHistory: updatedChatHistory, wasCompacted: true };
  }

  return { chatHistory, wasCompacted: false };
}
