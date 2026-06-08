import type {
  FinancialCaseActiveSummary,
  FinancialCaseSummary,
} from "./financial-case-summary.types";

export type CustomerSettlementSummary = {
  financialCaseId: string;
  stage: FinancialCaseSummary["stage"];
  netCustomerTotal: number;
  cashPaid: number;
  remainingDue: number;
  availableCredit: number;
};

export function deriveCustomerSettlementFromFinancialCaseSummary(
  summary: FinancialCaseSummary
): CustomerSettlementSummary {
  if (summary.stage === "booking") {
    return {
      financialCaseId: summary.financialCaseId,
      stage: "booking",
      netCustomerTotal: 0,
      cashPaid: 0,
      remainingDue: 0,
      availableCredit: 0,
    };
  }

  return deriveCustomerSettlementFromActiveSummary(summary);
}

export function deriveCustomerSettlementFromActiveSummary(
  summary: FinancialCaseActiveSummary
): CustomerSettlementSummary {
  const creditIssued = roundMoney(
    summary.creditNotes.reduce((sum, creditNote) => sum + creditNote.total, 0)
  );
  const netCustomerTotal = getNetCustomerTotal(summary);
  const creditsApplied = roundMoney(
    Math.max(creditIssued - summary.availableCaseCredit, 0)
  );
  const cashPaid = roundMoney(Math.max(summary.effectivePaid - creditsApplied, 0));
  const remainingDue = roundMoney(Math.max(netCustomerTotal - cashPaid, 0));
  const availableCredit = roundMoney(Math.max(cashPaid - netCustomerTotal, 0));

  return {
    financialCaseId: summary.financialCaseId,
    stage: "active",
    netCustomerTotal,
    cashPaid,
    remainingDue,
    availableCredit,
  };
}

export function getNetCustomerTotal(
  summary: FinancialCaseActiveSummary
): number {
  const creditIssued = summary.creditNotes.reduce(
    (sum, creditNote) => sum + creditNote.total,
    0
  );
  return roundMoney(Math.max(summary.customerTotal - creditIssued, 0));
}

function roundMoney(value: number): number {
  return Number(value.toFixed(3));
}
