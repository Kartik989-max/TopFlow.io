export interface RetryOptions {
  retries?: number;
  minTimeout?: number;
  maxTimeout?: number;
  factor?: number;
  jitter?: boolean;
  rejectOn?: (error: unknown) => boolean;
}

export function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    minTimeout = 100,
    maxTimeout = 5000,
    factor = 2,
    jitter = true,
    rejectOn,
  } = opts;

  return new Promise((resolve, reject) => {
    let attempt = 0;
    const attemptCall = () => {
      fn()
        .then(resolve)
        .catch((err: unknown) => {
          if (rejectOn && rejectOn(err)) {
            reject(err);
            return;
          }
          attempt++;
          if (attempt > retries) {
            reject(err);
            return;
          }
          let delay = minTimeout * Math.pow(factor, attempt - 1);
          delay = Math.min(delay, maxTimeout);
          if (jitter) delay = delay * (0.5 + Math.random() * 0.5);
          setTimeout(attemptCall, Math.round(delay));
        });
    };
    attemptCall();
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
