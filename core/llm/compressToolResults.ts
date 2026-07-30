import { ChatMessage } from "../index.js";
import { countChatMessageTokens } from "./countTokens.js";

/**
 * Tool result compression for conversation history.
 *
 * Two tiers apply when history exceeds the available token budget:
 *
 * | tier   | content                | when applied         |
 * |--------|------------------------|----------------------|
 * | mid    | truncated to 2000 chars| older tool results   |
 * | stub   | one-line placeholder   | still over budget    |
 *
 * The most recent RECENT_KEEP tool results are always left untouched.
 * This runs before the binary-drop loop in compileChatMessages so the
 * conversation continues longer without losing all historical tool context.
 */

/** Chars kept in mid-tier truncation. ~2 000 chars ≈ 500 tokens. */
const MID_MAX_CHARS = 2_000;

/** Number of most-recent tool result messages to leave untouched. */
const RECENT_KEEP = 2;

/** Placeholder used for fully cleared tool results. */
export const TOOL_RESULT_CLEARED_CONTENT =
  "[Tool result cleared to save context window space]";

/**
 * Compresses older tool_result messages in-place (on a shallow copy) to
 * reduce token usage. Returns the (possibly modified) message array.
 *
 * @param msgs           History messages, excluding system + toolSequence.
 * @param modelName      Model name used for token counting.
 * @param availableTokens Budget available for this history slice.
 */
export function compressOldToolResults(
  msgs: ChatMessage[],
  modelName: string,
  availableTokens: number,
): ChatMessage[] {
  // Count total tokens upfront; bail early if already within budget.
  let totalTokens = msgs.reduce(
    (sum, msg) => sum + countChatMessageTokens(modelName, msg),
    0,
  );

  if (totalTokens <= availableTokens) {
    return msgs;
  }

  // Collect indices of all tool result messages, oldest first.
  const toolResultIndices: number[] = [];
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role === "tool") {
      toolResultIndices.push(i);
    }
  }

  if (toolResultIndices.length === 0) {
    return msgs;
  }

  // Work on a shallow copy so the original array is not mutated.
  const result: ChatMessage[] = msgs.map((m) => ({ ...m }));

  // Indices eligible for compression: all except the most-recent RECENT_KEEP.
  const compressible = toolResultIndices.slice(0, -RECENT_KEEP);

  // ── Phase 1: truncate to MID_MAX_CHARS ──────────────────────────────────
  for (const idx of compressible) {
    if (totalTokens <= availableTokens) break;

    const msg = result[idx];
    if (msg.role !== "tool") continue;
    if (
      msg.content === TOOL_RESULT_CLEARED_CONTENT ||
      msg.content.length <= MID_MAX_CHARS
    ) {
      continue;
    }

    const oldTokens = countChatMessageTokens(modelName, msg);
    const trimmed = msg.content.slice(0, MID_MAX_CHARS);
    const omitted = msg.content.length - MID_MAX_CHARS;
    (result[idx] as typeof msg) = {
      ...msg,
      content: `${trimmed}\n[...${omitted} chars omitted to save context]`,
    };
    const newTokens = countChatMessageTokens(modelName, result[idx]);
    totalTokens -= oldTokens - newTokens;
  }

  if (totalTokens <= availableTokens) {
    return result;
  }

  // ── Phase 2: replace with one-line stub ─────────────────────────────────
  for (const idx of compressible) {
    if (totalTokens <= availableTokens) break;

    const msg = result[idx];
    if (msg.role !== "tool") continue;
    if (msg.content === TOOL_RESULT_CLEARED_CONTENT) continue;

    const oldTokens = countChatMessageTokens(modelName, msg);
    (result[idx] as typeof msg) = {
      ...msg,
      content: TOOL_RESULT_CLEARED_CONTENT,
    };
    const newTokens = countChatMessageTokens(modelName, result[idx]);
    totalTokens -= oldTokens - newTokens;
  }

  return result;
}
