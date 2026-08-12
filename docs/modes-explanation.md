# Continue 工作模式详解

本文档详细解释 Continue 编辑器中的三种主要工作模式：Chat、Plan 和 Agent。每种模式针对不同的开发场景和需求设计。

## 三种核心模式

### 1. Chat 模式（聊天模式）

#### 功能定位
即时问答和信息获取模式，适合快速获取知识和解答疑问。

#### 技术实现
```typescript
// 对应 streamResponseThunk
void dispatch(streamResponseThunk({ editorState, modifiers, index }));
```

#### 主要特点
- **直接问答**：用户提问，AI直接回答
- **即时响应**：快速获取信息和答案
- **简单交互**：适合明确的、一次性的询问
- **对话历史**：基于上下文进行多轮对话

#### 典型使用场景
- 解释编程概念和技术
- 获取代码示例和用法
- 学习新框架和库
- 调试思路和建议

#### 示例
```text
"如何使用React Hooks？"
"解释一下TypeScript的泛型"
"给我一个Python排序算法的例子"
```

### 2. Plan 模式（规划模式）

#### 功能定位
复杂任务规划和执行模式，适合需要多步骤完成的开发任务。

#### 技术实现
```typescript
// 对应 background mode + createBackgroundAgent
void (async () => {
  await ideMessenger.request("createBackgroundAgent", {
    content,
    contextItems,
    selectedCode,
    organizationId,
  });
})();
```

#### 主要特点
- **任务分解**：将大任务分解为多个小步骤
- **异步执行**：在后台逐步完成复杂任务
- **进度跟踪**：可视化任务执行进度
- **错误恢复**：支持任务中断后的恢复

#### 典型使用场景
- 实现完整的功能模块
- 项目架构设计和实现
- 复杂的代码重构
- 多文件协同修改

#### 示例
```text
"帮我实现一个用户管理系统"
"创建一个完整的React组件"
"重构整个登录模块"
```

### 3. Agent 模式（代理模式）

#### 功能定位
代码编辑代理模式，适合直接修改现有代码。

#### 技术实现
```typescript
// 对应 edit mode + streamEditThunk
void dispatch(
  streamEditThunk({
    editorState,
    codeToEdit: codeToEditSnapshot,
  }),
);
```

#### 主要特点
- **精准编辑**：直接修改选中的代码片段
- **上下文保留**：保持代码的结构和格式
- **实时反馈**：立即看到代码变更效果
- **安全修改**：支持预览和确认修改

#### 典型使用场景
- 代码优化和重构
- 添加功能和特性
- 修复bug和错误处理
- 性能优化

#### 示例
```text
"把这个函数改成异步的"
"优化这段代码的性能"
"添加错误处理逻辑"
"重构这个类的结构"
```

## 模式切换逻辑

```typescript
// 根据当前模式决定处理方式
if (currentMode === "background" && !isCurrentlyInEdit) {
  // Plan模式：创建后台代理任务
} else if (isCurrentlyInEdit) {
  // Agent模式：代码编辑
} else {
  // Chat模式：普通聊天
}
```

## 模式选择指南

| 模式 | 适用场景 | 使用建议 |
|------|---------|---------|
| **Chat** | 获取信息、学习知识、简单问题 | 适合快速查询和学习 |
| **Plan** | 复杂任务、多步骤开发 | 适合大型功能开发 |
| **Agent** | 代码修改、重构、优化 | 适合精确的代码编辑 |

## 最佳实践

1. **从Chat开始**：先通过Chat模式了解概念和思路
2. **用Plan规划**：对于复杂任务，使用Plan模式制定执行计划
3. **用Agent实现**：通过Agent模式精确修改代码
4. **循环迭代**：根据结果反馈，循环使用不同模式优化结果

这种三模式设计提供了从知识获取到实际开发的完整工作流支持，让用户可以根据具体需求选择最适合的交互方式。

## 输入处理流程

### 1. 输入接收流程

