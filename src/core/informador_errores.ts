export interface InformeError {
  contexto: string;
  detalle: string;
  fecha: string;
}

export function crear_informe_error(contexto: string, error: unknown, ahora = new Date()): InformeError {
  const detalle = error instanceof Error ? error.message : String(error || "Error desconocido");
  return { contexto: contexto.trim() || "Carlector", detalle, fecha: ahora.toISOString() };
}
