-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "Servicio_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Servicio" ("color", "demosActivo", "id", "msgDemoDesactivado", "msgDemoEntregada", "msgDemoSinStock", "msgDemoYaTiene", "nombre", "puppeteerAdultos", "puppeteerPlan", "usarPuppeteer", "usuarioId") SELECT "color", "demosActivo", "id", "msgDemoDesactivado", "msgDemoEntregada", "msgDemoSinStock", "msgDemoYaTiene", "nombre", "puppeteerAdultos", "puppeteerPlan", "usarPuppeteer", "usuarioId" FROM "Servicio";
DROP TABLE "Servicio";
ALTER TABLE "new_Servicio" RENAME TO "Servicio";
CREATE UNIQUE INDEX "Servicio_usuarioId_nombre_key" ON "Servicio"("usuarioId", "nombre");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
