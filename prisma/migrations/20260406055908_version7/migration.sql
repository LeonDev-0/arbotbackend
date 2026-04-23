/*
  Warnings:

  - You are about to drop the `DispositivoRespuesta` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "DispositivoRespuesta";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "RespuestaRegla" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dispositivoId" INTEGER NOT NULL,
    "palabrasClave" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RespuestaRegla_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RespuestaPaso" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reglaId" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "tipo" TEXT NOT NULL DEFAULT 'texto',
    "contenido" TEXT NOT NULL,
    "caption" TEXT,
    "delayMs" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RespuestaPaso_reglaId_fkey" FOREIGN KEY ("reglaId") REFERENCES "RespuestaRegla" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
