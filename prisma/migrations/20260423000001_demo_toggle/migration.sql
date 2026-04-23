-- AlterTable: toggle de demos y mensaje personalizado cuando están desactivadas
ALTER TABLE "Servicio" ADD COLUMN "demosActivo"       BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Servicio" ADD COLUMN "msgDemoDesactivado" TEXT;
