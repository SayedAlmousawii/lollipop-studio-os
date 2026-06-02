import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import {
  cloneElement,
  createElement,
  Fragment,
  isValidElement,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
  ORDER_COMMIT_PREVIEW_COMMIT_KIND,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND,
} from "@/modules/order-commits";
import type { POSMutationActionState } from "@/modules/orders/pos-handlers.types";
import type {
  SalesPageDraftState,
  SalesPageFinancialPreview,
  SalesPagePreviewState,
  SalesPageStagedChangesRow,
} from "@/modules/order-commits/projections/sales-page-view.types";
import type { OrderCommitReviewDialogProps } from "../../../src/components/orders/order-commit-review-dialog";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type DialogModule = {
  OrderCommitReviewDialog: ComponentType<OrderCommitReviewDialogProps>;
};

type DialogBehaviorProps = OrderCommitReviewDialogProps;

type RenderedNode = {
  type: string;
  props: Record<string, unknown>;
  children: RenderedTree;
};

type RenderedTree = Array<RenderedNode | string>;

type RenderContext = {
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
};

type MarkerComponent = ComponentType<Record<string, unknown>> & {
  __testKind?: string;
};

type HookController = ReturnType<typeof createHookController>;

type BehaviorHarness = {
  hookController: HookController;
  render: (props: DialogBehaviorProps) => RenderedTree;
  flush: () => Promise<void>;
  refreshCalls: string[];
  toastMessages: string[];
};

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
let activeHarness: BehaviorHarness | null = null;

test("OrderCommitReviewDialog behavior opens, submits approval actor, and resets after success", async () => {
  const harness = await createBehaviorHarness();
  const calls: Array<{
    orderId: string;
    expectedDraftVersion: number;
    approvalActorUserId?: string;
  }> = [];
  const commitAction: NonNullable<DialogBehaviorProps["commitAction"]> = async (
    orderId,
    expectedDraftVersion,
    approvalActorUserId
  ) => {
    calls.push({ orderId, expectedDraftVersion, approvalActorUserId });
    return { kind: "success" };
  };
  const props = dialogBehaviorProps({
    preview: previewFixture({
      requiresApproval: true,
      approvalReasons: [
        {
          code: "MANAGER_REVIEW",
          message: "Manager review required for reductions.",
        },
      ],
    }),
    commitAction,
  });

  let tree = harness.render(props);
  assertNoText(tree, /Commit changes/);

  click(findHostByText(tree, "button", /Review & commit/));
  tree = harness.render(props);
  assertText(tree, /Commit changes/);
  assertText(tree, /Premium album/);

  changeInput(findHostByName(tree, "input", "approvalActorUserId"), "manager-1");
  tree = harness.render(props);
  submit(findHost(tree, "form"));
  await harness.flush();

  assert.deepEqual(calls, [
    {
      orderId: "order-1",
      expectedDraftVersion: 3,
      approvalActorUserId: "manager-1",
    },
  ]);
  assert.deepEqual(harness.refreshCalls, ["refresh"]);
  assert.deepEqual(harness.toastMessages, ["Sales changes committed."]);

  tree = harness.render(props);
  assertNoText(tree, /Commit changes/);

  click(findHostByText(tree, "button", /Review & commit/));
  tree = harness.render(props);
  assert.equal(
    findHostByName(tree, "input", "approvalActorUserId").props.value,
    ""
  );
});

test("OrderCommitReviewDialog error responses keep the current preview open", async () => {
  const states: POSMutationActionState[] = [
    {
      kind: "error",
      errors: {
        _global: [
          "Draft changed since you opened it. Refresh to see the latest.",
          "commit.stale",
        ],
      },
    },
    {
      kind: "error",
      errors: {
        _global: [
          "Another commit just landed. Refresh and try again.",
          "commit.concurrent",
        ],
      },
    },
    {
      kind: "approval-required",
      errors: {
        _global: ["commit.approvalRequired"],
        approvalActorUserId: ["Manager/admin user ID is required."],
      },
    },
    {
      kind: "error",
      errors: {
        _global: [
          "Credit/refund capacity changed. Refresh and review this order before committing.",
          "commit.creditCapacity",
        ],
      },
    },
  ];

  for (const state of states) {
    const harness = await createBehaviorHarness();
    const calls: Array<{
      orderId: string;
      expectedDraftVersion: number;
      approvalActorUserId?: string;
    }> = [];
    const commitAction: NonNullable<DialogBehaviorProps["commitAction"]> = async (
      orderId,
      expectedDraftVersion,
      approvalActorUserId
    ) => {
      calls.push({ orderId, expectedDraftVersion, approvalActorUserId });
      return state;
    };
    const props = dialogBehaviorProps({ commitAction });

    let tree = harness.render(props);
    click(findHostByText(tree, "button", /Review & commit/));
    tree = harness.render(props);
    submit(findHost(tree, "form"));
    await harness.flush();

    assert.deepEqual(calls, [
      {
        orderId: "order-1",
        expectedDraftVersion: 3,
        approvalActorUserId: undefined,
      },
    ]);
    assert.deepEqual(harness.refreshCalls, []);
    assert.deepEqual(harness.toastMessages, []);

    tree = harness.render(props);
    assertText(tree, /Commit changes/);
    assertText(tree, /Previous total/);
    assertText(tree, /Premium album/);
    assertText(tree, /Canvas removed/);
    assertText(tree, /Document plan/);

    if (state.kind === "approval-required") {
      assertText(
        tree,
        /Manager\/admin approval is required before this commit can finish/
      );
      assertText(tree, /Manager\/admin user ID/);
    } else {
      assertText(tree, new RegExp(state.errors?._global?.[0] ?? ""));
    }
  }
});

