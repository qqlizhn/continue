import { ModelConfig } from "@continuedev/config-yaml";
import { BaseLlmApi } from "@continuedev/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions.mjs";
import React from "react";

import {
  compactChatHistory,
  getAutoCompactMessage,
  shouldAutoCompact,
} from "../compaction.js";
import { updateSessionHistory } from "../session.js";
import { formatError } from "../util/formatError.js";
import { logger } from "../util/logger.js";
import {
  BackgroundSummarizer,
  shouldKickOffBackgroundSummarization,
} from "./backgroundSummarizer.js";

interface AutoCompactionCallbacks {
  // For streaming mode
  onSystemMessage?: (message: string) => void;
  onContent?: (content: string) => void;

  // For TUI mode
  setMessages?: React.Dispatch<React.SetStateAction<ChatHistoryItem[]>>;
  setChatHistory?: React.Dispatch<React.SetStateAction<ChatHistoryItem[]>>;
  setCompactionIndex?: React.Dispatch<React.SetStateAction<number | null>>;

  // For headless mode - no callbacks needed, just return values
}

interface AutoCompactionOptions {
  isHeadless?: boolean;
  format?: "json";
  callbacks?: AutoCompactionCallbacks;
  systemMessage?: string;
  tools?: ChatCompletionTool[];
}
