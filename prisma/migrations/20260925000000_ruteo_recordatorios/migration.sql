-- CreateTable
CREATE TABLE "RutaRecordatorio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuarioId" INTEGER NOT NULL,
    "pais" TEXT NOT NULL,
    "dispositivoId" INTEGER NOT NULL,
    CONSTRAINT "RutaRecordatorio_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RutaRecordatorio_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RutaRecordatorio_usuarioId_pais_key" ON "RutaRecordatorio"("usuarioId", "pais");
