import { ILLM } from "../..";
import { countTokensAsync } from "../../llm/countTokens";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { BuiltInToolNames } from "../builtIn";

export async function throwIfFileExceedsHalfOfContext(
  filepath: string,
  content: string,
  model: ILLM | null,
  totalLines?: number,
) {
  if (model) {
    const tokens = await countTokensAsync(content, model.title);
    const tokenLimit = model.contextLength / 2;
    if (tokens > tokenLimit) {
      const rangeHint =
        totalLines !== undefined
          ? ` The file has ${totalLines} lines total. Use the \`${BuiltInToolNames.ReadFileRange}\` tool with \`startLine\` and \`endLine\` to read specific portions (e.g., startLine: 1, endLine: ${Math.min(200, totalLines)}).`
          : "";
      throw new ContinueError(
        ContinueErrorReason.FileTooLarge,
        `File ${filepath} is too large (${tokens} tokens vs ${tokenLimit} token limit).${rangeHint}`,
      );
    }
  }
}
