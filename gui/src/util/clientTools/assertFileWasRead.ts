import { BuiltInToolNames } from "core/tools/builtIn";
import { ContinueError, ContinueErrorReason } from "core/util/errors";
import { ChatHistoryItemWithMessageId } from "../../redux/slices/sessionSlice";

// Tools whose successful output proves the model has seen the file's contents.
const FILE_CONTENT_KNOWN_TOOL_NAMES = new Set<string>([
  BuiltInToolNames.ReadFile,
  BuiltInToolNames.ReadFileRange,
  BuiltInToolNames.ReadCurrentlyOpenFile,
  BuiltInToolNames.CreateNewFile,
  BuiltInToolNames.EditExistingFile,
  BuiltInToolNames.SingleFindAndReplace,
  BuiltInToolNames.MultiEdit,
]);

/**
 * Mirrors openclaude's `readFileState` guard: edit tools require the model to
 * have already seen the file's contents (via a read, create, or prior edit)
 * earlier in this conversation, identified by matching resolved file URI.
 */
export function assertFileWasRead(
  fileUri: string,
  history: ChatHistoryItemWithMessageId[],
): void {
  for (const item of history) {
    for (const toolCallState of item.toolCallStates ?? []) {
      if (
        toolCallState.status !== "done" ||
        !FILE_CONTENT_KNOWN_TOOL_NAMES.has(toolCallState.toolCall.function.name)
      ) {
        continue;
      }
      const wasThisFile = toolCallState.output?.some(
        (contextItem) =>
          contextItem.uri?.type === "file" && contextItem.uri.value === fileUri,
      );
      if (wasThisFile) {
        return;
      }
    }
  }

  throw new ContinueError(
    ContinueErrorReason.EditToolFileNotRead,
    `You must read the file before editing it. Use the ${BuiltInToolNames.ReadFile} tool to view its current contents, then try the edit again.`,
  );
}
