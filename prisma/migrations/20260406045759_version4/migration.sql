/*
  Warnings:

  - You are about to drop the `NumeroBienvenido` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `clienteId` on the `CuentaCliente` table. All the data in the column will be lost.
  - You are about to drop the column `telefono` on the `SesionDemo` table. All the data in the column will be lost.
  - Added the required column `suscripcionId` to the `CuentaCliente` table without a default value. This is not possible if the table is not empty.
  - Added the required column `servicioId` to the `CuentaDemo` table without a default value. This is not possible if the table is not empty.
  - Added the required column `clienteId` to the `SesionDemo` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "NumeroBienvenido_telefono_key";

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN "nombre" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "NumeroBienvenido";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Servicio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#22c55e',
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Dispositivo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "servicioId" INTEGER,
    "pais" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'desconectado',
    "telefono" TEXT,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Dispositivo_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClienteServicio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clienteId" INTEGER NOT NULL,
    "servicioId" INTEGER NOT NULL,
    "pais" TEXT NOT NULL DEFAULT 'Bolivia',
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClienteServicio_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClienteServicio_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CuentaCliente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "suscripcionId" INTEGER NOT NULL,
    "usuario" TEXT NOT NULL,
    "contrasena" TEXT NOT NULL,
    CONSTRAINT "CuentaCliente_suscripcionId_fkey" FOREIGN KEY ("suscripcionId") REFERENCES "ClienteServicio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CuentaCliente" ("contrasena", "id", "usuario") SELECT "contrasena", "id", "usuario" FROM "CuentaCliente";
DROP TABLE "CuentaCliente";
ALTER TABLE "new_CuentaCliente" RENAME TO "CuentaCliente";
CREATE TABLE "new_CuentaDemo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "servicioId" INTEGER NOT NULL,
    "usuario" TEXT NOT NULL,
    "contrasena" TEXT NOT NULL,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CuentaDemo_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CuentaDemo" ("contrasena", "creadoEn", "disponible", "id", "usuario") SELECT "contrasena", "creadoEn", "disponible", "id", "usuario" FROM "CuentaDemo";
DROP TABLE "CuentaDemo";
ALTER TABLE "new_CuentaDemo" RENAME TO "CuentaDemo";
CREATE TABLE "new_SesionDemo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clienteId" INTEGER NOT NULL,
    "cuentaId" INTEGER NOT NULL,
    "entregadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SesionDemo_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SesionDemo_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaDemo" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SesionDemo" ("cuentaId", "entregadoEn", "id") SELECT "cuentaId", "entregadoEn", "id" FROM "SesionDemo";
DROP TABLE "SesionDemo";
ALTER TABLE "new_SesionDemo" RENAME TO "SesionDemo";
CREATE UNIQUE INDEX "SesionDemo_clienteId_cuentaId_key" ON "SesionDemo"("clienteId", "cuentaId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Servicio_nombre_key" ON "Servicio"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "ClienteServicio_clienteId_servicioId_pais_key" ON "ClienteServicio"("clienteId", "servicioId", "pais");
