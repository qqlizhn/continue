import { findSearchMatches } from "core/edit/searchAndReplace/findSearchMatch";
import { validateMultiEdit } from "core/edit/searchAndReplace/multiEditValidation";
import { executeMultiFindAndReplace } from "core/edit/searchAndReplace/performReplace";
import { validateSearchAndReplaceFilepath } from "core/edit/searchAndReplace/validateArgs";
import { getCleanUriPath, getUriPathBasename } from "core/util/uri";
import { assertFileWasRead } from "./assertFileWasRead";
import { ClientToolImpl } from "./callClientTool";
import { withFileLock } from "./fileLock";
import { offsetToPosition } from "./offsetToPosition";

async function applyEditsViaWorkspaceEdit(
  fileUri: string,
  fileContents: string,
  edits: Array<{
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  }>,
  applyEdit: (
    fileUri: string,
    edits: Array<{
      startLine: number;
      startCharacter: number;
      endLine: number;
      endCharacter: number;
      newText: string;
    }>,
  ) => Promise<boolean>,
  streamTextEdit?: (
    fileUri: string,
    edits: Array<{
      startLine: number;
      startCharacter: number;
      endLine: number;
      endCharacter: number;
      newText: string;
      version?: number;
    }>,
  ) => Promise<boolean>,
  currentVersion?: number,
): Promise<void> {
  // For each edit, find the (start, end) character positions in the file.
  // IMPORTANT: We must track positions relative to the ORIGINAL file content,
  // because VS Code's WorkspaceEdit expects positions based on the document
  // state at the time all edits are applied together. So we track an offsetDelta
  // that converts from currentContent positions back to original positions.
  const replacementRanges: Array<{
    start: { line: number; character: number };
    end: { line: number; character: number };
    newText: string;
  }> = [];

  let currentContent = fileContents;
  let offsetDelta = 0; // Difference between currentContent positions and original positions

  for (const edit of edits) {
    const matches = findSearchMatches(currentContent, edit.old_string);
    if (matches.length === 0) {
      throw new Error(
        `Edit failed: string not found in file: \`${edit.old_string.slice(0, 50)}...\`,`,
      );
    }
    if (!edit.replace_all && matches.length > 1) {
      throw new Error(
        `Edit failed: \`${edit.old_string.slice(0, 50)}...\` appears ${matches.length} times. Use replace_all=true to replace all occurrences.`,
      );
    }

    // Apply replacements in reverse order to maintain correct positions
    const replacements = edit.replace_all ? matches : [matches[0]];
    for (let i = replacements.length - 1; i >= 0; i--) {
      const match = replacements[i];
      // Convert positions from currentContent space to original fileContents space
      const startPos = offsetToPosition(
        fileContents,
        match.startIndex + offsetDelta,
      );
      const endPos = offsetToPosition(
        fileContents,
        match.endIndex + offsetDelta,
      );
      replacementRanges.push({
        start: startPos,
        end: endPos,
        newText: edit.new_string,
      });
    }

    // Compute the pre-edit content length to track offset changes
    const beforeContentLen = currentContent.length;
    currentContent = executeMultiFindAndReplace(currentContent, [edit]);
    const afterContentLen = currentContent.length;
    offsetDelta += afterContentLen - beforeContentLen;
  }

  // If streamTextEdit is available (version-aware), use it.
  // This ensures the document version is validated before edits are applied,
  // preventing stale-position race conditions like Copilot does.
  if (streamTextEdit) {
    const editsWithVersion = replacementRanges.map((r) => ({
      startLine: r.start.line,
      startCharacter: r.start.character,
      endLine: r.end.line,
      endCharacter: r.end.character,
      newText: r.newText,
      // Pass the version we captured when reading the file.
      // The extension will reject if the document changed since then.
      ...(typeof currentVersion === "number"
        ? { version: currentVersion }
        : {}),
    }));
    const applied = await streamTextEdit(fileUri, editsWithVersion);
    if (!applied) {
      throw new Error(
        "Edit was rejected due to a document version conflict. " +
          "The file was modified while the edit was being computed. Please try again.",
      );
    }
    return;
  }

  // Fallback: submit all edits as a single WorkspaceEdit for atomic application
  await applyEdit(
    fileUri,
    replacementRanges.map((r) => ({
      startLine: r.start.line,
      startCharacter: r.start.character,
      endLine: r.end.line,
      endCharacter: r.end.character,
      newText: r.newText,
    })),
  );
}

export const multiEditImpl: ClientToolImpl = async (
  args,
  toolCallId,
  extras,
) => {
  const { edits } = validateMultiEdit(args);
  const fileUri = await validateSearchAndReplaceFilepath(
    args.filepath,
    extras.ideMessenger.ide,
  );

  return withFileLock(fileUri, async () => {
    assertFileWasRead(fileUri, extras.getState().session.history);

    if (extras.ideMessenger.ide.streamTextEdit) {
      // Use version-aware streamTextEdit approach (Copilot-style)
      // Version validation prevents stale-position race conditions

      // Capture the snapshot together with its version atomically so the
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

      await applyEditsViaWorkspaceEdit(
        fileUri,
        editingFileContents,
        edits,
        extras.ideMessenger.ide.applyEdit!.bind(extras.ideMessenger.ide),
        extras.ideMessenger.ide.streamTextEdit.bind(extras.ideMessenger.ide),
        currentVersion,
      );
    } else if (extras.ideMessenger.ide.applyEdit) {
      // Use WorkspaceEdit-based approach (preferred)
      // Handles unsaved changes, supports undo/redo, detects conflicts
      const editingFileContents =
        await extras.ideMessenger.ide.readFile(fileUri);
      await applyEditsViaWorkspaceEdit(
        fileUri,
        editingFileContents,
        edits,
        extras.ideMessenger.ide.applyEdit.bind(extras.ideMessenger.ide),
      );
    } else {
      // Fallback: direct writeFile (legacy)
      const editingFileContents =
        await extras.ideMessenger.ide.readFile(fileUri);
      const newFileContents = executeMultiFindAndReplace(
        editingFileContents,
        edits,
      );
      await extras.ideMessenger.ide.writeFile(fileUri, newFileContents);
    }

    return {
      respondImmediately: true,
      output: [
        {
          name: getUriPathBasename(fileUri),
          description: getCleanUriPath(fileUri),
          content: `Successfully edited ${fileUri} with ${edits.length} edit${edits.length === 1 ? "" : "s"}`,
          uri: {
            type: "file" as const,
            value: fileUri,
          },
        },
      ],
    };
  });
};
