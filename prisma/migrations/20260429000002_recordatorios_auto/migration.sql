ALTER TABLE "CuentaCliente" ADD COLUMN "expiraEn" DATETIME;
ALTER TABLE "CuentaCliente" ADD COLUMN "recordatorioEnviado" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "Usuario" ADD COLUMN "recordatorioPlantillaId" INTEGER;
