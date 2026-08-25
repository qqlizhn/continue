import { resolveRelativePathInDir } from "core/util/ideUtils";
import { getCleanUriPath, getUriPathBasename } from "core/util/uri";
import { assertFileWasRead } from "./assertFileWasRead";
import { ClientToolImpl } from "./callClientTool";
import { withFileLock } from "./fileLock";

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

    // Direct write to file system via IDE - bypasses diff/apply pipeline
    // for atomic, reliable edits (same pattern as opencode CLI)
    // args.changes contains the full new file content from the LLM
    await extras.ideMessenger.ide.writeFile(firstUriMatch, args.changes);

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