async function createBehaviorHarness(): Promise<BehaviorHarness> {
  const hookController = createHookController();
  const refreshCalls: string[] = [];
  const toastMessages: string[] = [];
  const originalModuleLoad = moduleWithLoader._load;

  moduleWithLoader._load = function loadWithBehaviorStubs(
    request,
    parent,
    isMain
  ) {
    if (request === "react") return dialogTestReactModule;
    if (request === "react/jsx-runtime" || request === "react/jsx-dev-runtime") {
      return dialogTestJsxRuntimeModule;
    }
    if (request === "next/navigation") {
      return {
        useRouter: () => ({
          refresh: () => getActiveHarness().refreshCalls.push("refresh"),
        }),
      };
    }
    if (request === "sonner") {
      return {
        toast: {
          success: (message: string) =>
            getActiveHarness().toastMessages.push(message),
        },
      };
    }
    if (request === "@/app/orders/[orderId]/sales/actions") {
      return {
        commitSalesChangesAction: async () => ({ kind: "success" }),
      };
    }
    if (request === "lucide-react") {
      return {
        AlertTriangle: hostComponent("svg"),
        CheckCircle2: hostComponent("svg"),
        ClipboardCheck: hostComponent("svg"),
        FileText: hostComponent("svg"),
        ShieldCheck: hostComponent("svg"),
      };
    }
    if (request === "@/components/ui/badge") {
      return { Badge: hostComponent("span") };
    }
    if (request === "@/components/ui/button") {
      return { Button: hostComponent("button") };
    }
    if (request === "@/components/ui/input") {
      return { Input: hostComponent("input") };
    }
    if (request === "@/components/ui/label") {
      return { Label: hostComponent("label") };
    }
    if (request === "@/components/ui/dialog") {
      return {
        Dialog: markerComponent("Dialog"),
        DialogContent: markerComponent("DialogContent"),
        DialogDescription: hostComponent("p"),
        DialogFooter: hostComponent("footer"),
        DialogHeader: hostComponent("header"),
        DialogTitle: hostComponent("h2"),
        DialogTrigger: markerComponent("DialogTrigger"),
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const dialogModule = (await import(
      "../../../src/components/orders/order-commit-review-dialog.tsx"
    )) as DialogModule;
    const harness: BehaviorHarness = {
      hookController,
      render: (props) => {
        activeHarness = harness;
        return hookController.render(() =>
          renderReactNode(createElement(dialogModule.OrderCommitReviewDialog, props))
        );
      },
      flush: async () => {
        activeHarness = harness;
        await hookController.flush();
      },
      refreshCalls,
      toastMessages,
    };
    return harness;
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
}

const dialogTestReactModule = {
  useEffect: () => undefined,
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(initialValue: T) => getActiveHarness().hookController.useRef(initialValue),
  useState: <T,>(initialValue: T | (() => T)) =>
    getActiveHarness().hookController.useState(initialValue),
  useTransition: () => getActiveHarness().hookController.useTransition(),
};

const dialogTestJsxRuntimeModule = {
  Fragment,
  jsx: createTestElement,
  jsxs: createTestElement,
};

function createTestElement(
  type: ReactElement["type"],
  props: Record<string, unknown> | null,
  key?: string
): ReactElement {
  return createElement(type, key === undefined ? props : { ...props, key });
}

function getActiveHarness(): BehaviorHarness {
  if (!activeHarness) {
    throw new Error("OrderCommitReviewDialog behavior harness is not rendering.");
  }
  return activeHarness;
}

function createHookController() {
  const stateValues: unknown[] = [];
  const refValues: Array<{ current: unknown }> = [];
  const pendingTransitions: Promise<void>[] = [];
  let stateCursor = 0;
  let refCursor = 0;

  return {
    useRef: <T,>(initialValue: T) => {
      const index = refCursor;
      refCursor += 1;
      if (!refValues[index]) refValues[index] = { current: initialValue };
      return refValues[index] as { current: T };
    },
    useState: <T,>(
      initialValue: T | (() => T)
    ): [T, (nextValue: T | ((previous: T) => T)) => void] => {
      const index = stateCursor;
      stateCursor += 1;
      if (stateValues.length <= index) {
        stateValues[index] =
          typeof initialValue === "function"
            ? (initialValue as () => T)()
            : initialValue;
      }
      return [
        stateValues[index] as T,
        (nextValue) => {
          stateValues[index] =
            typeof nextValue === "function"
              ? (nextValue as (previous: T) => T)(stateValues[index] as T)
              : nextValue;
        },
      ];
    },
    useTransition: (): [
      boolean,
      (callback: () => void | Promise<void>) => void,
    ] => [
      false,
      (callback) => {
        pendingTransitions.push(Promise.resolve(callback()).then(() => undefined));
      },
    ],
    flush: async () => {
      while (pendingTransitions.length > 0) {
        const pending = pendingTransitions.splice(0);
        await Promise.all(pending);
      }
    },
    render: (callback: () => RenderedTree) => {
      stateCursor = 0;
      refCursor = 0;
      return callback();
    },
  };
}

function dialogBehaviorProps(
  overrides: Partial<DialogBehaviorProps> = {}
): DialogBehaviorProps {
  return {
    orderId: "order-1",
    draft: draftFixture(),
    preview: previewFixture(),
    stagedChanges: stagedRowsFixture(),
    financialPreview: financialPreviewFixture(),
    ...overrides,
  };
}

function hostComponent(type: string): ComponentType<Record<string, unknown>> {
  return function HostComponent(props: Record<string, unknown>) {
    return createElement(type, props, props.children as ReactNode);
  };
}

function markerComponent(kind: string): MarkerComponent {
  const component = (() => null) as MarkerComponent;
  component.__testKind = kind;
  return component;
}

function renderReactNode(
  value: ReactNode,
  context: RenderContext | null = null
): RenderedTree {
  if (value === null || value === undefined || typeof value === "boolean") {
    return [];
  }
  if (typeof value === "string" || typeof value === "number") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((child) => renderReactNode(child, context));
  }
  if (!isValidElement(value)) return [];

  const element = value as ReactElement<Record<string, unknown>>;
  const props = element.props;
  const elementType = element.type;

  if (typeof elementType === "function") {
    const component = elementType as MarkerComponent;
    if (component.__testKind === "Dialog") {
      const dialogContext = {
        dialogOpen: Boolean(props.open),
        onDialogOpenChange:
          typeof props.onOpenChange === "function"
            ? (props.onOpenChange as (open: boolean) => void)
            : () => undefined,
      };
      return [
        {
          type: "test-dialog",
          props,
          children: renderReactNode(props.children as ReactNode, dialogContext),
        },
      ];
    }
    if (component.__testKind === "DialogContent") {
      if (!context?.dialogOpen) return [];
      return renderReactNode(
        createElement("section", props, props.children as ReactNode),
        context
      );
    }
    if (component.__testKind === "DialogTrigger") {
      const child = firstChild(props.children as ReactNode);
      if (!isValidElement(child)) return [];
      const originalOnClick = child.props.onClick;
      const onClick = () => {
        if (typeof originalOnClick === "function") originalOnClick();
        context?.onDialogOpenChange(true);
      };
      return renderReactNode(
        cloneElement(child as ReactElement<Record<string, unknown>>, { onClick }),
        context
      );
    }
    return renderReactNode(component(props), context);
  }

  if (typeof elementType !== "string") {
    return renderReactNode(props.children as ReactNode, context);
  }

  const children = renderReactNode(props.children as ReactNode, context);
  if (props.ref && typeof props.ref === "object" && "current" in props.ref) {
    (props.ref as { current: unknown }).current = { focus: () => undefined };
  }
  return [{ type: elementType, props, children }];
}

function firstChild(children: ReactNode): ReactNode {
  return Array.isArray(children) ? children[0] : children;
}

function flattenNodes(nodes: RenderedTree): RenderedNode[] {
  return nodes.flatMap((node) => {
    if (typeof node === "string") return [];
    return [node, ...flattenNodes(node.children)];
  });
}

function textContent(node: RenderedNode | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textContent).join("");
}

function findHost(tree: RenderedTree, type: string): RenderedNode {
  const node = flattenNodes(tree).find((entry) => entry.type === type);
  assert.ok(node, `Expected to find <${type}>`);
  return node;
}

function findHostByText(
  tree: RenderedTree,
  type: string,
  pattern: RegExp
): RenderedNode {
  const node = flattenNodes(tree).find(
    (entry) => entry.type === type && pattern.test(textContent(entry))
  );
  assert.ok(node, `Expected to find <${type}> matching ${pattern}`);
  return node;
}

function findHostByName(
  tree: RenderedTree,
  type: string,
  name: string
): RenderedNode {
  const node = flattenNodes(tree).find(
    (entry) => entry.type === type && entry.props.name === name
  );
  assert.ok(node, `Expected to find <${type} name="${name}">`);
  return node;
}

function click(node: RenderedNode): void {
  assert.equal(typeof node.props.onClick, "function");
  (node.props.onClick as () => void)();
}

function changeInput(node: RenderedNode, value: string): void {
  assert.equal(typeof node.props.onChange, "function");
  (node.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value },
  });
}

