-- Sincroniza el historial de migraciones con el esquema real.
-- Cambios hechos antes con 'db push' sin migracion: quita columnas de recordatorios
-- en desuso (Usuario/Dispositivo.recordatorioPlantillaId, CuentaCliente.dispositivoId)
-- y registra paisDefault y los campos de Servicio/Usuario agregados despues.
-- En dev.db se marco como aplicada con 'prisma migrate resolve' (ya estaba en este estado).

-- AlterTable
ALTER TABLE "PlantillaRecordatorio" ADD COLUMN "paisDefault" TEXT;

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
    "plantillaRecordatorioId" INTEGER,
    "paquete" TEXT,
    "conexiones" TEXT,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CuentaCliente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CuentaCliente_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CuentaCliente" ("conexiones", "contrasena", "creadoEn", "expiraEn", "id", "notas", "pais", "paquete", "plantillaRecordatorioId", "recordatorioAuto", "recordatorioEnviado", "servicioId", "telefono", "usuario", "usuarioId") SELECT "conexiones", "contrasena", "creadoEn", "expiraEn", "id", "notas", "pais", "paquete", "plantillaRecordatorioId", "recordatorioAuto", "recordatorioEnviado", "servicioId", "telefono", "usuario", "usuarioId" FROM "CuentaCliente";
DROP TABLE "CuentaCliente";
ALTER TABLE "new_CuentaCliente" RENAME TO "CuentaCliente";
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
INSERT INTO "new_Dispositivo" ("creadoEn", "estado", "id", "nombre", "pais", "servicioId", "telefono", "usuarioId") SELECT "creadoEn", "estado", "id", "nombre", "pais", "servicioId", "telefono", "usuarioId" FROM "Dispositivo";
DROP TABLE "Dispositivo";
ALTER TABLE "new_Dispositivo" RENAME TO "Dispositivo";
CREATE TABLE "new_Servicio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuarioId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#22c55e',
    "demosActivo" BOOLEAN NOT NULL DEFAULT true,
    "msgDemoEntregada" TEXT,
    "msgDemoYaTiene" TEXT,
    "msgDemoSinStock" TEXT,
    "msgDemoDesactivado" TEXT,
    "tieneRecordatorios" BOOLEAN NOT NULL DEFAULT true,
    "usarPuppeteer" BOOLEAN NOT NULL DEFAULT false,
    "puppeteerPlan" TEXT,
    "puppeteerAdultos" BOOLEAN NOT NULL DEFAULT true,
    "preguntarAdultos" BOOLEAN NOT NULL DEFAULT true,
    "smartersNombre" TEXT,
    "smartersUrl" TEXT,
    "iphoneUrl" TEXT,
    "imagenDespuesDemo" TEXT,
    "captionImagenDespuesDemo" TEXT,
    CONSTRAINT "Servicio_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Servicio" ("color", "demosActivo", "id", "msgDemoDesactivado", "msgDemoEntregada", "msgDemoSinStock", "msgDemoYaTiene", "nombre", "puppeteerAdultos", "puppeteerPlan", "tieneRecordatorios", "usarPuppeteer", "usuarioId") SELECT "color", "demosActivo", "id", "msgDemoDesactivado", "msgDemoEntregada", "msgDemoSinStock", "msgDemoYaTiene", "nombre", "puppeteerAdultos", "puppeteerPlan", "tieneRecordatorios", "usarPuppeteer", "usuarioId" FROM "Servicio";
DROP TABLE "Servicio";
ALTER TABLE "new_Servicio" RENAME TO "Servicio";
CREATE UNIQUE INDEX "Servicio_usuarioId_nombre_key" ON "Servicio"("usuarioId", "nombre");
CREATE TABLE "new_Usuario" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "rol" TEXT NOT NULL DEFAULT 'cliente',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "expiraEn" DATETIME,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "panelUsuario" TEXT,
    "panelPassword" TEXT,
    "adminPhone" TEXT
);
INSERT INTO "new_Usuario" ("activo", "creadoEn", "expiraEn", "id", "password", "rol", "username") SELECT "activo", "creadoEn", "expiraEn", "id", "password", "rol", "username" FROM "Usuario";
DROP TABLE "Usuario";
ALTER TABLE "new_Usuario" RENAME TO "Usuario";
CREATE UNIQUE INDEX "Usuario_username_key" ON "Usuario"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

