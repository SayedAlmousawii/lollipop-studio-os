import type { OrderCompositionViewModel } from "../order-composition.types";
import {
  toPOSCompositionProjection,
  type DraftPOSCompositionProjection,
} from "./to-draft-pos-composition";

export type LockedPOSCompositionProjection = DraftPOSCompositionProjection & {
  locked: true;
};

export function toLockedPOSComposition(
  model: OrderCompositionViewModel
): LockedPOSCompositionProjection {
  const snapshot =
    model.pendingAdjustmentComposition ?? model.effectiveComposition;
  return {
    ...toPOSCompositionProjection(model, snapshot),
    locked: true,
  };
}
