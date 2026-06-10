import assert from "node:assert/strict";
import test from "node:test";
import { clearStaleBodyPointerEventsLock } from "@/components/layout/pointer-events-guard-utils";

class FakeBody {
  style = { pointerEvents: "" };
  attributes = new Set<string>();

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}

function lockedBody() {
  const body = new FakeBody();
  body.style.pointerEvents = "none";
  body.attributes.add("aria-hidden");
  body.attributes.add("inert");
  body.attributes.add("data-scroll-locked");
  return body;
}

test("leaves a legitimate Radix body lock intact while an open dialog exists", () => {
  const body = lockedBody();
  const root = {
    querySelector(selector: string) {
      return selector === '[role="dialog"][data-state="open"]' ? {} : null;
    },
  };

  const cleared = clearStaleBodyPointerEventsLock({ body, root });

  assert.equal(cleared, false);
  assert.equal(body.style.pointerEvents, "none");
  assert.equal(body.attributes.has("aria-hidden"), true);
  assert.equal(body.attributes.has("inert"), true);
  assert.equal(body.attributes.has("data-scroll-locked"), true);
});

test("clears a stale body lock when no Radix layer is open", () => {
  const body = lockedBody();
  const root = {
    querySelector() {
      return null;
    },
  };

  const cleared = clearStaleBodyPointerEventsLock({ body, root });

  assert.equal(cleared, true);
  assert.equal(body.style.pointerEvents, "");
  assert.equal(body.attributes.has("aria-hidden"), false);
  assert.equal(body.attributes.has("inert"), false);
  assert.equal(body.attributes.has("data-scroll-locked"), false);
});

test("leaves unrelated pointer-events values untouched", () => {
  const body = lockedBody();
  body.style.pointerEvents = "auto";
  const root = {
    querySelector() {
      return null;
    },
  };

  const cleared = clearStaleBodyPointerEventsLock({ body, root });

  assert.equal(cleared, false);
  assert.equal(body.style.pointerEvents, "auto");
  assert.equal(body.attributes.has("aria-hidden"), true);
  assert.equal(body.attributes.has("inert"), true);
  assert.equal(body.attributes.has("data-scroll-locked"), true);
});
