-- AlterTable: mensajes de demo configurables por servicio
ALTER TABLE "Servicio" ADD COLUMN "msgDemoEntregada" TEXT;
ALTER TABLE "Servicio" ADD COLUMN "msgDemoYaTiene"   TEXT;
ALTER TABLE "Servicio" ADD COLUMN "msgDemoSinStock"  TEXT;