function submit(node: RenderedNode): void {
  assert.equal(typeof node.props.onSubmit, "function");
  (node.props.onSubmit as (event: { preventDefault: () => void }) => void)({
    preventDefault: () => undefined,
  });
}

function assertText(tree: RenderedTree, pattern: RegExp): void {
  assert.match(tree.map(textContent).join(""), pattern);
}

function assertNoText(tree: RenderedTree, pattern: RegExp): void {
  assert.doesNotMatch(tree.map(textContent).join(""), pattern);
}

function draftFixture(): SalesPageDraftState {
  return {
    id: "draft-1",
    version: 3,
    ownerUserId: "staff-1",
    openedByUserId: "staff-1",
    lastTouchedByUserId: "staff-1",
    updatedAt: new Date("2026-06-02T08:00:00.000Z"),
    baseCommitId: "commit-1",
  };
}

function previewFixture(
  overrides: Partial<SalesPagePreviewState> & {
    documentPlanKind?: SalesPagePreviewState["documentPlan"]["kind"];
  } = {}
): SalesPagePreviewState {
  const documentPlanKind =
    overrides.documentPlanKind ??
    ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.CREDIT_NOTE;

  return {
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    baselineCommitId: "commit-1",
    baselineSequence: 1,
    draftId: "draft-1",
    draftVersion: 3,
    commitKind: ORDER_COMMIT_PREVIEW_COMMIT_KIND.CREDIT_NOTE,
    lineDiffs: [],
    netDelta: -15,
    totals: {
      baselineTotal: 100,
      netDelta: -15,
      pendingTotal: 85,
    },
    requiresApproval: overrides.requiresApproval ?? false,
    approvalReasons: overrides.approvalReasons ?? [],
    documentPlan: {
      kind: documentPlanKind,
      amount: 15,
      requiresPaymentCollection: false,
      requiresRefundReview: true,
      reason: "Reduction creates credit note",
    },
    paymentImpact: {
      kind: ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.CREDIT_AVAILABLE,
      amountDue: 0,
      creditAmount: 15,
      alreadyPaidAmount: 100,
      remainingAfterCommit: -15,
    },
    refundImpact: {
      refundRequired: true,
      refundableAmount: 15,
      creditNoteAmount: 15,
      reason: "Refund review required",
    },
    zeroNetReason: overrides.zeroNetReason ?? null,
    ...overrides,
  };
}

