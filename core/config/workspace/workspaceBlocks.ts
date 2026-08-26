import {
  BlockType,
  ConfigYaml,
  createPromptMarkdown,
  createRuleMarkdown,
  sanitizeRuleName,
} from "@continuedev/config-yaml";
import * as YAML from "yaml";
import { IDE } from "../..";
import { getContinueGlobalPath } from "../../util/paths";
import { localPathToUri } from "../../util/pathToUri";
import { joinPathsToUri } from "../../util/uri";

const BLOCK_TYPE_CONFIG: Record<
  BlockType,
  { singular: string; filename: string }
> = {
  context: { singular: "context", filename: "context" },
  models: { singular: "model", filename: "model" },
  rules: { singular: "rule", filename: "rule" },
  docs: { singular: "doc", filename: "doc" },
  prompts: { singular: "prompt", filename: "prompt" },
  mcpServers: { singular: "MCP server", filename: "mcp-server" },
  data: { singular: "data", filename: "data" },
};

function getContentsForNewBlock(blockType: BlockType): ConfigYaml {
  const configYaml: ConfigYaml = {
    name: `New ${BLOCK_TYPE_CONFIG[blockType]?.singular}`,
    version: "0.0.1",
    schema: "v1",
  };
  switch (blockType) {
    case "context":
      configYaml.context = [
        {
          provider: "file",
        },
      ];
      break;
    case "models":
      configYaml.models = [
        {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          apiKey: "${{ secrets.ANTHROPIC_API_KEY }}",
          name: "Claude Sonnet 4.6",
          roles: ["chat", "edit"],
        },
      ];
      break;
    case "rules":
      configYaml.rules = ["Always give concise responses"];
      break;
    case "docs":
      configYaml.docs = [
        {
          name: "New docs",
          startUrl: "https://docs.continue.dev",
        },
      ];
      break;
    case "prompts":
      configYaml.prompts = [
        {
          name: "New prompt",
          description: "New prompt",
          prompt:
            "Please write a thorough suite of unit tests for this code, making sure to cover all relevant edge cases",
        },
      ];
      break;
    case "mcpServers":
      configYaml.mcpServers = [
        {
          name: "New MCP server",
          command: "npx",
          args: ["-y", "<your-mcp-server>"],
          env: {},
        },
      ];
      break;
  }

  return configYaml;
}

function getFileExtension(blockType: BlockType): string {
  if (blockType === "rules" || blockType === "prompts") {
    return "md";
  }
  return "yaml";
}

export function getFileContent(blockType: BlockType): string {
  if (blockType === "rules") {
    return createRuleMarkdown("New Rule", "Your rule content", {
      description: "A description of your rule",
    });
  } else if (blockType === "prompts") {
    return createPromptMarkdown(
      "New prompt",
      "Please write a thorough suite of unit tests for this code, making sure to cover all relevant edge cases",
      {
        description: "New prompt",
        invokable: true,
      },
    );
  } else {
    return YAML.stringify(getContentsForNewBlock(blockType));
  }
}

export async function findAvailableFilename(
  baseDirUri: string,
  blockType: BlockType,
  fileExists: (uri: string) => Promise<boolean>,
  extension?: string,
  isGlobal?: boolean,
  baseFilenameOverride?: string,
): Promise<string> {
  const fileExtension = extension ?? getFileExtension(blockType);
  let baseFilename = "";

  const trimmedOverride = baseFilenameOverride?.trim();
  if (trimmedOverride) {
    if (blockType === "rules") {
      const withoutExtension = trimmedOverride.replace(/\.[^./\\]+$/, "");
      const sanitized = sanitizeRuleName(withoutExtension);
      baseFilename = sanitized;
    } else {
      baseFilename = trimmedOverride;
    }
  }
  if (!baseFilename) {
    baseFilename =
      blockType === "rules" && isGlobal
        ? "global-rule"
        : `new-${BLOCK_TYPE_CONFIG[blockType]?.filename}`;
  }

  let counter = 0;
  let fileUri: string;

  do {
    const suffix = counter === 0 ? "" : `-${counter}`;
    fileUri = joinPathsToUri(
      baseDirUri,
      `${baseFilename}${suffix}.${fileExtension}`,
    );
    counter++;
  } while (await fileExists(fileUri));

  return fileUri;
}

export async function createNewWorkspaceBlockFile(
  ide: IDE,
  blockType: BlockType,
  baseFilename?: string,
): Promise<void> {
  const workspaceDirs = await ide.getWorkspaceDirs();
  if (workspaceDirs.length === 0) {
    throw new Error(
      "No workspace directories found. Make sure you've opened a folder in your IDE.",
    );
  }

  const baseDirUri = joinPathsToUri(workspaceDirs[0], `.continue/${blockType}`);

  const fileUri = await findAvailableFilename(
    baseDirUri,
    blockType,
    ide.fileExists.bind(ide),
    undefined,
    false,
    baseFilename,
  );

  const fileContent = getFileContent(blockType);

  await writeFilePreferringApplyEdit(ide, fileUri, fileContent);
}

export async function createNewGlobalRuleFile(
  ide: IDE,
  baseFilename?: string,
): Promise<void> {
  try {
    const globalDir = localPathToUri(getContinueGlobalPath());

    // Create the rules subdirectory within the global directory
    const rulesDir = joinPathsToUri(globalDir, "rules");

    const fileUri = await findAvailableFilename(
      rulesDir,
      "rules",
      ide.fileExists.bind(ide),
      undefined,
      true, // isGlobal = true for global rules
      baseFilename,
    );

    const fileContent = getFileContent("rules");

    await writeFilePreferringApplyEdit(ide, fileUri, fileContent);
  } catch (error) {
    throw error;
  }
}

/**
 * Write file contents to disk, preferring the IDE's applyEdit API when
 * available. This avoids VSCode's "unsaved changes" conflict that occurs
 * when writeFile writes to disk but the editor buffer is not synchronized.
 */
async function writeFilePreferringApplyEdit(
  ide: IDE,
  fileUri: string,
  contents: string,
): Promise<void> {
  // New files can be written directly - no editor buffer conflict possible
  if (!(await ide.fileExists(fileUri))) {
    await ide.writeFile(fileUri, contents);
    return;
  }

  // The file already exists on disk (e.g. a race condition where the file
  // was created between findAvailableFilename and writeFile, or an override
  // that targets an existing file). Prefer applyEdit to keep the editor
  // buffer in sync, then fall back to writeFile if applyEdit is unavailable.
  if (ide.applyEdit) {
    const originalContents = await ide.readFile(fileUri);
    const fullRange = getFullDocumentRange(originalContents);

    const applied = await ide.applyEdit(fileUri, [
      {
        startLine: fullRange.startLine,
        startCharacter: fullRange.startCharacter,
        endLine: fullRange.endLine,
        endCharacter: fullRange.endCharacter,
        newText: contents,
      },
    ]);

    if (applied) {
      return;
    }
  }

  await ide.writeFile(fileUri, contents);
}

/**
 * Computes a range covering the entire document, replicating the logic
 * used by VSCode's ApplyManager for full-document replacements.
 */
function getFullDocumentRange(contents: string): {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
} {
  if (!contents) {
    return { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 };
  }

  const lines = contents.split(/\r?\n/);
  return {
    startLine: 0,
    startCharacter: 0,
    endLine: Math.max(lines.length - 1, 0),
    endCharacter: lines[lines.length - 1]?.length ?? 0,
  };
}
