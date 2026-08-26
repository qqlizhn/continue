import { ContinueErrorReason } from "core/util/errors";
import * as ideUtils from "core/util/ideUtils";
import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { ClientToolExtras } from "./callClientTool";
import { multiEditImpl } from "./multiEditImpl";

vi.mock("core/util/ideUtils", () => ({
  resolveRelativePathInDir: vi.fn(),
}));

const FILE_URI = "file:///dir/test/file.txt";

function historyWithFileRead(uri: string): any {
  return [
    {
      message: { role: "assistant", content: "" },
      contextItems: [],
      toolCallStates: [
        {
          toolCallId: "prior-read",
          toolCall: {
            id: "prior-read",
            type: "function",
            function: { name: "read_file", arguments: "{}" },
          },
          status: "done",
          parsedArgs: {},
          output: [
            {
              name: uri,
              content: "",
              description: "",
              uri: { type: "file", value: uri },
            },
          ],
        },
      ],
    },
  ];
}

function makeMockExtras(): ClientToolExtras {
  return {
    getState: vi.fn(() => ({
      config: { config: { allowAnonymousTelemetry: false } },
      session: { history: historyWithFileRead(FILE_URI) },
    })) as any,
    dispatch: vi.fn() as any,
    ideMessenger: {
      ide: {
        readFile: vi.fn(),
        getWorkspaceDirs: vi.fn().mockResolvedValue(["dir1"]),
        // Version-aware path (Copilot-style). In production, MessageIde
        // forwards these over the protocol to VS Code, which validates the
        // version and rejects stale edits.
        streamTextEdit: vi.fn().mockResolvedValue(true),
        readFileWithVersion: vi.fn(),
        // Legacy fallbacks for IDEs without version-aware editing.
        applyEdit: vi.fn().mockResolvedValue(true),
        writeFile: vi.fn(),
      } as any,
      request: vi.fn(),
    } as any,
  };
}

describe("multiEditImpl GUI specific", () => {
  let mockExtras: ClientToolExtras;
  let mockResolveRelativePathInDir: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtras = makeMockExtras();
    mockResolveRelativePathInDir = vi.mocked(ideUtils.resolveRelativePathInDir);
  });

  describe("filepath validation", () => {
    it("should throw if filepath is missing", async () => {
      await expect(
        multiEditImpl(
          { edits: [{ old_string: "old", new_string: "new" }] },
          "id",
          mockExtras,
        ),
      ).rejects.toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceMissingFilepath,
        }),
      );
    });

    it("should throw if file does not exist in workspace", async () => {
      mockResolveRelativePathInDir.mockResolvedValue(null);

      await expect(
        multiEditImpl(
          {
            filepath: "nonexistent.txt",
            edits: [{ old_string: "test", new_string: "new" }],
          },
          "id",
          mockExtras,
        ),
      ).rejects.toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FileNotFound,
        }),
      );
    });
  });

  describe("GUI integration (version-aware streamTextEdit)", () => {
    beforeEach(() => {
      mockResolveRelativePathInDir.mockResolvedValue(FILE_URI);
    });

    it("should read content + version atomically and apply via streamTextEdit", async () => {
      mockExtras.ideMessenger.ide.readFileWithVersion = vi
        .fn()
        .mockResolvedValue({ contents: "Hello world", version: 3 });

      await multiEditImpl(
        {
          filepath: "file.txt",
          edits: [{ old_string: "Hello", new_string: "Hi" }],
        },
        "id",
        mockExtras,
      );

      expect(mockExtras.ideMessenger.ide.streamTextEdit).toHaveBeenCalledWith(
        FILE_URI,
        [
          {
            startLine: 0,
            startCharacter: 0,
            endLine: 0,
            endCharacter: 5,
            newText: "Hi",
            version: 3,
          },
        ],
      );
    });

    it("should reject when the extension reports a version conflict", async () => {
      mockExtras.ideMessenger.ide.readFileWithVersion = vi
        .fn()
        .mockResolvedValue({ contents: "Hello world", version: 3 });
      mockExtras.ideMessenger.ide.streamTextEdit = vi
        .fn()
        .mockResolvedValue(false);

      await expect(
        multiEditImpl(
          {
            filepath: "file.txt",
            edits: [{ old_string: "Hello", new_string: "Hi" }],
          },
          "id",
          mockExtras,
        ),
      ).rejects.toThrow(/version conflict/);
    });

    it("should wrap IDE read errors", async () => {
      mockExtras.ideMessenger.ide.readFileWithVersion = vi
        .fn()
        .mockRejectedValue(new Error("Read failed"));

      await expect(
        multiEditImpl(
          {
            filepath: "file.txt",
            edits: [{ old_string: "test", new_string: "new" }],
          },
          "id",
          mockExtras,
        ),
      ).rejects.toThrow("Read failed");
    });
  });

  describe("return value", () => {
    it("should return structure for async completion", async () => {
      mockResolveRelativePathInDir.mockResolvedValue(FILE_URI);
      mockExtras.ideMessenger.ide.readFileWithVersion = vi
        .fn()
        .mockResolvedValue({ contents: "test", version: 2 });

      const result = await multiEditImpl(
        {
          filepath: "file.txt",
          edits: [{ old_string: "test", new_string: "new" }],
        },
        "id",
        mockExtras,
      );

      expect(result).toEqual({
        respondImmediately: true,
        output: [
          expect.objectContaining({
            name: "file.txt",
            uri: { type: "file", value: FILE_URI },
          }),
        ],
      });
    });
  });
});
