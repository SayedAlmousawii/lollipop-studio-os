import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OperationalConfigurationsBlock } from "@/components/orders/operational-configurations-block";

test("OperationalConfigurationsBlock renders selections grouped by package", () => {
  const markup = renderToStaticMarkup(
    createElement(OperationalConfigurationsBlock, {
      packageLines: [
        {
          packageName: "Newborn Classic",
          sessionTypeName: "Newborn",
          operationalSelections: [
            { configName: "Cake theme", valueDisplay: "Clouds" },
            { configName: "Baby name", valueDisplay: "Mariam" },
          ],
        },
      ],
    })
  );

  assert.match(markup, /Operational configurations/);
  assert.match(markup, /Newborn Classic/);
  assert.match(markup, /Cake theme/);
  assert.match(markup, /Clouds/);
  assert.match(markup, /Baby name/);
});

test("OperationalConfigurationsBlock hides when no operational selections exist", () => {
  const markup = renderToStaticMarkup(
    createElement(OperationalConfigurationsBlock, {
      packageLines: [
        {
          packageName: "Newborn Classic",
          sessionTypeName: "Newborn",
          operationalSelections: [],
        },
      ],
    })
  );

  assert.equal(markup, "");
});
