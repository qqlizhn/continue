/**
 * Convert a character offset in a string to { line, character } position.
 * Both are 0-based, matching VS Code's Position semantics.
 */
export function offsetToPosition(
  text: string,
  offset: number,
): { line: number; character: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  const lastNewline = before.lastIndexOf("\n");
  const character = lastNewline === -1 ? offset : offset - lastNewline - 1;
  return { line, character };
}
