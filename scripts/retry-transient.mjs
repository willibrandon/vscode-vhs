export async function retryTransient(operation, options = {}) {
  const attempts = options.attempts ?? 3;
  const delayForAttempt = options.delayForAttempt ?? ((attempt) => attempt * 5_000);
  const isRetryable = options.isRetryable ?? (() => true);
  const onRetry = options.onRetry ?? (() => undefined);
  const wait = options.wait ?? delay;
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new TypeError("Retry attempts must be a positive integer.");
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= attempts || !isRetryable(error)) throw error;
      const delayMilliseconds = delayForAttempt(attempt);
      onRetry({ attempt, delayMilliseconds, error });
      await wait(delayMilliseconds);
    }
  }
}

export function isTransientExtensionServiceError(error) {
  const details = errorDetails(error);
  return /(?:server returned (?:429|5\d\d)|eai_again|econnreset|econnrefused|enetunreach|etimedout|socket hang up)/iu.test(
    details,
  );
}

function errorDetails(error) {
  if (typeof error !== "object" || error === null) return String(error);
  return ["message", "stdout", "stderr"]
    .filter((name) => name in error)
    .map((name) => String(error[name]))
    .join("\n");
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => globalThis.setTimeout(resolvePromise, milliseconds));
}
