import type {
  DocumentSymbol,
  FileStatsMap,
  FileType,
  IDE,
  IdeInfo,
  IdeSettings,
  IndexTag,
  Location,
  Problem,
  Range,
  RangeInFile,
  SignatureHelp,
  TerminalOptions,
  Thread,
} from "../";
import { ControlPlaneSessionInfo } from "../control-plane/AuthTypes";

export interface GetGhTokenArgs {
  force?: boolean;
}

export type ToIdeFromWebviewOrCoreProtocol = {
  // Methods from IDE type
  getIdeInfo: [undefined, IdeInfo];
  getWorkspaceDirs: [undefined, string[]];
  writeFile: [{ path: string; contents: string }, void];
  applyEdit: [
    {
      filepath: string;
      edits: Array<{
        startLine: number;
        startCharacter: number;
        endLine: number;
        endCharacter: number;
        newText: string;
      }>;
    },
    boolean,
  ];
  // Get the current version of an open document in the editor.
  // Returns undefined if the document is not open. Used for
  // version-aware editing (Copilot-style) to prevent stale edits.
  getDocumentVersion: [{ filepath: string }, number | undefined];
  // Atomically read a document's contents together with its version.
  // Binding snapshot and version in one call removes the race between
  // reading content and capturing the version, matching Copilot's
  // editor-state-stream binding.
  readFileWithVersion: [
    { filepath: string },
    { contents: string; version?: number },
  ];
  // Version-aware streaming text edit (Copilot-style)
  // Each edit carries the document version it was computed against.
  // VS Code natively rejects stale edits when versions don't match,
  // preventing buffer/disk desync from race conditions.
  streamTextEdit: [
    {
      filepath: string;
      edits: Array<{
        startLine: number;
        startCharacter: number;
        endLine: number;
        endCharacter: number;
        newText: string;
        version?: number; // The document version this edit was computed against
      }>;
      isWholeFile?: boolean; // If true, use a full-document replacement with version check
    },
    boolean,
  ];
  removeFile: [{ path: string }, void];
  showVirtualFile: [{ name: string; content: string }, void];
  openFile: [{ path: string }, void];
  openUrl: [string, void];
  runCommand: [{ command: string; options?: TerminalOptions }, void];
  getSearchResults: [{ query: string; maxResults?: number }, string];
  getFileResults: [{ pattern: string; maxResults?: number }, string[]];
  subprocess: [{ command: string; cwd?: string }, [string, string]];
  saveFile: [{ filepath: string }, void];
  fileExists: [{ filepath: string }, boolean];
  readFile: [{ filepath: string }, string];
  getProblems: [{ filepath: string }, Problem[]];
  getOpenFiles: [undefined, string[]];
  getCurrentFile: [
    undefined,
    (
      | undefined
      | {
          isUntitled: boolean;
          path: string;
          contents: string;
        }
    ),
  ];
  getPinnedFiles: [undefined, string[]];
  showLines: [{ filepath: string; startLine: number; endLine: number }, void];
  readRangeInFile: [{ filepath: string; range: Range }, string];
  getDiff: [{ includeUnstaged: boolean }, string[]];
  getTerminalContents: [undefined, string];
  getDebugLocals: [{ threadIndex: number }, string];
  getTopLevelCallStackSources: [
    { threadIndex: number; stackDepth: number },
    string[],
  ];
  getAvailableThreads: [undefined, Thread[]];
  isTelemetryEnabled: [undefined, boolean];
  isWorkspaceRemote: [undefined, boolean];
  getUniqueId: [undefined, string];
  getTags: [string, IndexTag[]];
  readSecrets: [{ keys: string[] }, Record<string, string>];
  writeSecrets: [{ secrets: Record<string, string> }, void];
  // end methods from IDE type

  getIdeSettings: [undefined, IdeSettings];

  // Git
  getBranch: [{ dir: string }, string];
  getRepoName: [{ dir: string }, string | undefined];

  showToast: [
    Parameters<IDE["showToast"]>,
    Awaited<ReturnType<IDE["showToast"]>>,
  ];
  getGitRootPath: [{ dir: string }, string | undefined];
  listDir: [{ dir: string }, [string, FileType][]];
  getFileStats: [{ files: string[] }, FileStatsMap];

  gotoDefinition: [{ location: Location }, RangeInFile[]];
  gotoTypeDefinition: [{ location: Location }, RangeInFile[]];
  getSignatureHelp: [{ location: Location }, SignatureHelp | null];
  getReferences: [{ location: Location }, RangeInFile[]];
  getDocumentSymbols: [{ textDocumentIdentifier: string }, DocumentSymbol[]];

  getControlPlaneSessionInfo: [
    { silent: boolean; useOnboarding: boolean },
    ControlPlaneSessionInfo | undefined,
  ];
  logoutOfControlPlane: [undefined, void];
  reportError: [any, void];
  closeSidebar: [undefined, void];
};

export type ToWebviewOrCoreFromIdeProtocol = {
  didChangeActiveTextEditor: [{ filepath: string }, void];
};
