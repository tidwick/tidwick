// jsdom lacks the layout observers the copied components position themselves with; a no-op stands in for them,
// since no test asserts on geometry. React is told it runs under a test so state updates flush inside `act`.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopObserver;

afterEach(() => {
  cleanup();
});
