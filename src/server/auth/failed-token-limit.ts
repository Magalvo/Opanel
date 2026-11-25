// Red step stub (WS-125): the shapes only, no behaviour yet.

export type FailedTokenDecision =
  | { allowed: true; key: string; succeeded: () => void }
  | { allowed: false; key: string; retryAfterSeconds: number; firstRefusal: boolean };

export interface FailedTokenLimiter {
  begin(key: string): FailedTokenDecision;
  sweep(): void;
  size(): number;
  keys(): string[];
}

export function createFailedTokenLimiter(
  _options: { limit?: number; windowMs?: number; maxKeys?: number; now?: () => number } = {},
): FailedTokenLimiter {
  return {
    begin: (key) => ({ allowed: true, key, succeeded: () => undefined }),
    sweep: () => undefined,
    size: () => 0,
    keys: () => [],
  };
}

export function failedTokenKey(_request: Request, _headerName: string | undefined): string | null {
  return null;
}

export function getFailedTokenLimiter(): FailedTokenLimiter {
  return createFailedTokenLimiter();
}
