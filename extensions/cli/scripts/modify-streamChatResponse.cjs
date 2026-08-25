const fs = require("fs");
const path = "C:/Users/ws/continue/extensions/cli/src/stream/streamChatResponse.ts";

let src = fs.readFileSync(path, "utf8");

// 1. Add import for BackgroundSummarizer after the types.js import
const importMarker = 'from "./streamChatResponse.types.js";';
const importInsert =
  'from "./streamChatResponse.types.js";\n' +
  "import {\n" +
  "  BackgroundSummarizer,\n" +
  "  shouldKickOffBackgroundSummarization,\n" +
  '} from "./backgroundSummarizer.js";';

if (!src.includes("BackgroundSummarizer")) {
  src = src.replace(importMarker, importInsert);
  console.log("Step 1: Added BackgroundSummarizer imports");
} else {
  console.log("Step 1: Imports already present");
}

// 2. Add backgroundSummarizer variable in streamChatResponse function
const varMarker =
  '  let compactionOccurredThisTurn = false; // Track if compaction happened during this conversation turn';
const varInsert =
  '  let compactionOccurredThisTurn = false; // Track if compaction happened during this conversation turn\n' +
  "  // Background summarizer for pre-emptive compaction (parallel to Copilot's mechanism)\n" +
  "  let backgroundSummarizer: BackgroundSummarizer | null = null;";

if (!src.includes("backgroundSummarizer: BackgroundSummarizer")) {
  src = src.replace(varMarker, varInsert);
  console.log("Step 2: Added backgroundSummarizer variable");
} else {
  console.log("Step 2: Variable already present");
}

// 3. Modify handlePreApiCompaction call to pass backgroundSummarizer
const preApiCall = src.indexOf("const preCompactionResult = await handlePreApiCompaction(");
if (preApiCall !== -1) {
  // Find the closing of the options object (})
  const optionsStart = src.indexOf("{", preApiCall);
  // Find the closing brace - find next "});" after optionsStart
  const closingBrace = src.indexOf("});", optionsStart);
  if (closingBrace !== -1) {
    const before = src.substring(0, closingBrace);
    const after = src.substring(closingBrace);
    const newSrc = before + ",\n      backgroundSummarizer,\n    }" + after.substring(1);
    src = newSrc;
    console.log("Step 3: Modified handlePreApiCompaction call to pass backgroundSummarizer");
  } else {
    console.log("Step 3: Could not find closing brace for handlePreApiCompaction");
  }
} else {
  console.log("Step 3: handlePreApiCompaction not found");
}

// 4. Add cancel on abort
const abortMarker = '    if (abortController?.signal.aborted) {\n      return finalResponse || content || fullResponse;\n    }';
const abortReplace =
  "    if (abortController?.signal.aborted) {\n" +
  "      // Cancel any in-flight background compaction\n" +
  "      backgroundSummarizer?.cancel();\n" +
  "      backgroundSummarizer = null;\n" +
  "      return finalResponse || content || fullResponse;\n" +
  "    }";

if (src.includes(abortMarker) && !src.includes("backgroundSummarizer?.cancel()")) {
  src = src.replace(abortMarker, abortReplace);
  console.log("Step 4: Added cancel on abort");
} else {
  console.log("Step 4: Abort handling already present or marker not found");
}

// 5. Add background compaction kick-off at shouldReturn
const shouldReturnMarker = '    if (shouldReturn) {\n      return finalResponse || content || fullResponse;\n    }';
const shouldReturnReplace =
  "    if (shouldReturn) {\n" +
  "      // Kick off background compaction for next turn if approaching limit\n" +
  "      backgroundSummarizer = await maybeStartBackgroundCompaction(\n" +
  "        backgroundSummarizer,\n" +
  "        chatHistory,\n" +
  "        model,\n" +
  "        llmApi,\n" +
  "        usage,\n" +
  "        systemMessage,\n" +
  "        isHeadless,\n" +
  "        callbacks,\n" +
  "      );\n" +
  "      return finalResponse || content || fullResponse;\n" +
  "    }";

if (src.includes(shouldReturnMarker) && !src.includes("maybeStartBackgroundCompaction(")) {
  src = src.replace(shouldReturnMarker, shouldReturnReplace);
  console.log("Step 5: Added background compaction at shouldReturn");
} else {
  console.log("Step 5: Already present or marker not found");
}

// 6. Modify handlePostToolValidation call to pass backgroundSummarizer
const postToolMarker = "const postToolResult = await handlePostToolValidation(";
if (src.includes(postToolMarker)) {
  const postToolIndex = src.indexOf(postToolMarker);
  const braceStart = src.indexOf("{", postToolIndex);
  const braceEnd = src.indexOf("},", braceStart + 1);
  if (braceEnd !== -1 && braceStart !== -1) {
    const before = src.substring(0, braceEnd);
    const after = src.substring(braceEnd);
    const newSrc = before + ",\n        backgroundSummarizer,\n      }," + after.substring(1);
    src = newSrc;
    console.log("Step 6: Modified handlePostToolValidation to pass backgroundSummarizer");
  } else {
    console.log("Step 6: Could not find proper brace structure");
  }
}

