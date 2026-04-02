-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Cliente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuario" TEXT NOT NULL,
    "contrasena" TEXT,
    "telefono" TEXT NOT NULL,
    "plan" TEXT,
    "estado" TEXT DEFAULT '1 mes-1-Disp',
    "fechaExpiracion" DATETIME
);
INSERT INTO "new_Cliente" ("contrasena", "estado", "fechaExpiracion", "id", "plan", "telefono", "usuario") SELECT "contrasena", "estado", "fechaExpiracion", "id", "plan", "telefono", "usuario" FROM "Cliente";
DROP TABLE "Cliente";
ALTER TABLE "new_Cliente" RENAME TO "Cliente";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
