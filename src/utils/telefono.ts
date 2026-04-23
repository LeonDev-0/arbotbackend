import { detectarPais } from "../../bot"

export function normalizarTelefono(telefono: string): string {
  const limpio = telefono.replace(/[\s\-\(\)]/g, "").replace(/^\+/, "")
  const { numeroCompleto } = detectarPais(limpio)
  return numeroCompleto
}
