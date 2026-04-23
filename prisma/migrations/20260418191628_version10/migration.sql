/*
  Warnings:

  - Added the required column `usuarioId` to the `ClienteDemo` table without a default value. This is not possible if the table is not empty.
  - Added the required column `usuarioId` to the `CuentaCliente` table without a default value. This is not possible if the table is not empty.
  - Added the required column `usuarioId` to the `CuentaDemo` table without a default value. This is not possible if the table is not empty.
  - Added the required column `usuarioId` to the `Dispositivo` table without a default value. This is not possible if the table is not empty.
  - Added the required column `usuarioId` to the `Servicio` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Usuario" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "rol" TEXT NOT NULL DEFAULT 'cliente',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "expiraEn" DATETIME,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PlantillaRecordatorio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuarioId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'texto',
    "mensaje" TEXT NOT NULL,
    "imagenUrl" TEXT,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlantillaRecordatorio_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ClienteDemo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuarioId" INTEGER NOT NULL,
    "telefono" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuentaId" INTEGER NOT NULL,
    "servicioId" INTEGER NOT NULL,
    "entregadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClienteDemo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClienteDemo_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaDemo" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClienteDemo_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ClienteDemo" ("cuentaId", "entregadoEn", "id", "nombre", "servicioId", "telefono") SELECT "cuentaId", "entregadoEn", "id", "nombre", "servicioId", "telefono" FROM "ClienteDemo";
DROP TABLE "ClienteDemo";
ALTER TABLE "new_ClienteDemo" RENAME TO "ClienteDemo";
CREATE UNIQUE INDEX "ClienteDemo_usuarioId_telefono_servicioId_key" ON "ClienteDemo"("usuarioId", "telefono", "servicioId");
CREATE TABLE "new_CuentaCliente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuarioId" INTEGER NOT NULL,
    "telefono" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "contrasena" TEXT NOT NULL,
    "servicioId" INTEGER NOT NULL,
    "pais" TEXT NOT NULL DEFAULT 'Bolivia',
    "notas" TEXT,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CuentaCliente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CuentaCliente_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CuentaCliente" ("contrasena", "creadoEn", "id", "notas", "pais", "servicioId", "telefono", "usuario") SELECT "contrasena", "creadoEn", "id", "notas", "pais", "servicioId", "telefono", "usuario" FROM "CuentaCliente";
DROP TABLE "CuentaCliente";
ALTER TABLE "new_CuentaCliente" RENAME TO "CuentaCliente";
CREATE TABLE "new_CuentaDemo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuarioId" INTEGER NOT NULL,
    "servicioId" INTEGER NOT NULL,
    "usuario" TEXT NOT NULL,
    "contrasena" TEXT NOT NULL,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CuentaDemo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CuentaDemo_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CuentaDemo" ("contrasena", "creadoEn", "disponible", "id", "servicioId", "usuario") SELECT "contrasena", "creadoEn", "disponible", "id", "servicioId", "usuario" FROM "CuentaDemo";
DROP TABLE "CuentaDemo";
ALTER TABLE "new_CuentaDemo" RENAME TO "CuentaDemo";
CREATE TABLE "new_Dispositivo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuarioId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "servicioId" INTEGER,
    "pais" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'desconectado',
    "telefono" TEXT,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Dispositivo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Dispositivo_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Dispositivo" ("creadoEn", "estado", "id", "nombre", "pais", "servicioId", "telefono") SELECT "creadoEn", "estado", "id", "nombre", "pais", "servicioId", "telefono" FROM "Dispositivo";
DROP TABLE "Dispositivo";
ALTER TABLE "new_Dispositivo" RENAME TO "Dispositivo";
CREATE TABLE "new_Servicio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuarioId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#22c55e',
    CONSTRAINT "Servicio_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Servicio" ("color", "id", "nombre") SELECT "color", "id", "nombre" FROM "Servicio";
DROP TABLE "Servicio";
ALTER TABLE "new_Servicio" RENAME TO "Servicio";
CREATE UNIQUE INDEX "Servicio_usuarioId_nombre_key" ON "Servicio"("usuarioId", "nombre");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_username_key" ON "Usuario"("username");
