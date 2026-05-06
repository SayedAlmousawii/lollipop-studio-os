import {
  BookingStatus,
  CustomerStatus,
  InvoiceStatus,
  OrderEditingStatus,
  OrderProductionStatus,
  OrderSelectionStatus,
  OrderStatus,
  PaymentMethod,
  PaymentType,
  PrismaClient,
  SessionType,
  UserRole,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({ adapter: new PrismaPg(url) });

async function main() {
  // Users
  const [admin, manager, receptionist, photographer, editor] = await Promise.all([
    prisma.user.upsert({
      where: { email: "admin@studio-os.local" },
      update: {},
      create: { name: "Admin", email: "admin@studio-os.local", role: UserRole.ADMIN },
    }),
    prisma.user.upsert({
      where: { email: "manager@studio-os.local" },
      update: {},
      create: { name: "Sara Al-Manager", email: "manager@studio-os.local", role: UserRole.MANAGER },
    }),
    prisma.user.upsert({
      where: { email: "reception@studio-os.local" },
      update: {},
      create: { name: "Noor Al-Anazi", email: "reception@studio-os.local", role: UserRole.RECEPTIONIST },
    }),
    prisma.user.upsert({
      where: { email: "photo@studio-os.local" },
      update: {},
      create: { name: "Khalid Al-Photo", email: "photo@studio-os.local", role: UserRole.PHOTOGRAPHER },
    }),
    prisma.user.upsert({
      where: { email: "editor@studio-os.local" },
      update: {},
      create: { name: "Mona Al-Edit", email: "editor@studio-os.local", role: UserRole.EDITOR },
    }),
  ]);

  // Packages
  const [pkgBasic, pkgStandard, pkgPremium] = await Promise.all([
    prisma.package.upsert({
      where: { id: "pkg-basic" },
      update: {},
      create: {
        id: "pkg-basic",
        name: "Basic Package",
        price: 150,
        photoCount: 20,
        description: "20 edited photos, digital delivery",
        isActive: true,
      },
    }),
    prisma.package.upsert({
      where: { id: "pkg-standard" },
      update: {},
      create: {
        id: "pkg-standard",
        name: "Standard Package",
        price: 250,
        photoCount: 40,
        description: "40 edited photos, digital delivery + 1 album",
        isActive: true,
      },
    }),
    prisma.package.upsert({
      where: { id: "pkg-premium" },
      update: {},
      create: {
        id: "pkg-premium",
        name: "Premium Package",
        price: 400,
        photoCount: 70,
        description: "70 edited photos, digital delivery + 2 albums + prints",
        isActive: true,
      },
    }),
  ]);

  // Customers
  const [customerFatima, customerAhmed, customerMaryam] = await Promise.all([
    prisma.customer.upsert({
      where: { phone: "96512345678" },
      update: {},
      create: {
        phone: "96512345678",
        name: "Fatima Al-Rashidi",
        status: CustomerStatus.ACTIVE,
        notes: "Prefers morning sessions",
      },
    }),
    prisma.customer.upsert({
      where: { phone: "96598765432" },
      update: {},
      create: {
        phone: "96598765432",
        name: "Ahmed Al-Mutairi",
        status: CustomerStatus.ACTIVE,
      },
    }),
    prisma.customer.upsert({
      where: { phone: "96555511223" },
      update: {},
      create: {
        phone: "96555511223",
        name: "Maryam Al-Azmi",
        status: CustomerStatus.INACTIVE,
      },
    }),
  ]);

  // Children
  await Promise.all([
    prisma.child.upsert({
      where: { id: "child-fatima-1" },
      update: {},
      create: {
        id: "child-fatima-1",
        name: "Layla",
        dateOfBirth: new Date("2025-01-15"),
        customerId: customerFatima.id,
      },
    }),
    prisma.child.upsert({
      where: { id: "child-ahmed-1" },
      update: {},
      create: {
        id: "child-ahmed-1",
        name: "Omar",
        dateOfBirth: new Date("2024-06-20"),
        customerId: customerAhmed.id,
      },
    }),
    prisma.child.upsert({
      where: { id: "child-ahmed-2" },
      update: {},
      create: {
        id: "child-ahmed-2",
        name: "Reem",
        dateOfBirth: new Date("2022-03-10"),
        customerId: customerAhmed.id,
      },
    }),
  ]);

  // Studio departments
  const [newbornDepartment, kidsDepartment] = await Promise.all([
    prisma.studioDepartment.upsert({
      where: { code: "NB" },
      update: {
        name: "Newborn",
        isActive: true,
        sortOrder: 10,
      },
      create: {
        id: "dept-newborn",
        name: "Newborn",
        code: "NB",
        isActive: true,
        sortOrder: 10,
      },
    }),
    prisma.studioDepartment.upsert({
      where: { code: "KD" },
      update: {
        name: "Kids",
        isActive: true,
        sortOrder: 20,
      },
      create: {
        id: "dept-kids",
        name: "Kids",
        code: "KD",
        isActive: true,
        sortOrder: 20,
      },
    }),
  ]);

  // Booking 1: Confirmed newborn session for Fatima
  const booking1 = await prisma.booking.upsert({
    where: { id: "booking-001" },
    update: {
      publicId: "BKG-00001",
      jobNumber: "PH-2026-00001",
      customerId: customerFatima.id,
      packageId: pkgStandard.id,
      sessionDate: new Date("2026-05-10T10:00:00Z"),
      sessionType: SessionType.NEWBORN,
      departmentId: newbornDepartment.id,
      status: BookingStatus.CONFIRMED,
      assignedPhotographerId: photographer.id,
      notes: "Newborn session — baby is 3 weeks old",
      themes: {
        deleteMany: {},
        create: [{ themeName: "Minimal White" }],
      },
    },
    create: {
      id: "booking-001",
      publicId: "BKG-00001",
      jobNumber: "PH-2026-00001",
      customerId: customerFatima.id,
      packageId: pkgStandard.id,
      sessionDate: new Date("2026-05-10T10:00:00Z"),
      sessionType: SessionType.NEWBORN,
      departmentId: newbornDepartment.id,
      status: BookingStatus.CONFIRMED,
      assignedPhotographerId: photographer.id,
      notes: "Newborn session — baby is 3 weeks old",
      themes: {
        create: [{ themeName: "Minimal White" }],
      },
    },
  });

  // Invoice 1 linked directly to Booking 1 before completion
  const invoice1 = await prisma.invoice.upsert({
    where: { id: "inv-001" },
    update: {
      publicId: "INV-PUB-00001",
      jobNumber: booking1.jobNumber,
      bookingId: booking1.id,
      orderId: null,
      customerId: customerFatima.id,
      invoiceNumber: "INV-00001",
      totalAmount: 250,
      paidAmount: 20,
      remainingAmount: 230,
      status: InvoiceStatus.PARTIAL,
      issuedAt: new Date("2026-05-10T10:00:00Z"),
    },
    create: {
      id: "inv-001",
      publicId: "INV-PUB-00001",
      jobNumber: booking1.jobNumber,
      bookingId: booking1.id,
      customerId: customerFatima.id,
      invoiceNumber: "INV-00001",
      totalAmount: 250,
      paidAmount: 20,
      remainingAmount: 230,
      status: InvoiceStatus.PARTIAL,
      issuedAt: new Date("2026-05-10T10:00:00Z"),
    },
  });

  // Payment 1: Deposit for Booking 1
  await prisma.payment.upsert({
    where: { id: "pay-001" },
    update: {
      publicId: "PAY-00001",
      jobNumber: booking1.jobNumber,
      invoiceId: invoice1.id,
      amount: 20,
      method: PaymentMethod.KNET,
      paymentType: PaymentType.DEPOSIT,
      notes: "Deposit paid via KNET",
    },
    create: {
      id: "pay-001",
      publicId: "PAY-00001",
      jobNumber: booking1.jobNumber,
      invoiceId: invoice1.id,
      amount: 20,
      method: PaymentMethod.KNET,
      paymentType: PaymentType.DEPOSIT,
      notes: "Deposit paid via KNET",
    },
  });

  // Booking 2: Pending kids session for Ahmed
  const booking2 = await prisma.booking.upsert({
    where: { id: "booking-002" },
    update: {
      publicId: "BKG-00002",
      jobNumber: "PH-2026-00002",
      customerId: customerAhmed.id,
      packageId: pkgBasic.id,
      sessionDate: new Date("2026-05-20T14:00:00Z"),
      sessionType: SessionType.KIDS,
      departmentId: kidsDepartment.id,
      status: BookingStatus.PENDING,
      assignedPhotographerId: null,
      notes: "Waiting for deposit confirmation",
      themes: {
        deleteMany: {},
      },
    },
    create: {
      id: "booking-002",
      publicId: "BKG-00002",
      jobNumber: "PH-2026-00002",
      customerId: customerAhmed.id,
      packageId: pkgBasic.id,
      sessionDate: new Date("2026-05-20T14:00:00Z"),
      sessionType: SessionType.KIDS,
      departmentId: kidsDepartment.id,
      status: BookingStatus.PENDING,
      notes: "Waiting for deposit confirmation",
    },
  });

  // Booking 3: Completed session for Maryam (paid in full, editing)
  const booking3 = await prisma.booking.upsert({
    where: { id: "booking-003" },
    update: {
      publicId: "BKG-00003",
      jobNumber: "PH-2026-00003",
      customerId: customerMaryam.id,
      packageId: pkgPremium.id,
      sessionDate: new Date("2026-04-15T11:00:00Z"),
      sessionType: SessionType.FAMILY,
      departmentId: kidsDepartment.id,
      status: BookingStatus.COMPLETED,
      assignedPhotographerId: photographer.id,
      notes: null,
      themes: {
        deleteMany: {},
        create: [{ themeName: "Classic Family" }],
      },
    },
    create: {
      id: "booking-003",
      publicId: "BKG-00003",
      jobNumber: "PH-2026-00003",
      customerId: customerMaryam.id,
      packageId: pkgPremium.id,
      sessionDate: new Date("2026-04-15T11:00:00Z"),
      sessionType: SessionType.FAMILY,
      departmentId: kidsDepartment.id,
      status: BookingStatus.COMPLETED,
      assignedPhotographerId: photographer.id,
      themes: {
        create: [{ themeName: "Classic Family" }],
      },
    },
  });

  // Order 3 linked to Booking 3
  const order3 = await prisma.order.upsert({
    where: { id: "order-003" },
    update: {
      publicId: "ORD-00001",
      jobNumber: booking3.jobNumber,
      bookingId: booking3.id,
      customerId: customerMaryam.id,
      originalPackageId: pkgPremium.id,
      finalPackageId: pkgPremium.id,
      selectedPhotoCount: 65,
      status: OrderStatus.EDITING,
      selectionStatus: OrderSelectionStatus.COMPLETED,
      editingStatus: OrderEditingStatus.IN_PROGRESS,
      productionStatus: OrderProductionStatus.WAITING_FOR_EDITING,
      nasFolderPath: "\\\\Synology\\Family\\2026-04-15\\96555511223-AlAzmi",
    },
    create: {
      id: "order-003",
      publicId: "ORD-00001",
      jobNumber: booking3.jobNumber,
      bookingId: booking3.id,
      customerId: customerMaryam.id,
      originalPackageId: pkgPremium.id,
      finalPackageId: pkgPremium.id,
      selectedPhotoCount: 65,
      status: OrderStatus.EDITING,
      selectionStatus: OrderSelectionStatus.COMPLETED,
      editingStatus: OrderEditingStatus.IN_PROGRESS,
      productionStatus: OrderProductionStatus.WAITING_FOR_EDITING,
      nasFolderPath: "\\\\Synology\\Family\\2026-04-15\\96555511223-AlAzmi",
    },
  });

  // Invoice 3
  const invoice3 = await prisma.invoice.upsert({
    where: { id: "inv-003" },
    update: {
      publicId: "INV-PUB-00002",
      jobNumber: booking3.jobNumber,
      orderId: order3.id,
      bookingId: booking3.id,
      customerId: customerMaryam.id,
      invoiceNumber: "INV-00002",
      totalAmount: 400,
      paidAmount: 400,
      remainingAmount: 0,
      status: InvoiceStatus.PAID,
      issuedAt: new Date("2026-04-15T11:00:00Z"),
    },
    create: {
      id: "inv-003",
      publicId: "INV-PUB-00002",
      jobNumber: booking3.jobNumber,
      orderId: order3.id,
      bookingId: booking3.id,
      customerId: customerMaryam.id,
      invoiceNumber: "INV-00002",
      totalAmount: 400,
      paidAmount: 400,
      remainingAmount: 0,
      status: InvoiceStatus.PAID,
      issuedAt: new Date("2026-04-15T11:00:00Z"),
    },
  });

  // Payments for Invoice 3
  await Promise.all([
    prisma.payment.upsert({
      where: { id: "pay-003a" },
      update: {
        publicId: "PAY-00002",
        jobNumber: booking3.jobNumber,
        invoiceId: invoice3.id,
        amount: 20,
        method: PaymentMethod.CASH,
        paymentType: PaymentType.DEPOSIT,
      },
      create: {
        id: "pay-003a",
        publicId: "PAY-00002",
        jobNumber: booking3.jobNumber,
        invoiceId: invoice3.id,
        amount: 20,
        method: PaymentMethod.CASH,
        paymentType: PaymentType.DEPOSIT,
      },
    }),
    prisma.payment.upsert({
      where: { id: "pay-003b" },
      update: {
        publicId: "PAY-00003",
        jobNumber: booking3.jobNumber,
        invoiceId: invoice3.id,
        amount: 380,
        method: PaymentMethod.KNET,
        paymentType: PaymentType.BASE,
        notes: "Full session payment",
      },
      create: {
        id: "pay-003b",
        publicId: "PAY-00003",
        jobNumber: booking3.jobNumber,
        invoiceId: invoice3.id,
        amount: 380,
        method: PaymentMethod.KNET,
        paymentType: PaymentType.BASE,
        notes: "Full session payment",
      },
    }),
  ]);

  await prisma.$queryRaw`
    SELECT setval(
      '"booking_public_id_seq"',
      GREATEST((SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) FROM "bookings"), 1),
      (SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) > 0 FROM "bookings")
    )
  `;
  await prisma.$queryRaw`
    SELECT setval(
      '"order_public_id_seq"',
      GREATEST((SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) FROM "orders"), 1),
      (SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) > 0 FROM "orders")
    )
  `;
  await prisma.$queryRaw`
    SELECT setval(
      '"invoice_public_id_seq"',
      GREATEST((SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) FROM "invoices"), 1),
      (SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) > 0 FROM "invoices")
    )
  `;
  await prisma.$queryRaw`
    SELECT setval(
      '"payment_public_id_seq"',
      GREATEST((SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) FROM "payments"), 1),
      (SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) > 0 FROM "payments")
    )
  `;
  await prisma.$executeRaw`
    INSERT INTO "identifier_sequences" ("scope", "year", "lastValue", "createdAt", "updatedAt")
    SELECT
      split_part("jobNumber", '-', 1),
      split_part("jobNumber", '-', 2)::INTEGER,
      MAX(split_part("jobNumber", '-', 3)::INTEGER),
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM "bookings"
    GROUP BY split_part("jobNumber", '-', 1), split_part("jobNumber", '-', 2)::INTEGER
    ON CONFLICT ("scope", "year") DO UPDATE SET
      "lastValue" = GREATEST("identifier_sequences"."lastValue", EXCLUDED."lastValue"),
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  console.log("✓ Seed completed");
  console.log(`  Users:     ${[admin, manager, receptionist, photographer, editor].length}`);
  console.log(`  Packages:  ${[pkgBasic, pkgStandard, pkgPremium].length}`);
  console.log(`  Departments: ${[newbornDepartment, kidsDepartment].length}`);
  console.log(`  Customers: ${[customerFatima, customerAhmed, customerMaryam].length}`);
  console.log(`  Bookings:  ${[booking1, booking2, booking3].length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
