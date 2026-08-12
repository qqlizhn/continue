// Per-file concurrency lock to serialize edit operations on the same file,
// preventing race conditions when multiple tool calls modify the same file.
const locks = new Map<string, Promise<void>>();

export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Wait for any ongoing operation on this file
  const currentLock = locks.get(filePath);
  if (currentLock) {
    await currentLock;
  }

  // Create a new lock that resolves when this operation completes
  let resolveLock: () => void;
  const newLock = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  locks.set(filePath, newLock);

  try {
    return await fn();
  } finally {
    // Remove lock and resolve it to allow next operation
    locks.delete(filePath);
    resolveLock!();
  }
}
