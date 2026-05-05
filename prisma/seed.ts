import { PrismaClient, BookingStatus, SessionType, OrderStatus, InvoiceStatus, PaymentMethod, PaymentType, UserRole, CustomerStatus } from "@prisma/client";
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

  // Booking 1: Confirmed newborn session for Fatima
  const booking1 = await prisma.booking.upsert({
    where: { id: "booking-001" },
    update: {},
    create: {
      id: "booking-001",
      customerId: customerFatima.id,
      packageId: pkgStandard.id,
      sessionDate: new Date("2026-05-10T10:00:00Z"),
      sessionType: SessionType.NEWBORN,
      status: BookingStatus.CONFIRMED,
      depositPaid: true,
      notes: "Newborn session — baby is 3 weeks old",
    },
  });

  // Order 1 linked to Booking 1
  const order1 = await prisma.order.upsert({
    where: { id: "order-001" },
    update: {},
    create: {
      id: "order-001",
      bookingId: booking1.id,
      customerId: customerFatima.id,
      originalPackageId: pkgStandard.id,
      finalPackageId: pkgStandard.id,
      status: OrderStatus.ACTIVE,
    },
  });

  // Invoice 1 linked to Order 1
  const invoice1 = await prisma.invoice.upsert({
    where: { id: "inv-001" },
    update: {},
    create: {
      id: "inv-001",
      orderId: order1.id,
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
    update: {},
    create: {
      id: "pay-001",
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
    update: {},
    create: {
      id: "booking-002",
      customerId: customerAhmed.id,
      packageId: pkgBasic.id,
      sessionDate: new Date("2026-05-20T14:00:00Z"),
      sessionType: SessionType.KIDS,
      status: BookingStatus.PENDING,
      depositPaid: false,
    },
  });

  // Booking 3: Completed session for Maryam (paid in full, editing)
  const booking3 = await prisma.booking.upsert({
    where: { id: "booking-003" },
    update: {},
    create: {
      id: "booking-003",
      customerId: customerMaryam.id,
      packageId: pkgPremium.id,
      sessionDate: new Date("2026-04-15T11:00:00Z"),
      sessionType: SessionType.FAMILY,
      status: BookingStatus.COMPLETED,
      depositPaid: true,
    },
  });

  // Order 3 linked to Booking 3
  const order3 = await prisma.order.upsert({
    where: { id: "order-003" },
    update: {},
    create: {
      id: "order-003",
      bookingId: booking3.id,
      customerId: customerMaryam.id,
      originalPackageId: pkgPremium.id,
      finalPackageId: pkgPremium.id,
      selectedPhotoCount: 65,
      status: OrderStatus.EDITING,
      nasFolderPath: "\\\\Synology\\Family\\2026-04-15\\96555511223-AlAzmi",
    },
  });

  // Invoice 3
  const invoice3 = await prisma.invoice.upsert({
    where: { id: "inv-003" },
    update: {},
    create: {
      id: "inv-003",
      orderId: order3.id,
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
      update: {},
      create: {
        id: "pay-003a",
        invoiceId: invoice3.id,
        amount: 20,
        method: PaymentMethod.CASH,
        paymentType: PaymentType.DEPOSIT,
      },
    }),
    prisma.payment.upsert({
      where: { id: "pay-003b" },
      update: {},
      create: {
        id: "pay-003b",
        invoiceId: invoice3.id,
        amount: 380,
        method: PaymentMethod.KNET,
        paymentType: PaymentType.BASE,
        notes: "Full session payment",
      },
    }),
  ]);

  console.log("✓ Seed completed");
  console.log(`  Users:     ${[admin, manager, receptionist, photographer, editor].length}`);
  console.log(`  Packages:  ${[pkgBasic, pkgStandard, pkgPremium].length}`);
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
