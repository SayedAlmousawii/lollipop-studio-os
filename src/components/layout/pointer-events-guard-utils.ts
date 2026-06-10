type BodyLockTarget = {
  style: {
    pointerEvents: string;
  };
  removeAttribute(name: string): void;
};

type QueryTarget = {
  querySelector(selector: string): unknown;
};

export const OPEN_RADIX_LAYER_SELECTORS = [
  '[role="dialog"][data-state="open"]',
  '[data-radix-menu-content][data-state="open"]',
  '[data-radix-dropdown-menu-content][data-state="open"]',
  '[data-radix-popper-content-wrapper][data-state="open"]',
  '[data-radix-popper-content-wrapper] [data-state="open"]',
  '[data-radix-popper-content-wrapper]:has([data-state="open"])',
] as const;

export function hasOpenRadixLayer(root: QueryTarget): boolean {
  return OPEN_RADIX_LAYER_SELECTORS.some((selector) => {
    try {
      return Boolean(root.querySelector(selector));
    } catch {
      return false;
    }
  });
}

export function clearStaleBodyPointerEventsLock(options?: {
  body?: BodyLockTarget;
  root?: QueryTarget;
}): boolean {
  if (typeof document === "undefined" && !options?.body) {
    return false;
  }

  const body = options?.body ?? document.body;
  const root = options?.root ?? document;

  if (hasOpenRadixLayer(root)) {
    return false;
  }

  if (body.style.pointerEvents !== "none") {
    return false;
  }

  body.style.pointerEvents = "";
  body.removeAttribute("aria-hidden");
  body.removeAttribute("inert");
  body.removeAttribute("data-scroll-locked");

  return true;
}
