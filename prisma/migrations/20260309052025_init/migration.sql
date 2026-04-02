/*
  Warnings:

  - You are about to drop the column `createdAt` on the `Cliente` table. All the data in the column will be lost.
  - You are about to drop the column `fechaCreacion` on the `Cliente` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Cliente` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Cliente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuario" TEXT NOT NULL,
    "contrasena" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "fechaExpiracion" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Cliente" ("contrasena", "fechaExpiracion", "id", "plan", "telefono", "usuario") SELECT "contrasena", "fechaExpiracion", "id", "plan", "telefono", "usuario" FROM "Cliente";
DROP TABLE "Cliente";
ALTER TABLE "new_Cliente" RENAME TO "Cliente";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
