/*
  Warnings:

  - You are about to drop the `Cliente` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Cliente";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "CuentaDemo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuario" TEXT NOT NULL,
    "contrasena" TEXT NOT NULL,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SesionDemo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "telefono" TEXT NOT NULL,
    "cuentaId" INTEGER NOT NULL,
    "entregadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "SesionDemo_telefono_key" ON "SesionDemo"("telefono");
