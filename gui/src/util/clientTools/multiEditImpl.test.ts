import { ContinueErrorReason } from "core/util/errors";
import * as ideUtils from "core/util/ideUtils";
import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { applyForEditTool } from "../../redux/thunks/handleApplyStateUpdate";
import { ClientToolExtras } from "./callClientTool";
import { multiEditImpl } from "./multiEditImpl";

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid"),
}));

vi.mock("core/util/ideUtils", () => ({
  resolveRelativePathInDir: vi.fn(),
}));

vi.mock("../../redux/thunks/handleApplyStateUpdate", () => ({
  applyForEditTool: vi.fn(),
}));

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
          output: [{ name: uri, content: "", description: "", uri: { type: "file", value: uri } }],
        },
      ],
    },
  ];
}

describe("multiEditImpl GUI specific", () => {
  let mockExtras: ClientToolExtras;
  let mockResolveRelativePathInDir: Mock;
  let mockApplyForEditTool: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockResolveRelativePathInDir = vi.mocked(ideUtils.resolveRelativePathInDir);
    mockApplyForEditTool = vi.mocked(applyForEditTool);

    mockExtras = {
      getState: vi.fn(() => ({
        config: { config: { allowAnonymousTelemetry: false } },
        session: {
          history: historyWithFileRead("file:///dir/test/file.txt"),
        },
      })) as any,
      dispatch: vi.fn() as any,
      ideMessenger: {
        ide: {
          readFile: vi.fn(),
          getWorkspaceDirs: vi.fn().mockResolvedValue(["dir1"]),
        },
        request: vi.fn(),
      } as any,
    };
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

  describe("GUI integration", () => {
    beforeEach(() => {
      mockResolveRelativePathInDir.mockResolvedValue(
        "file:///dir/test/file.txt",
      );
    });

    it("should read file from IDE and dispatch edit", async () => {
      mockExtras.ideMessenger.ide.readFile = vi
        .fn()
        .mockResolvedValue("Hello world");

      await multiEditImpl(
        {
          filepath: "file.txt",
          edits: [{ old_string: "Hello", new_string: "Hi" }],
        },
        "id",
        mockExtras,
      );

      expect(mockExtras.ideMessenger.ide.readFile).toHaveBeenCalledWith(
        "file:///dir/test/file.txt",
      );
      expect(mockApplyForEditTool).toHaveBeenCalledWith({
        streamId: "test-uuid",
        toolCallId: "id",
        text: "Hi world",
        filepath: "file:///dir/test/file.txt",
        isSearchAndReplace: true,
      });
    });

    it("should wrap IDE readFile errors", async () => {
      mockExtras.ideMessenger.ide.readFile = vi
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
      mockResolveRelativePathInDir.mockResolvedValue(
        "file:///dir/test/file.txt",
      );
      mockExtras.ideMessenger.ide.readFile = vi.fn().mockResolvedValue("test");

      const result = await multiEditImpl(
        {
          filepath: "file.txt",
          edits: [{ old_string: "test", new_string: "new" }],
        },
        "id",
        mockExtras,
      );

      expect(result).toEqual({
        respondImmediately: false,
        output: undefined,
      });
    });
  });
});
