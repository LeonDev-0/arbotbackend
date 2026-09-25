-- Servicios solo conectados al panel IPTV: se eliminan las demos manuales.

-- Adultos: dos booleanos → una sola opción ("preguntar" | "si" | "no")
ALTER TABLE "Servicio" ADD COLUMN "adultos" TEXT NOT NULL DEFAULT 'preguntar';
UPDATE "Servicio" SET "adultos" = CASE
  WHEN "preguntarAdultos" THEN 'preguntar'
  WHEN "puppeteerAdultos" THEN 'si'
  ELSE 'no'
END;

ALTER TABLE "Servicio" RENAME COLUMN "puppeteerPlan" TO "planDemo";
ALTER TABLE "Servicio" DROP COLUMN "usarPuppeteer";
ALTER TABLE "Servicio" DROP COLUMN "puppeteerAdultos";
ALTER TABLE "Servicio" DROP COLUMN "preguntarAdultos";
ALTER TABLE "Servicio" DROP COLUMN "msgDemoSinStock";

-- Ya no hay lista de demos manuales: toda CuentaDemo es una demo entregada
ALTER TABLE "CuentaDemo" DROP COLUMN "disponible";
