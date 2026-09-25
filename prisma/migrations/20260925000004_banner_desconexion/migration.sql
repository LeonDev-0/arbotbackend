-- Alertas de desconexión: se reemplaza el aviso por WhatsApp (adminPhone) por un banner en el sistema
ALTER TABLE "Usuario" DROP COLUMN "adminPhone";
ALTER TABLE "Dispositivo" ADD COLUMN "caidoDesde" DATETIME;
