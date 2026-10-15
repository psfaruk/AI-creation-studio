// ============================================================
// Type-only shim for the 'bun:test' module — lets `tsc --noEmit`
// (which does not read Bun's runtime types) cover the test files.
// The shim declares exactly the API surface the Phase-1 suite
// uses; Bun's own runner ignores this file at execution time.
// No global declarations are introduced (app types untouched).
// ============================================================

declare module 'bun:test' {
  type TestFn = (() => void | Promise<void>) | ((done: (err?: Error) => void) => void);

  interface Matcher<T = unknown> {
    toBe(expected: T): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toBeNull(): void;
    toBeTruthy(): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toBeInstanceOf(constructor: new (...args: never[]) => unknown): void;
    /** REG-1g: rejection + error-message assertions */
    rejects: Matcher<T>;
    toThrow(expected?: string | RegExp | Error): void;
    not: Matcher<T>;
  }

  interface Expect extends Matcher {
    (value: unknown): Matcher;
  }

  interface MockFn {
    (...args: unknown[]): unknown;
  }

  interface MockModuleFn {
    (specifier: string, factory: () => unknown): void;
    module(specifier: string, factory: () => unknown): void;
    restore(): void;
  }

  interface MockApi {
    (...args: unknown[]): unknown;
    module(specifier: string, factory: () => unknown): void;
    restore(): void;
  }

  function describe(name: string, fn: () => void): void;
  function test(name: string, fn: TestFn, timeout?: number): void;
  function beforeEach(fn: () => void | Promise<void>): void;
  const it: typeof test;
  const expect: Expect;
  const mock: MockApi;
}
