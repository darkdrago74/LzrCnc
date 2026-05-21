import '@testing-library/jest-dom';

class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
}

window.ResizeObserver = ResizeObserver;
globalThis.ResizeObserver = ResizeObserver;

window.HTMLElement.prototype.scrollIntoView = function () { };
