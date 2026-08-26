import { expect, test } from "vitest";
import {
  DEFAULT_AUTO_COMPACT_CONTEXT_THRESHOLD,
  shouldAutoCompactConversation,
} from "./autoCompactConversation";

test("shouldAutoCompactConversation returns false when history is too short", () => {
  expect(
    shouldAutoCompactConversation({
      historyLength: 0,
      contextPercentage: 0.95,
    }),
  ).toBe(false);

  expect(
    shouldAutoCompactConversation({
      historyLength: 1,
      contextPercentage: 0.95,
    }),
  ).toBe(false);
});

test("shouldAutoCompactConversation returns false while compaction is already running", () => {
  expect(
    shouldAutoCompactConversation({
      historyLength: 4,
      contextPercentage: 0.99,
      isCompactionLoading: true,
    }),
  ).toBe(false);
});

test("shouldAutoCompactConversation returns true when session is pruned", () => {
  expect(
    shouldAutoCompactConversation({
      historyLength: 4,
      isPruned: true,
    }),
  ).toBe(true);
});

test("shouldAutoCompactConversation respects the default threshold", () => {
  expect(
    shouldAutoCompactConversation({
      historyLength: 4,
      contextPercentage: DEFAULT_AUTO_COMPACT_CONTEXT_THRESHOLD - 0.01,
    }),
  ).toBe(false);

  expect(
    shouldAutoCompactConversation({
      historyLength: 4,
      contextPercentage: DEFAULT_AUTO_COMPACT_CONTEXT_THRESHOLD,
    }),
  ).toBe(true);
});

test("shouldAutoCompactConversation uses a custom threshold when provided", () => {
  expect(
    shouldAutoCompactConversation({
      historyLength: 4,
      contextPercentage: 0.55,
      threshold: 0.5,
    }),
  ).toBe(true);
});
