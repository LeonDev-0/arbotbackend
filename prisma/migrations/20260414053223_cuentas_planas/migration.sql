/*
  Warnings:

  - You are about to drop the `Cliente` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ClienteServicio` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SesionDemo` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `suscripcionId` on the `CuentaCliente` table. All the data in the column will be lost.
  - Added the required column `servicioId` to the `CuentaCliente` table without a default value. This is not possible if the table is not empty.
  - Added the required column `telefono` to the `CuentaCliente` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Cliente_telefono_key";

-- DropIndex
DROP INDEX "ClienteServicio_clienteId_servicioId_pais_key";

-- DropIndex
DROP INDEX "SesionDemo_clienteId_cuentaId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Cliente";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ClienteServicio";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SesionDemo";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "ClienteDemo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "telefono" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuentaId" INTEGER NOT NULL,
    "entregadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "servicioId" INTEGER NOT NULL,
    CONSTRAINT "ClienteDemo_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaDemo" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClienteDemo_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CuentaCliente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "telefono" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "contrasena" TEXT NOT NULL,
    "servicioId" INTEGER NOT NULL,
    "pais" TEXT NOT NULL DEFAULT 'Bolivia',
    "notas" TEXT,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CuentaCliente_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CuentaCliente" ("contrasena", "id", "usuario") SELECT "contrasena", "id", "usuario" FROM "CuentaCliente";
DROP TABLE "CuentaCliente";
ALTER TABLE "new_CuentaCliente" RENAME TO "CuentaCliente";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ClienteDemo_telefono_servicioId_key" ON "ClienteDemo"("telefono", "servicioId");