// 7. Modify handleNormalAutoCompaction call to pass backgroundSummarizer
const normalCompactionMarker = "const compactionResult = await handleNormalAutoCompaction(";
if (src.includes(normalCompactionMarker)) {
  const normalIndex = src.indexOf(normalCompactionMarker);
  const optionsStart = src.indexOf("{", normalIndex);
  // Find the closing of this object
  const closer = src.indexOf("},\n    );", optionsStart);
  if (closer !== -1) {
    const before = src.substring(0, closer);
    const after = src.substring(closer);
    const newSrc = before + ",\n        backgroundSummarizer,\n      }" + after.substring(1);
    src = newSrc;
    console.log("Step 7: Modified handleNormalAutoCompaction to pass backgroundSummarizer");
  } else {
    console.log("Step 7: Could not find closing for handleNormalAutoCompaction");
  }
}

// 8. Replace break block to trigger background compaction
const breakMarker = '    // Check if we should continue (skip break if auto-continuing after compaction)\n    if (!shouldContinue && !shouldAutoContinue) {\n      break;\n    }';
const breakReplace =
  "    // Check if we should continue (skip break if auto-continuing after compaction)\n" +
  "    if (!shouldContinue && !shouldAutoContinue) {\n" +
  "      // Kick off background compaction for next turn if approaching limit\n" +
  "      backgroundSummarizer = await maybeStartBackgroundCompaction(\n" +
  "        backgroundSummarizer,\n" +
  "        chatHistory,\n" +
  "        model,\n" +
  "        llmApi,\n" +
  "        usage,\n" +
  "        systemMessage,\n" +
  "        isHeadless,\n" +
  "        callbacks,\n" +
  "      );\n" +
  "      break;\n" +
  "    }";

if (src.includes(breakMarker) && !src.includes("Kick off background compaction for next turn")) {
  src = src.replace(breakMarker, breakReplace);
  console.log("Step 8: Modified break block to trigger background compaction");
} else {
  console.log("Step 8: Already present or marker not found");
}

// 9. Append the maybeStartBackgroundCompaction and estimateTotalTokens functions at the end
if (!src.includes("function maybeStartBackgroundCompaction")) {
  src += `

/**
 * Kick off a background compaction if approaching the context limit.
 * Uses cache-warm detection (cache_read_tokens > 0 means warm).
 */
async function maybeStartBackgroundCompaction(
  backgroundSummarizer: BackgroundSummarizer | null,
  chatHistory: ChatHistoryItem[],
  model: ModelConfig,
  llmApi: BaseLlmApi,
  usage: any,
  systemMessage: string,
  isHeadless: boolean,
  callbacks?: StreamCallbacks,
): Promise<BackgroundSummarizer | null> {
  // If we already have one running or completed, keep it
  if (
    backgroundSummarizer &&
    backgroundSummarizer.state !== "Idle" &&
    backgroundSummarizer.state !== "Failed"
  ) {
    return backgroundSummarizer;
  }

  // Don't background-compact in headless mode (avoid unsolicited API calls)
  if (isHeadless) {
    return backgroundSummarizer;
  }

  try {
    // Calculate current context ratio using token counts.
    // Use usage.prompt_tokens if available (from stream chunk), otherwise estimate.
    const promptTokens =
      usage?.prompt_tokens ?? (await estimateTotalTokens(chatHistory, model));
    const { getModelContextLimit, getModelMaxTokens } = await import(
      "../util/tokenizer.js"
    );
    const contextLimit = getModelContextLimit(model);
    const maxTokens = getModelMaxTokens(model);
    const baseBudget = contextLimit - maxTokens;
    if (baseBudget <= 0) {
      return backgroundSummarizer;
    }
    const ratio = promptTokens / baseBudget;

    // Detect cache warm from usage details
    const cacheReadTokens =
      usage?.prompt_tokens_details?.cache_read_tokens ?? 0;
    const cacheWarm = cacheReadTokens > 0;

    logger.debug(
      \`[BackgroundCompaction] post-turn context ratio: \${(ratio * 100).toFixed(1)}%, cacheWarm=\${cacheWarm}, promptTokens=\${promptTokens}\`,
    );

    if (shouldKickOffBackgroundSummarization(ratio, cacheWarm, Math.random)) {
      // Compute system message token count for compaction pruning
      const { countChatHistoryItemTokens } = await import(
        "../util/tokenizer.js"
      );
      const systemMessageTokens = countChatHistoryItemTokens(
        {
          message: {
            role: "system",
            content: systemMessage,
          },
          contextItems: [],
        },
        model,
      );

      const summarizer = new BackgroundSummarizer();
      summarizer.start(async () => {
        const { runBackgroundCompaction } = await import(
          "./backgroundSummarizer.js"
        );
        return runBackgroundCompaction(
          chatHistory,
          model,
          llmApi,
          systemMessageTokens,
        );
      });

      logger.info(
        \`[BackgroundCompaction] started background compaction at \${(ratio * 100).toFixed(1)}% context usage\`,
      );
      return summarizer;
    }
  } catch (err) {
    logger.warn(
      \`[BackgroundCompaction] failed to start background compaction: \${err}\`,
    );
  }

  return backgroundSummarizer;
}

/**
 * Estimate the total token count of a chat history by summing individual
 * message token counts. Used as a fallback when usage metadata is unavailable.
 */
async function estimateTotalTokens(
  chatHistory: ChatHistoryItem[],
  model: ModelConfig,
): Promise<number> {
  const { countChatHistoryItemTokens } = await import(
    "../util/tokenizer.js"
  );
  let total = 0;
  for (const item of chatHistory) {
    total += countChatHistoryItemTokens(item, model);
  }
  return total;
}
`;
  console.log("Step 9: Appended maybeStartBackgroundCompaction and estimateTotalTokens");
} else {
  console.log("Step 9: Functions already present");
}

fs.writeFileSync(path, src, "utf8");
console.log("Done! File written successfully.");
