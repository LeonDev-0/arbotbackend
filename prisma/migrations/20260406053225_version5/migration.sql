/*
  Warnings:

  - You are about to drop the column `creadoEn` on the `Servicio` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "DispositivoRespuesta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dispositivoId" INTEGER NOT NULL,
    "palabrasClave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'texto',
    "contenido" TEXT NOT NULL,
    "caption" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DispositivoRespuesta_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Servicio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#22c55e'
);
INSERT INTO "new_Servicio" ("color", "id", "nombre") SELECT "color", "id", "nombre" FROM "Servicio";
DROP TABLE "Servicio";
ALTER TABLE "new_Servicio" RENAME TO "Servicio";
CREATE UNIQUE INDEX "Servicio_nombre_key" ON "Servicio"("nombre");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
