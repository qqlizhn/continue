import { validateSingleEdit } from "core/edit/searchAndReplace/findAndReplaceUtils";
import { findSearchMatches } from "core/edit/searchAndReplace/findSearchMatch";
import { executeFindAndReplace } from "core/edit/searchAndReplace/performReplace";
import { validateSearchAndReplaceFilepath } from "core/edit/searchAndReplace/validateArgs";
import { getCleanUriPath, getUriPathBasename } from "core/util/uri";
import { assertFileWasRead } from "./assertFileWasRead";
import { ClientToolImpl } from "./callClientTool";
import { withFileLock } from "./fileLock";
import { offsetToPosition } from "./offsetToPosition";

export const singleFindAndReplaceImpl: ClientToolImpl = async (
  args,
  toolCallId,
  extras,
) => {
  const { oldString, newString, replaceAll } = validateSingleEdit(
    args.old_string,
    args.new_string,
    args.replace_all,
  );
  const fileUri = await validateSearchAndReplaceFilepath(
    args.filepath,
    extras.ideMessenger.ide,
  );

  return withFileLock(fileUri, async () => {
    assertFileWasRead(fileUri, extras.getState().session.history);

    if (extras.ideMessenger.ide.streamTextEdit) {
      // Use version-aware streaming text edit (Copilot-style).
      // Capture the snapshot + version atomically when available so the
      // version always corresponds to the content we compute positions from.
      let currentVersion: number | undefined;
      let editingFileContents: string;
      if (extras.ideMessenger.ide.readFileWithVersion) {
        const snapshot =
          await extras.ideMessenger.ide.readFileWithVersion(fileUri);
        editingFileContents = snapshot.contents;
        currentVersion = snapshot.version;
      } else {
        // Legacy two-step: capture the version, then read the content.
        currentVersion =
          typeof extras.ideMessenger.ide.getDocumentVersion === "function"
            ? await extras.ideMessenger.ide.getDocumentVersion(fileUri)
            : undefined;
        editingFileContents = await extras.ideMessenger.ide.readFile(fileUri);
      }

      // Find the match positions in the file
      const matches = findSearchMatches(editingFileContents, oldString);
      if (matches.length === 0) {
        throw new Error(
          `Edit failed: string not found in file: \`${oldString.slice(0, 50)}...\`,`,
        );
      }
      if (!replaceAll && matches.length > 1) {
        throw new Error(
          `Edit failed: \`${oldString.slice(0, 50)}...\` appears ${matches.length} times. Use replace_all=true to replace all occurrences.`,
        );
      }

      // Convert each match to a Range-based edit with version info
      const edits = (replaceAll ? matches : [matches[0]]).map((match) => {
        const start = offsetToPosition(editingFileContents, match.startIndex);
        const end = offsetToPosition(editingFileContents, match.endIndex);
        return {
          startLine: start.line,
          startCharacter: start.character,
          endLine: end.line,
          endCharacter: end.character,
          newText: newString,
          ...(typeof currentVersion === "number"
            ? { version: currentVersion }
            : {}),
        };
      });
      const applied = await extras.ideMessenger.ide.streamTextEdit(
        fileUri,
        edits,
      );
      if (!applied) {
        throw new Error(
          "Edit was rejected due to a document version conflict. " +
            "The file was modified while the edit was being computed. Please try again.",
        );
      }
    } else if (extras.ideMessenger.ide.applyEdit) {
      // Use WorkspaceEdit-based approach (preferred)
      // Handles unsaved changes, supports undo/redo, detects conflicts
      const editingFileContents =
        await extras.ideMessenger.ide.readFile(fileUri);

      // Find the match positions in the file
      const matches = findSearchMatches(editingFileContents, oldString);
      if (matches.length === 0) {
        throw new Error(
          `Edit failed: string not found in file: \`${oldString.slice(0, 50)}...\`,`,
        );
      }
      if (!replaceAll && matches.length > 1) {
        throw new Error(
          `Edit failed: \`${oldString.slice(0, 50)}...\` appears ${matches.length} times. Use replace_all=true to replace all occurrences.`,
        );
      }

      // Convert each match to a Range-based edit
      const edits = (replaceAll ? matches : [matches[0]]).map((match) => ({
        startLine: offsetToPosition(editingFileContents, match.startIndex).line,
        startCharacter: offsetToPosition(editingFileContents, match.startIndex)
          .character,
        endLine: offsetToPosition(editingFileContents, match.endIndex).line,
        endCharacter: offsetToPosition(editingFileContents, match.endIndex)
          .character,
        newText: newString,
      }));
      await extras.ideMessenger.ide.applyEdit!(fileUri, edits);
    } else {
      // Fallback: direct writeFile (legacy)
      const editingFileContents =
        await extras.ideMessenger.ide.readFile(fileUri);
      const newFileContents = executeFindAndReplace(
        editingFileContents,
        oldString,
        newString,
        replaceAll ?? false,
        0,
      );
      await extras.ideMessenger.ide.writeFile(fileUri, newFileContents);
    }

    return {
      respondImmediately: true,
      output: [
        {
          name: getUriPathBasename(fileUri),
          description: getCleanUriPath(fileUri),
          content: `Successfully edited ${fileUri}`,
          uri: {
            type: "file" as const,
            value: fileUri,
          },
        },
      ],
    };
  });
};
