// Códigos de demo configurables por servicio (número, texto o emoji).
// Se comparan sin espacios alrededor y sin distinguir mayúsculas.
export const normalizarCodigo = (c: string) => c.trim().toLowerCase()

// Palabras que el bot ya usa como comando o respuesta: no pueden ser códigos
const RESERVADOS = ["0", "1", "2", "si", "sí", "no", "cancelar", "active", "rm", "smart", "vu"]

// Palabras clave de una regla de respuesta automática ("precio, info" → ["precio", "info"])
export const clavesRegla = (palabrasClave: string) =>
  palabrasClave.split(",").map(normalizarCodigo).filter(Boolean)

/* Devuelve un mensaje de error si los códigos no son válidos, o null si están bien.
   clavesReglas: palabras clave de las respuestas automáticas del servicio. */
export function validarCodigos(
  codigos: { codigoDemo: string; codigoDemoAdultos: string; codigoDemoSinAdultos: string },
  clavesReglas: string[],
): string | null {
  const lista = [
    { nombre: "Código de demo",             valor: codigos.codigoDemo },
    { nombre: "Código demo con adultos",    valor: codigos.codigoDemoAdultos },
    { nombre: "Código demo sin adultos",    valor: codigos.codigoDemoSinAdultos },
  ]
  const vistos = new Set<string>()
  for (const { nombre, valor } of lista) {
    const c = normalizarCodigo(valor)
    if (!c) return `${nombre}: no puede estar vacío`
    if (c.includes(",")) return `${nombre}: no puede tener comas`
    if (RESERVADOS.includes(c) || c.startsWith("u:") || c.startsWith("."))
      return `${nombre}: "${valor.trim()}" ya lo usa el bot como comando`
    if (vistos.has(c)) return `Los tres códigos de demo deben ser distintos ("${valor.trim()}" se repite)`
    if (clavesReglas.includes(c)) return `${nombre}: "${valor.trim()}" ya es palabra clave de una respuesta automática`
    vistos.add(c)
  }
  return null
}
