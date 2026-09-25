-- AlterTable
ALTER TABLE "CuentaCliente" ADD COLUMN "dispositivoId" INTEGER;
ALTER TABLE "CuentaCliente" ADD COLUMN "plantillaRecordatorioId" INTEGER;

-- AlterTable
ALTER TABLE "Dispositivo" ADD COLUMN "recordatorioPlantillaId" INTEGER;
