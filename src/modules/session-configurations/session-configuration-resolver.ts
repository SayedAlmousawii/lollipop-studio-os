import type { Prisma } from "@prisma/client";
import type { db } from "@/lib/db";

type DbClient = typeof db | Prisma.TransactionClient;

export const pricedSessionConfigurationSelectionSelect = {
  id: true,
  snapshotConfigurationCode: true,
  snapshotLabel: true,
  snapshotPriceDelta: true,
  snapshotPricingMode: true,
  snapshotInputType: true,
  snapshotLinkProductDisplay: true,
  snapshotLinkedProductId: true,
  numericValue: true,
} satisfies Prisma.OrderPackageSessionConfigurationSelectionSelect;

export type ResolvedConfigDefinition = {
  id: string;
  code: string;
  name: string;
  required: boolean;
  sortOrder: number;
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
    activeConfigurations,
    selections: input.selections,
    missingRequiredConfigurationCodes,
  };
}
