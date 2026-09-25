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
    CONSTRAINT "ClienteDemo_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaDemo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClienteDemo_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ClienteDemo" ("cuentaId", "entregadoEn", "id", "nombre", "servicioId", "telefono", "usuarioId") SELECT "cuentaId", "entregadoEn", "id", "nombre", "servicioId", "telefono", "usuarioId" FROM "ClienteDemo";
DROP TABLE "ClienteDemo";
ALTER TABLE "new_ClienteDemo" RENAME TO "ClienteDemo";
CREATE UNIQUE INDEX "ClienteDemo_usuarioId_telefono_servicioId_key" ON "ClienteDemo"("usuarioId", "telefono", "servicioId");
CREATE TABLE "new_CuentaDemo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuarioId" INTEGER NOT NULL,
    "servicioId" INTEGER NOT NULL,
    "usuario" TEXT NOT NULL,
    "contrasena" TEXT NOT NULL,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CuentaDemo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CuentaDemo_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CuentaDemo" ("contrasena", "creadoEn", "disponible", "id", "servicioId", "usuario", "usuarioId") SELECT "contrasena", "creadoEn", "disponible", "id", "servicioId", "usuario", "usuarioId" FROM "CuentaDemo";
DROP TABLE "CuentaDemo";
ALTER TABLE "new_CuentaDemo" RENAME TO "CuentaDemo";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
