import { resolveRelativePathInDir } from "core/util/ideUtils";
import { getCleanUriPath, getUriPathBasename } from "core/util/uri";
import { assertFileWasRead } from "./assertFileWasRead";
import { ClientToolImpl } from "./callClientTool";
import { withFileLock } from "./fileLock";
import { offsetToPosition } from "./offsetToPosition";

export const editToolImpl: ClientToolImpl = async (
  args,
  toolCallId,
  extras,
) => {
  if (!args.filepath || !args.changes) {
    throw new Error(
      "`filepath` and `changes` arguments are required to edit an existing file.",
    );
  }
  let filepath = args.filepath;
  if (filepath.startsWith("./")) {
    filepath = filepath.slice(2);
  }

  let firstUriMatch = await resolveRelativePathInDir(
    filepath,
    extras.ideMessenger.ide,
  );

  if (!firstUriMatch) {
    const openFiles = await extras.ideMessenger.ide.getOpenFiles();
    for (const uri of openFiles) {
      if (uri.endsWith(filepath)) {
        firstUriMatch = uri;
        break;
      }
    }
  }

  if (!firstUriMatch) {
    throw new Error(`${filepath} does not exist`);
  }

  return withFileLock(firstUriMatch, async () => {
    assertFileWasRead(firstUriMatch, extras.getState().session.history);

    // Version-aware whole-file replacement (Copilot-style).
    // args.changes contains the full new file content from the LLM.
    // Capture the snapshot + version atomically when available, then let the
    // extension replace the whole document through the editor buffer with a
    // version check. Stale edits are rejected, so the buffer and disk never
    // drift apart (avoids the "file modified on disk" / save-error conflict).
    const ide = extras.ideMessenger.ide;
    if (ide.streamTextEdit) {
      let version: number | undefined;
      let contents: string | undefined;
      if (ide.readFileWithVersion) {
        const snapshot = await ide.readFileWithVersion(firstUriMatch);
        contents = snapshot.contents;
        version = snapshot.version;
      } else if (typeof ide.getDocumentVersion === "function") {
        version = await ide.getDocumentVersion(firstUriMatch);
        contents = await ide.readFile(firstUriMatch);
      }

      // Build a single edit spanning the whole document. The extension ignores
      // positions for isWholeFile and replaces the full current buffer, so the
      // end position here only needs to be valid syntax (computed from the
      // snapshot for clarity).
      const endPosition = contents
        ? offsetToPosition(contents, contents.length)
        : { line: 0, character: 0 };

      const applied = await ide.streamTextEdit(
        firstUriMatch,
        [
          {
            startLine: 0,
            startCharacter: 0,
            endLine: endPosition.line,
            endCharacter: endPosition.character,
            newText: args.changes,
            ...(typeof version === "number" ? { version } : {}),
          },
        ],
        true, // isWholeFile: replace the entire document
      );
      if (!applied) {
        throw new Error(
          "Edit was rejected due to a document version conflict. " +
            "The file was modified after its content was read. Please try again.",
        );
      }
    } else {
      // Fallback: direct write to file system via IDE.
      // args.changes contains the full new file content from the LLM.
      await ide.writeFile(firstUriMatch, args.changes);
    }

    return {
      respondImmediately: true,
      output: [
        {
          name: getUriPathBasename(firstUriMatch),
          description: getCleanUriPath(firstUriMatch),
          content: `Successfully edited ${firstUriMatch}`,
          uri: {
            type: "file" as const,
            value: firstUriMatch,
          },
        },
      ],
    };
  });
};
