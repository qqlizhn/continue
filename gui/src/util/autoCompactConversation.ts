export const DEFAULT_AUTO_COMPACT_CONTEXT_THRESHOLD = 0.8;

export interface ShouldAutoCompactConversationOptions {
  historyLength: number;
  contextPercentage?: number;
  isPruned?: boolean;
  isCompactionLoading?: boolean;
  threshold?: number;
}

/**
 * Decide whether the current session should be compacted automatically.
 *
 * This is intentionally conservative:
 * - never compact while another compaction is already running
 * - require at least one user/assistant exchange
 * - compact immediately if the session has already been pruned
 * - otherwise compact when context usage crosses the threshold
 */
export function shouldAutoCompactConversation(
  options: ShouldAutoCompactConversationOptions,
): boolean {
  const {
    historyLength,
    contextPercentage,
    isPruned = false,
    isCompactionLoading = false,
    threshold = DEFAULT_AUTO_COMPACT_CONTEXT_THRESHOLD,
  } = options;

  if (isCompactionLoading || historyLength < 2) {
    return false;
  }

  if (isPruned) {
    return true;
  }

  if (typeof contextPercentage !== "number") {
    return false;
  }

  return contextPercentage >= threshold;
}
