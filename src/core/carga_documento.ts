export interface LoteRenderizado {
  inicio: number;
  fin: number;
  progreso: number;
}

export interface VentanaRenderizado {
  inicio: number;
  fin: number;
}

export function calcular_ventana_renderizado(total: number, indice_activo: number, tamano_ventana: number): VentanaRenderizado {
  if (tamano_ventana <= 0) throw new Error("El tamaño de la ventana debe ser mayor que cero.");
  if (total <= tamano_ventana) return { inicio: 0, fin: Math.max(0, total) };
  const indice = Math.min(total - 1, Math.max(0, indice_activo));
  const inicio = Math.min(total - tamano_ventana, Math.max(0, indice - Math.floor(tamano_ventana / 2)));
  return { inicio, fin: inicio + tamano_ventana };
}

export function crear_lotes_renderizado(total: number, tamano_lote: number): LoteRenderizado[] {
  if (tamano_lote <= 0) throw new Error("El tamaño del lote debe ser mayor que cero.");
  if (total <= 0) return [];
  const lotes: LoteRenderizado[] = [];
  for (let inicio = 0; inicio < total; inicio += tamano_lote) {
    const fin = Math.min(total, inicio + tamano_lote);
    lotes.push({ inicio, fin, progreso: Math.round((fin / total) * 100) });
  }
  return lotes;
}
