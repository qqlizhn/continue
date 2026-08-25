import { ModelConfig } from "@continuedev/config-yaml";
import { BaseLlmApi } from "@continuedev/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";

import { compactChatHistory, CompactionResult } from "../compaction.js";
import { logger } from "../util/logger.js";

/**
 * State machine for background conversation summarization.
 *
 * Lifecycle:
 *   Idle → InProgress → Completed / Failed
 *                              ↓          ↓
 *                        (consumeAndReset → Idle)
 *                                    Failed → InProgress (retry)
 */

export const enum BackgroundSummarizationState {
  /** No summarization running. */
  Idle = "Idle",
  /** An LLM summarization request is in flight. */
  InProgress = "InProgress",
  /** Summarization finished successfully — summary text is available. */
  Completed = "Completed",
  /** Summarization failed. */
  Failed = "Failed",
}

export interface IBackgroundSummarizationResult {
  readonly compactedHistory: ChatHistoryItem[];
  readonly compactionIndex: number;
  readonly compactionContent: string;
  readonly durationMs?: number;
}

/**
 * Thresholds used by {@link shouldKickOffBackgroundSummarization}.
 */
export const BackgroundSummarizationThresholds = {
  /** Minimum of the jittered warm range. */
  warmJitterMin: 0.78,
  /** Width of the jittered warm range; together with `warmJitterMin` yields [0.78, 0.82). */
  warmJitterSpan: 0.04,
  /**
   * Emergency ratio. Above this we kick off even without good conditions,
   * to avoid forcing a foreground sync compaction on the next render.
   */
  emergency: 0.9,
  /**
   * Minimum context ratio for applying a previously-completed background
   * summary. Below this we discard the stale summary — typically because
   * the user switched to a model with a larger context window.
   */
  applyMinRatio: 0.65,
} as const;

/**
 * Decide whether to kick off post-render background compaction.
 *
 * Uses jittered thresholds to avoid always firing at the exact same boundary.
 * `rng` is only consumed on the warm branch, keeping deterministic tests easy.
 *
 * @param postRenderRatio - Context usage ratio after a render (0.0 - 1.0+)
 * @param cacheWarm - Whether the current request had a cache hit (warm cache)
 * @param rng - Random number generator (0-1)
 */
export function shouldKickOffBackgroundSummarization(
  postRenderRatio: number,
  cacheWarm: boolean,
  rng: () => number,
): boolean {
  const t = BackgroundSummarizationThresholds;
  if (!cacheWarm) {
    return postRenderRatio >= t.emergency;
  }
  const jittered = t.warmJitterMin + rng() * t.warmJitterSpan;
  return postRenderRatio >= jittered;
}

/**
 * Tracks a single background summarization pass for one chat session.
 */
export class BackgroundSummarizer {
  private _state: BackgroundSummarizationState =
    BackgroundSummarizationState.Idle;
  private _result: IBackgroundSummarizationResult | undefined;
  private _error: unknown;
  private _promise: Promise<void> | undefined;
  private _abortController: AbortController | undefined;

  get state(): BackgroundSummarizationState {
    return this._state;
  }

  get error(): unknown {
    return this._error;
  }

  /**
   * Start a background compaction. No-op if already running or completed.
   */
  start(
    work: () => Promise<IBackgroundSummarizationResult>,
    parentAbortSignal?: AbortSignal,
  ): void {
    if (
      this._state !== BackgroundSummarizationState.Idle &&
      this._state !== BackgroundSummarizationState.Failed
    ) {
      return; // already running or completed
    }

    this._state = BackgroundSummarizationState.InProgress;
    this._error = undefined;
    this._abortController = new AbortController();

    // Link parent abort signal if provided
    if (parentAbortSignal) {
      if (parentAbortSignal.aborted) {
        this._abortController.abort();
      } else {
        parentAbortSignal.addEventListener(
          "abort",
          () => this._abortController?.abort(),
          { once: true },
        );
      }
    }

    const startTime = Date.now();
    this._promise = work().then(
      (result) => {
        if (this._state !== BackgroundSummarizationState.InProgress) {
          return; // cancelled while in flight
        }
        this._result = {
          ...result,
          durationMs: Date.now() - startTime,
        };
        this._state = BackgroundSummarizationState.Completed;
        logger.debug(
          `[BackgroundSummarizer] compaction completed (${result.compactionContent.length} chars, ${this._result.durationMs}ms)`,
        );
      },
      (err) => {
        if (this._state !== BackgroundSummarizationState.InProgress) {
          return; // cancelled while in flight
        }
        this._error = err;
        this._state = BackgroundSummarizationState.Failed;
        logger.warn(`[BackgroundSummarizer] compaction failed: ${err}`);
      },
    );
  }

  /**
   * Wait for the in-flight compaction to complete (resolves even on failure).
   */
  async waitForCompletion(): Promise<void> {
    if (this._promise) {
      await this._promise;
    }
  }

  /**
   * Take the completed result and reset the state machine to Idle.
   * Returns `undefined` if not Completed.
   */
  consumeAndReset(): IBackgroundSummarizationResult | undefined {
    if (this._state !== BackgroundSummarizationState.Completed) {
      this._reset();
      return undefined;
    }
    const result = this._result;
    this._reset();
    return result;
  }

  /**
   * Cancel any in-flight work and reset to Idle.
   */
  cancel(): void {
    this._abortController?.abort();
    this._reset();
  }

  private _reset(): void {
    this._state = BackgroundSummarizationState.Idle;
    this._result = undefined;
    this._error = undefined;
    this._promise = undefined;
    this._abortController = undefined;
  }
}

/**
 * Convenience helper to actually run a background compaction using
 * `compactChatHistory` and call `updateSessionHistory` on success.
 */
export async function runBackgroundCompaction(
  chatHistory: ChatHistoryItem[],
  model: ModelConfig,
  llmApi: BaseLlmApi,
  systemMessageTokens = 0,
  abortSignal?: AbortSignal,
): Promise<IBackgroundSummarizationResult> {
  const controller = new AbortController();
  if (abortSignal) {
    if (abortSignal.aborted) {
      controller.abort();
    } else {
      abortSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  const result = await compactChatHistory(chatHistory, model, llmApi, {
    abortController: controller,
    systemMessageTokens,
  });

  // Persist the compacted history
  const { updateSessionHistory } = await import("../session.js");
  updateSessionHistory(result.compactedHistory);

  return {
    compactedHistory: result.compactedHistory,
    compactionIndex: result.compactionIndex,
    compactionContent: result.compactionContent,
  };
}
