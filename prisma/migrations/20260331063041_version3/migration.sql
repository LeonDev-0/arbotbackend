-- CreateTable
CREATE TABLE "NumeroBienvenido" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "telefono" TEXT NOT NULL,
    "bienvenidoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "NumeroBienvenido_telefono_key" ON "NumeroBienvenido"("telefono");
