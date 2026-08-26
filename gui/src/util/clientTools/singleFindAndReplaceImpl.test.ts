import { ContinueErrorReason } from "core/util/errors";
import * as ideUtils from "core/util/ideUtils";
import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { ClientToolExtras } from "./callClientTool";
import { singleFindAndReplaceImpl } from "./singleFindAndReplaceImpl";

vi.mock("core/util/ideUtils", () => ({
  resolveRelativePathInDir: vi.fn(),
}));

const FILE_URI = "/test/file.txt";

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
      config: {
        config: {
          allowAnonymousTelemetry: false,
        },
      },
      session: {
        history: historyWithFileRead(FILE_URI),
      },
    })) as any,
    dispatch: vi.fn() as any,
    ideMessenger: {
      ide: {
        readFile: vi.fn(),
        getWorkspaceDirs: vi.fn().mockResolvedValue(["/"]),
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

describe("singleFindAndReplaceImpl", () => {
  let mockExtras: ClientToolExtras;
  let mockResolveRelativePathInDir: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveRelativePathInDir = vi.mocked(ideUtils.resolveRelativePathInDir);
    mockExtras = makeMockExtras();
  });

  describe("argument validation", () => {
    beforeEach(() => {
      // Make the file resolvable so only validation errors are exercised.
      mockResolveRelativePathInDir.mockResolvedValue(FILE_URI);
      mockExtras.ideMessenger.ide.readFileWithVersion = vi
        .fn()
        .mockResolvedValue({ contents: "content", version: 1 });
    });

    it("should throw error if filepath is missing", async () => {
      const args = {
        old_string: "test",
        new_string: "replacement",
      };

      await expect(
        singleFindAndReplaceImpl(args, "tool-call-id", mockExtras),
      ).rejects.toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceMissingFilepath,
        }),
      );
    });

    it("should throw error if old_string is missing", async () => {
      const args = {
        filepath: "test.txt",
        new_string: "replacement",
      };

      await expect(
        singleFindAndReplaceImpl(args, "tool-call-id", mockExtras),
      ).rejects.toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceMissingOldString,
        }),
      );
    });

    it("should throw error if new_string is missing", async () => {
      const args = {
        filepath: "test.txt",
        old_string: "test",
      };

      await expect(
        singleFindAndReplaceImpl(args, "tool-call-id", mockExtras),
      ).rejects.toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceMissingNewString,
        }),
      );
    });

    it("should throw error if old_string and new_string are the same", async () => {
      const args = {
        filepath: "test.txt",
        old_string: "same",
        new_string: "same",
      };

      await expect(
        singleFindAndReplaceImpl(args, "tool-call-id", mockExtras),
      ).rejects.toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceIdenticalOldAndNewStrings,
        }),
      );
    });
  });

  describe("file resolution", () => {
    it("should throw error if file does not exist", async () => {
      mockResolveRelativePathInDir.mockResolvedValue(null);

      const args = {
        filepath: "nonexistent.txt",
        old_string: "test",
        new_string: "replacement",
      };

      await expect(
        singleFindAndReplaceImpl(args, "tool-call-id", mockExtras),
      ).rejects.toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FileNotFound,
        }),
      );
    });

    it("should resolve relative file paths and read snapshot + version", async () => {
      mockResolveRelativePathInDir.mockResolvedValue("/absolute/path/test.txt");
      mockExtras.getState = vi.fn(
        () =>
          ({
            config: { config: { allowAnonymousTelemetry: false } },
            session: {
              history: historyWithFileRead("/absolute/path/test.txt"),
            },
          }) as any,
      );
      mockExtras.ideMessenger.ide.readFileWithVersion = vi
        .fn()
        .mockResolvedValue({ contents: "test content", version: 2 });

      const args = {
        filepath: "test.txt",
        old_string: "test",
        new_string: "replacement",
      };

      await singleFindAndReplaceImpl(args, "tool-call-id", mockExtras);

      expect(mockResolveRelativePathInDir).toHaveBeenCalledWith(
        "test.txt",
        mockExtras.ideMessenger.ide,
      );
      expect(
        mockExtras.ideMessenger.ide.readFileWithVersion,
      ).toHaveBeenCalledWith("/absolute/path/test.txt");
      expect(mockExtras.ideMessenger.ide.streamTextEdit).toHaveBeenCalledWith(
        "/absolute/path/test.txt",
        [
          {
            startLine: 0,
            startCharacter: 0,
            endLine: 0,
            endCharacter: 4,
            newText: "replacement",
            version: 2,
          },
        ],
      );
    });
  });

  describe("string replacement", () => {
    beforeEach(() => {
      mockResolveRelativePathInDir.mockResolvedValue(FILE_URI);
      mockExtras.ideMessenger.ide.readFileWithVersion = vi
        .fn()
        .mockResolvedValue({
          contents: "Hello world\nThis is a test file\nGoodbye world",
          version: 5,
        });
    });

    it("should throw error if old_string is not found in file", async () => {
      mockExtras.ideMessenger.ide.readFileWithVersion = vi
        .fn()
        .mockResolvedValue({ contents: "different content", version: 6 });

      const args = {
        filepath: "file.txt",
        old_string: "not found",
        new_string: "replacement",
      };

      await expect(
        singleFindAndReplaceImpl(args, "tool-call-id", mockExtras),
      ).rejects.toThrow(
        "Edit failed: string not found in file: `not found...`,",
      );
    });

    it("should replace single occurrence with a version-aware edit", async () => {
      const args = {
        filepath: "file.txt",
        old_string: "Hello world",
        new_string: "Hi there",
      };

      await singleFindAndReplaceImpl(args, "tool-call-id", mockExtras);

      expect(mockExtras.ideMessenger.ide.streamTextEdit).toHaveBeenCalledWith(
        FILE_URI,
        [
          {
            startLine: 0,
            startCharacter: 0,
            endLine: 0,
            endCharacter: 11,
            newText: "Hi there",
            version: 5,
          },
        ],
      );
    });

    it("should throw error if old_string appears multiple times and replace_all is false", async () => {
      const args = {
        filepath: "file.txt",
        old_string: "world",
        new_string: "universe",
        replace_all: false,
      };

      await expect(
        singleFindAndReplaceImpl(args, "tool-call-id", mockExtras),
      ).rejects.toThrow(
        "Edit failed: `world...` appears 2 times. Use replace_all=true to replace all occurrences.",
      );
    });

    it("should replace all occurrences when replace_all is true", async () => {
      const args = {
        filepath: "file.txt",
        old_string: "world",
        new_string: "universe",
        replace_all: true,
      };

      await singleFindAndReplaceImpl(args, "tool-call-id", mockExtras);

      expect(mockExtras.ideMessenger.ide.streamTextEdit).toHaveBeenCalledWith(
        FILE_URI,
        expect.arrayContaining([
          expect.objectContaining({
            startLine: 0,
            startCharacter: 6,
            endLine: 0,
            endCharacter: 11,
            newText: "universe",
            version: 5,
          }),
          expect.objectContaining({
            startLine: 2,
            startCharacter: 8,
            endLine: 2,
            endCharacter: 13,
            newText: "universe",
            version: 5,
          }),
        ]),
      );
    });

    it("should handle empty new_string (deletion)", async () => {
      mockExtras.ideMessenger.ide.readFileWithVersion = vi
        .fn()
        .mockResolvedValue({
          contents: "Hello world\nThis is a test file",
          version: 1,
        });

      const args = {
        filepath: "file.txt",
        old_string: "Hello ",
        new_string: "",
      };

      await singleFindAndReplaceImpl(args, "tool-call-id", mockExtras);

      expect(mockExtras.ideMessenger.ide.streamTextEdit).toHaveBeenCalledWith(
        FILE_URI,
        [
          {
            startLine: 0,
            startCharacter: 0,
            endLine: 0,
            endCharacter: 6,
            newText: "",
            version: 1,
          },
        ],
      );
    });

    it("should handle special characters in strings", async () => {
      mockExtras.ideMessenger.ide.readFileWithVersion = vi
        .fn()
        .mockResolvedValue({
          contents: 'const regex = /[a-z]+/g;\nconst text = "Hello $world"',
          version: 1,
        });

      const args = {
        filepath: "file.txt",
        old_string: '"Hello $world"',
        new_string: '"Hi $universe"',
      };

      await singleFindAndReplaceImpl(args, "tool-call-id", mockExtras);

      expect(mockExtras.ideMessenger.ide.streamTextEdit).toHaveBeenCalledWith(
        FILE_URI,
        [
          {
            startLine: 1,
            startCharacter: 13,
            endLine: 1,
            endCharacter: 27,
            newText: '"Hi $universe"',
            version: 1,
          },
        ],
      );
    });

    it("should preserve whitespace and indentation", async () => {
      mockExtras.ideMessenger.ide.readFileWithVersion = vi
        .fn()
        .mockResolvedValue({
          contents:
            "function test() {\n    const value = 'old';\n    return value;\n}",
          version: 1,
        });

      const args = {
        filepath: "file.txt",
        old_string: "    const value = 'old';",
        new_string: "    const value = 'new';",
      };

      await singleFindAndReplaceImpl(args, "tool-call-id", mockExtras);

      expect(mockExtras.ideMessenger.ide.streamTextEdit).toHaveBeenCalledWith(
        FILE_URI,
        [
          {
            startLine: 1,
            startCharacter: 0,
            endLine: 1,
            endCharacter: 24,
            newText: "    const value = 'new';",
            version: 1,
          },
        ],
      );
    });

    it("should reject when the extension reports a version conflict", async () => {
      mockExtras.ideMessenger.ide.streamTextEdit = vi
        .fn()
        .mockResolvedValue(false);

      const args = {
        filepath: "file.txt",
        old_string: "Hello world",
        new_string: "Hi there",
      };

      await expect(
        singleFindAndReplaceImpl(args, "tool-call-id", mockExtras),
      ).rejects.toThrow(/version conflict/);
    });
  });

  describe("return value", () => {
    it("should return correct response structure", async () => {
      mockResolveRelativePathInDir.mockResolvedValue(FILE_URI);
      mockExtras.ideMessenger.ide.readFileWithVersion = vi
        .fn()
        .mockResolvedValue({ contents: "test content", version: 1 });

      const args = {
        filepath: "file.txt",
        old_string: "test",
        new_string: "replacement",
      };

      const result = await singleFindAndReplaceImpl(
        args,
        "tool-call-id",
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

  describe("error handling", () => {
    it("should wrap and rethrow errors from reading the file", async () => {
      mockResolveRelativePathInDir.mockResolvedValue(FILE_URI);
      mockExtras.ideMessenger.ide.readFileWithVersion = vi
        .fn()
        .mockRejectedValue(new Error("Permission denied"));

      const args = {
        filepath: "file.txt",
        old_string: "test",
        new_string: "replacement",
      };

      await expect(
        singleFindAndReplaceImpl(args, "tool-call-id", mockExtras),
      ).rejects.toThrow("Permission denied");
    });
  });
});
