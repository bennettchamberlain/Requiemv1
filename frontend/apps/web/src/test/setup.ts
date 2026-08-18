// Extend Vitest's `expect` with jest-dom matchers via the `/matchers` subpath
// rather than the `/vitest` entrypoint: under Yarn PnP the latter does an
// undeclared `require('vitest')` that fails strict resolution. Extending
// manually is equivalent and portable (works the same in CI).
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';

import { initI18n } from '@/lib/i18n';

expect.extend(matchers);

// Components call `t()` during render. Initialising here (rather than wrapping
// every test in a provider) keeps `renderWithProviders` unchanged and makes
// assertions match the English copy users actually see.
initI18n();

// Unmount React trees between tests so queries don't leak across cases.
afterEach(() => {
  cleanup();
});

// jsdom does not implement matchMedia — needed by useDeviceLayout (@ci/common)
// and theme-aware components. Default everything to "does not match".
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated, kept for older consumers
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// jsdom lacks ResizeObserver / IntersectionObserver — required by Radix
// (ScrollArea in SearchBox), embla-carousel, and lazy media tiles.
class MockObserver {
  observe() {}

  unobserve() {}

  disconnect() {}

  takeRecords() {
    return [];
  }
}

vi.stubGlobal('ResizeObserver', MockObserver);
vi.stubGlobal('IntersectionObserver', MockObserver);

// jsdom does not implement element scroll APIs — Chat autoscroll
// (Chat.tsx / useConditionalAutoscroll.ts) calls scrollTo / scrollIntoView.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// ...nor window.scrollTo, which usePreventOverscroll calls on unmount. Assigned
// unconditionally, unlike the guarded stubs above: jsdom *does* define this one,
// it just throws "Not implemented" when called, so a presence check would skip
// the stub and leave the trace it exists to silence.
window.scrollTo = () => {};

// jsdom has no PointerEvent, so testing-library's fireEvent.pointerDown falls back to a bare
// Event that carries no `button` or `clientX` — which silently fails any handler that checks
// which button was pressed or where (the ForceGraph node drag). MouseEvent accepts the same
// init fields, so pointer events synthesised through it carry real coordinates.
if (!window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;

    isPrimary: boolean;

    pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }

  vi.stubGlobal('PointerEvent', PointerEventPolyfill);
}

// jsdom has PointerEvent (via the polyfill above) but no pointer-capture API on
// Element — Radix Select's item-selection handler calls `target.hasPointerCapture`
// unconditionally, so without this every click on an option throws
// "hasPointerCapture is not a function" and the select can never be driven in a
// test. Stubbed as a permanently-uncaptured pointer, which is enough for Radix's
// own logic (it only branches on release when capture is currently held).
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}

if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
