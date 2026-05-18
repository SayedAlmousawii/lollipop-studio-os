import type {
  Prisma,
  SessionConfigurationCounterPricingMode,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
} from "@prisma/client";
import type { db } from "@/lib/db";

type DbClient = typeof db | Prisma.TransactionClient;

export const pricedSessionConfigurationSelectionSelect = {
  id: true,
  optionId: true,
  snapshotConfigurationCode: true,
  snapshotLabel: true,
  snapshotOptionLabel: true,
  snapshotPriceDelta: true,
  snapshotFinancialBehavior: true,
  snapshotPricingMode: true,
  snapshotInputType: true,
  snapshotLinkedProductId: true,
  orderAddOnId: true,
  numericValue: true,
  textValue: true,
} satisfies Prisma.OrderPackageSessionConfigurationSelectionSelect;

export type ResolvedConfigDefinition = {
  id: string;
  code: string;
  name: string;
  required: boolean;
  sortOrder: number;
  inputType: SessionConfigurationInputType;
  pricingMode: SessionConfigurationPricingMode;
  financialBehavior: SessionConfigurationFinancialBehavior;
  fixedPriceDelta: Prisma.Decimal | null;
  linkedProductId: string | null;
  linkedProductName: string | null;
  linkedProductPrice: Prisma.Decimal | null;
  counterPricingMode: SessionConfigurationCounterPricingMode | null;
  counterUnitPrice: Prisma.Decimal | null;
  options: {
    id: string;
    label: string;
    priceDelta: Prisma.Decimal;
  }[];
};

export type ResolvedSelection = Prisma.OrderPackageSessionConfigurationSelectionGetPayload<{
  select: typeof pricedSessionConfigurationSelectionSelect;
}> & {
  configurationId: string;
};

export type ResolvedOrderPackageConfigs = {
  orderPackageId: string;
  sessionTypeId: string;
  activeConfigurations: ResolvedConfigDefinition[];
  selections: ResolvedSelection[];
  missingRequiredConfigurationCodes: string[];
};

export class SessionConfigurationRequiredSelectionMissingError extends Error {
  details: {
    orderPackageId: string;
    missingConfigurationCodes: string[];
  }[];

  constructor(
    details: {
      orderPackageId: string;
      missingConfigurationCodes: string[];
    }[]
  ) {
    super("Required session configuration selections are missing");
    this.name = "SessionConfigurationRequiredSelectionMissingError";
    this.details = details;
  }
}

export async function resolveOrderPackageSessionConfigurations(
  client: DbClient,
  orderPackageId: string
): Promise<ResolvedOrderPackageConfigs> {
  const orderPackage = await client.orderPackage.findUnique({
    where: { id: orderPackageId },
    select: {
      id: true,
      sessionTypeId: true,
      sessionConfigurationSelections: {
        select: {
          ...pricedSessionConfigurationSelectionSelect,
          configurationId: true,
        },
      },
    },
  });
  if (!orderPackage) {
    throw new Error("Order package not found");
  }

  return resolvePackageConfigState(client, {
    orderPackageId: orderPackage.id,
    sessionTypeId: orderPackage.sessionTypeId,
    selections: orderPackage.sessionConfigurationSelections,
  });
}

export async function resolveOrderSessionConfigurations(
  client: DbClient,
  orderId: string
): Promise<ResolvedOrderPackageConfigs[]> {
  const packages = await client.orderPackage.findMany({
    where: { orderId },
    select: {
      id: true,
      sessionTypeId: true,
      sessionConfigurationSelections: {
        select: {
          ...pricedSessionConfigurationSelectionSelect,
          configurationId: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return Promise.all(
    packages.map((orderPackage) =>
      resolvePackageConfigState(client, {
        orderPackageId: orderPackage.id,
        sessionTypeId: orderPackage.sessionTypeId,
        selections: orderPackage.sessionConfigurationSelections,
      })
    )
  );
}

async function resolvePackageConfigState(
  client: DbClient,
  input: {
    orderPackageId: string;
    sessionTypeId: string;
    selections: ResolvedSelection[];
  }
): Promise<ResolvedOrderPackageConfigs> {
  const activeConfigurations = await client.sessionConfiguration.findMany({
    where: {
      sessionTypeId: input.sessionTypeId,
      isActive: true,
    },
    select: {
      id: true,
      code: true,
      name: true,
      required: true,
      sortOrder: true,
      inputType: true,
      pricingMode: true,
      financialBehavior: true,
      fixedPriceDelta: true,
      linkedProductId: true,
      linkedProduct: {
        select: { name: true, canonicalPrice: true },
      },
      counterPricingMode: true,
      counterUnitPrice: true,
      options: {
        where: { isActive: true },
        select: {
          id: true,
          label: true,
          priceDelta: true,
        },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const selectedConfigurationIds = new Set(
    input.selections.map((selection) => selection.configurationId)
  );
  const missingRequiredConfigurationCodes = activeConfigurations
    .filter(
      (configuration) =>
        configuration.required && !selectedConfigurationIds.has(configuration.id)
    )
    .map((configuration) => configuration.code);

  return {
    orderPackageId: input.orderPackageId,
    sessionTypeId: input.sessionTypeId,
    activeConfigurations: activeConfigurations.map((configuration) => ({
      id: configuration.id,
      code: configuration.code,
      name: configuration.name,
      required: configuration.required,
      sortOrder: configuration.sortOrder,
      inputType: configuration.inputType,
      pricingMode: configuration.pricingMode,
      financialBehavior: configuration.financialBehavior,
      fixedPriceDelta: configuration.fixedPriceDelta,
      linkedProductId: configuration.linkedProductId,
      linkedProductName: configuration.linkedProduct?.name ?? null,
      linkedProductPrice: configuration.linkedProduct?.canonicalPrice ?? null,
      counterPricingMode: configuration.counterPricingMode,
      counterUnitPrice: configuration.counterUnitPrice,
      options: configuration.options,
    })),
    selections: input.selections,
    missingRequiredConfigurationCodes,
  };
}
