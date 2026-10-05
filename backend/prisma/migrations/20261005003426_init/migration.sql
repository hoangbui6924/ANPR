-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'staff',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detections" (
    "id" SERIAL NOT NULL,
    "image_path" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_by" INTEGER,
    "process_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "detections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plates" (
    "id" SERIAL NOT NULL,
    "detection_id" INTEGER NOT NULL,
    "plate_text" TEXT NOT NULL,
    "plate_norm" TEXT NOT NULL,
    "plate_type" TEXT NOT NULL,
    "vehicle_type" TEXT,
    "det_conf" DOUBLE PRECISION NOT NULL,
    "ocr_conf" DOUBLE PRECISION NOT NULL,
    "bbox" JSONB NOT NULL,
    "crop_path" TEXT,
    "is_valid" BOOLEAN NOT NULL,

    CONSTRAINT "plates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_lists" (
    "id" SERIAL NOT NULL,
    "plate_norm" TEXT NOT NULL,
    "plate_text" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_lists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "detections_created_at_idx" ON "detections"("created_at");

-- CreateIndex
CREATE INDEX "plates_plate_norm_idx" ON "plates"("plate_norm");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_lists_plate_norm_key" ON "vehicle_lists"("plate_norm");

-- AddForeignKey
ALTER TABLE "detections" ADD CONSTRAINT "detections_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plates" ADD CONSTRAINT "plates_detection_id_fkey" FOREIGN KEY ("detection_id") REFERENCES "detections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_lists" ADD CONSTRAINT "vehicle_lists_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
