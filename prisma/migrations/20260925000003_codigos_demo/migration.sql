-- Códigos configurables para pedir demos
ALTER TABLE "Servicio" ADD COLUMN "codigoDemo" TEXT NOT NULL DEFAULT '22';
ALTER TABLE "Servicio" ADD COLUMN "codigoDemoAdultos" TEXT NOT NULL DEFAULT '23';
ALTER TABLE "Servicio" ADD COLUMN "codigoDemoSinAdultos" TEXT NOT NULL DEFAULT '24';
