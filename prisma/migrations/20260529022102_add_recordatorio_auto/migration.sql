-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CuentaCliente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuarioId" INTEGER NOT NULL,
    "telefono" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "contrasena" TEXT,
    "servicioId" INTEGER,
    "pais" TEXT NOT NULL DEFAULT 'Bolivia',
    "notas" TEXT,
    "expiraEn" DATETIME,
    "recordatorioEnviado" BOOLEAN NOT NULL DEFAULT false,
    "recordatorioAuto" BOOLEAN NOT NULL DEFAULT true,
    "paquete" TEXT,
    "conexiones" TEXT,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CuentaCliente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CuentaCliente_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CuentaCliente" ("conexiones", "contrasena", "creadoEn", "expiraEn", "id", "notas", "pais", "paquete", "recordatorioEnviado", "servicioId", "telefono", "usuario", "usuarioId") SELECT "conexiones", "contrasena", "creadoEn", "expiraEn", "id", "notas", "pais", "paquete", "recordatorioEnviado", "servicioId", "telefono", "usuario", "usuarioId" FROM "CuentaCliente";
DROP TABLE "CuentaCliente";
ALTER TABLE "new_CuentaCliente" RENAME TO "CuentaCliente";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