```
┌─────────────────────────┐
│  用户在输入框输入       │
│  "/search React性能优化" │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│  ContinueInputBox.onEnter│
│  触发事件               │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│  Chat.sendInput函数      │
│  开始处理输入           │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│  resolveEditorContent    │
│  解析输入内容           │
└─────────────────────────┘
```

### 2. resolveEditorContent处理

`resolveEditorContent`函数负责将用户输入转换为AI模型可以理解的格式：

```typescript
export async function resolveEditorContent({
  editorState,
  modifiers,
  ideMessenger,
  defaultContextProviders,
  availableSlashCommands,
  dispatch,
  getState,
}: ResolveEditorContentInput): Promise<ResolveEditorContentOutput>
```

#### 处理步骤：
1. **解析编辑器内容**：使用`processEditorContent`提取基本元素
2. **处理斜杠命令**：使用`renderSlashCommandPrompt`处理特殊命令
3. **收集上下文**：通过`gatherContextItems`收集相关上下文
4. **返回标准化结果**：包含上下文项、选中代码、处理后的内容

### 3. 上下文收集机制

系统会主动调用IDE工具来收集必要的上下文信息：

#### 文件读取
```typescript
// core/protocol/ide.ts
export type ToIdeFromWebviewOrCoreProtocol = {
  // 读取文件内容
  readFile: [{ filepath: string }, string];
  
  // 获取当前文件
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
};
```

#### 代码选择
```typescript
// 获取选中代码范围和内容
const editorSelection = await ideMessenger.request("editor/getSelection", {
  filepath: "/path/to/file.ts"
});

const fileContents = await ideMessenger.request("readFile", {
  filepath: "/path/to/file.ts"
});
```

### 4. 斜杠命令处理

`renderSlashCommandPrompt`函数负责处理各种类型的斜杠命令：

#### 支持的命令类型
- `built-in-legacy`: 内置传统命令
- `mcp-prompt`: MCP提示命令
- `prompt-file-v1/v2`: 提示文件命令
- `built-in`: 内置命令
- `json-custom-command`: JSON自定义命令

#### 处理流程
```typescript
switch (command.source) {
  case "built-in-legacy":
    // 直接在消息前添加斜杠命令
    break;
  case "mcp-prompt":
    // 调用renderMcpPrompt处理
    break;
  case "prompt-file-v1":
    // 使用V1模板处理
    break;
  case "prompt-file-v2":
    // 使用V2模板处理
    break;
  case "built-in":
    // 使用内置提示模板
    break;
}
```

### 5. 后续处理流程

`resolveEditorContent`返回结果后，由`streamResponseThunk`继续处理：

```typescript
// 1. 收集符号信息
const filesForSymbols = [
  ...selectedContextItems
    .filter((item) => item.uri?.type === "file" && item?.uri?.value)
    .map((item) => item.uri!.value),
  ...selectedCode.map((rif) => rif.filepath),
];
void dispatch(updateFileSymbolsFromFiles(filesForSymbols));

// 2. 更新对话历史
dispatch(
  updateHistoryItemAtIndex({
    index: inputIndex,
    updates: {
      message: {
        role: "user",
        content,
        id: uuidv4(),
      },
      contextItems: selectedContextItems,
    },
  }),
);

// 3. 执行AI请求
unwrapResult(
  await dispatch(
    streamNormalInput({
      legacySlashCommandData: legacyCommandWithInput
        ? {
            command: legacyCommandWithInput.command,
            contextItems: selectedContextItems,
            historyIndex: inputIndex,
            input: legacyCommandWithInput.input,
            selectedCode,
          }
        : undefined,
    }),
  ),
);
```

### 6. 完整数据流

```
用户输入 → resolveEditorContent → streamResponseThunk → streamNormalInput
          ↓                      ↓                   ↓
      内容解析              状态更新           AI请求执行
      命令处理              上下文保存
      上下文收集            符号更新
```

这种设计模式确保了系统的可维护性和可扩展性，同时提供了良好的用户体验。