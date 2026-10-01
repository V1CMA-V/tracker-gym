-- AlterTable
ALTER TABLE "users" ADD COLUMN     "clerk_id" VARCHAR(64),
ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_id_key" ON "users"("clerk_id");
