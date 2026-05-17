import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { CurrentCompositionCard } from "@/components/orders/current-composition-card";
import type { CompositionView } from "@/modules/composition-view/composition-view.model";

test("CurrentCompositionCard renders locked mode header and rows", () => {
  const markup = renderToStaticMarkup(
    createElement(CurrentCompositionCard, {
      view: viewFixture("locked"),
    })
  );

  assert.match(markup, /Current Composition/);
  assert.match(markup, /Read only/);
  assert.match(markup, /Album Change: Album 30x30 → Album 20x20 \(-40\.000 KD\)/);
  assert.match(markup, /Composition Total/);
  assert.match(markup, /210\.000 KD/);
});

test("CurrentCompositionCard renders adjustment mode header and the same row layout", () => {
  const markup = renderToStaticMarkup(
    createElement(CurrentCompositionCard, {
      view: viewFixture("adjustment"),
    })
  );

  assert.match(markup, /Preview Composition/);
  assert.match(markup, /Preview/);
  assert.match(markup, /Album Change: Album 30x30 → Album 20x20 \(-40\.000 KD\)/);
  assert.match(markup, /Premium Package/);
});

function viewFixture(mode: CompositionView["mode"]): CompositionView {
  return {
    mode,
    total: 210,
    rows: [
      {
        id: "package:1",
        kind: "package",
        label: "Premium Package",
        quantity: 1,
        unitPrice: 250,
        lineTotal: 250,
      },
      {
        id: "album-swap",
        kind: "swap",
        label: "Album Change",
        lineTotal: -40,
        delta: {
          from: "Album 30x30",
          to: "Album 20x20",
          amount: -40,
        },
      },
    ],
  };
}