function stagedRowsFixture(): SalesPageStagedChangesRow[] {
  return [
    {
      id: "row-1",
      changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PRICE_CHANGED,
      label: "Premium album",
      netDelta: 10,
      parentLabel: "Portrait package",
    },
    {
      id: "row-2",
      changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED,
      label: "Canvas removed",
      netDelta: -25,
      parentLabel: null,
    },
  ];
}

function financialPreviewFixture(
  overlay: Partial<SalesPageFinancialPreview["overlay"]> = {}
): SalesPageFinancialPreview {
  return {
    baseline: {
      stage: "active",
      financialCaseId: "case-1",
      depositInvoice: null,
      finalInvoice: null,
      customerTotal: 100,
      finalTotal: 100,
      depositApplied: 0,
      paidSoFar: 100,
      effectivePaid: 100,
      remaining: 0,
      paymentStatusEnum: null,
      collectPaymentInvoiceId: null,
    },
    overlay: {
      previousTotal: overlay.previousTotal ?? 100,
      pendingDelta: overlay.pendingDelta ?? -15,
      pendingTotal: overlay.pendingTotal ?? 85,
      requiresApproval: overlay.requiresApproval ?? false,
      approvalReasons: overlay.approvalReasons ?? [],
      documentPlan: overlay.documentPlan ?? null,
      paymentImpact: overlay.paymentImpact ?? null,
      refundImpact: overlay.refundImpact ?? null,
    },
  };
}
