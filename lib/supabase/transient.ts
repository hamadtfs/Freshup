export function isTransientUpstreamError(error: unknown): boolean {
  const message = String(
    (error as { message?: string })?.message || error || "",
  ).toLowerCase();
  return (
    message.includes("upstream connect error") ||
    message.includes("upstream request timeout") ||
    message.includes("connection termination") ||
    message.includes("gateway timeout") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("socket hang up") ||
    message.includes("timed out")
  );
}

export async function withTransientRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientUpstreamError(error) || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}
