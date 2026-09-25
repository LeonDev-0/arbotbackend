-- Mover RespuestaRegla de dispositivoId → servicioId

-- 1. Agregar columna servicioId
ALTER TABLE "RespuestaRegla" ADD COLUMN "servicioId" INTEGER;

-- 2. Migrar datos: tomar el servicioId del dispositivo al que pertenecía la regla
UPDATE "RespuestaRegla"
SET "servicioId" = (
  SELECT "servicioId" FROM "Dispositivo"
  WHERE "Dispositivo"."id" = "RespuestaRegla"."dispositivoId"
);

-- 3. Eliminar reglas sin servicio (dispositivos que no tenían servicio asignado)
DELETE FROM "RespuestaPaso"
WHERE "reglaId" IN (SELECT "id" FROM "RespuestaRegla" WHERE "servicioId" IS NULL);
DELETE FROM "RespuestaRegla" WHERE "servicioId" IS NULL;

-- 4. Recrear la tabla sin dispositivoId
CREATE TABLE "_RespuestaRegla_new" (
  "id"            INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
  "servicioId"    INTEGER  NOT NULL,
  "palabrasClave" TEXT     NOT NULL,
  "orden"         INTEGER  NOT NULL DEFAULT 0,
  "activo"        BOOLEAN  NOT NULL DEFAULT 1,
  "creadoEn"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RespuestaRegla_servicioId_fkey"
    FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "_RespuestaRegla_new"
  SELECT "id", "servicioId", "palabrasClave", "orden", "activo", "creadoEn"
  FROM "RespuestaRegla";

DROP TABLE "RespuestaRegla";
ALTER TABLE "_RespuestaRegla_new" RENAME TO "RespuestaRegla";
