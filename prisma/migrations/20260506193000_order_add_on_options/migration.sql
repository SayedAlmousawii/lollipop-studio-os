CREATE TABLE "order_add_on_options" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "price" DECIMAL(10,3) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_add_on_options_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_add_on_options_category_isActive_idx" ON "order_add_on_options"("category", "isActive");

INSERT INTO "order_add_on_options" ("id", "name", "category", "price", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
  ('addon-extra-photo', 'Extra photo', 'EXTRA_PHOTO', 5.000, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('addon-canvas-30x40', 'Canvas 30x40', 'CANVAS', 25.000, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('addon-canvas-40x60', 'Canvas 40x60', 'CANVAS', 35.000, true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('addon-album-20x20', 'Album 20x20', 'ALBUM', 45.000, true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('addon-album-30x30', 'Album 30x30', 'ALBUM', 65.000, true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
