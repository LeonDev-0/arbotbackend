-- Recrear CuentaCliente con contrasena y servicioId opcionales, sin conexiones
CREATE TABLE "_CuentaCliente_new" (
  "id"                  INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "usuarioId"           INTEGER NOT NULL,
  "telefono"            TEXT NOT NULL,
  "usuario"             TEXT NOT NULL,
  "contrasena"          TEXT,
  "servicioId"          INTEGER,
  "pais"                TEXT NOT NULL DEFAULT 'Bolivia',
  "notas"               TEXT,
  "expiraEn"            DATETIME,
  "recordatorioEnviado" BOOLEAN NOT NULL DEFAULT 0,
  "paquete"             TEXT,
  "creadoEn"            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CuentaCliente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CuentaCliente_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "_CuentaCliente_new"
  ("id","usuarioId","telefono","usuario","contrasena","servicioId","pais","notas","expiraEn","recordatorioEnviado","paquete","creadoEn")
SELECT
  "id","usuarioId","telefono","usuario","contrasena","servicioId","pais","notas","expiraEn","recordatorioEnviado","paquete","creadoEn"
FROM "CuentaCliente";

DROP TABLE "CuentaCliente";
ALTER TABLE "_CuentaCliente_new" RENAME TO "CuentaCliente";
