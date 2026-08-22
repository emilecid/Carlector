import type { FragmentoLectura } from "./modelos.ts";

export interface PasoRsvp {
  indice: number;
  inicio_ms: number;
}

export function indices_locuciones_adelantadas(fragmentos: FragmentoLectura[], inicio: number, cantidad: number): number[] {
  if (cantidad <= 0) return [];
  const indices: number[] = [];
  for (let indice = Math.max(0, inicio); indice < fragmentos.length && indices.length < cantidad; indice += 1) {
    if (fragmentos[indice]?.locucion !== null) indices.push(indice);
  }
  return indices;
}

export function calcular_plan_rsvp(unidades: string[], duracion_ms: number): PasoRsvp[] {
  if (!unidades.length || !Number.isFinite(duracion_ms) || duracion_ms <= 0) return [];
  const pesos = unidades.map((unidad) => {
    const palabras = Math.max(1, unidad.trim().split(/\s+/u).filter(Boolean).length);
    const pausa = /[.!?…][”’"')\]]*$/u.test(unidad.trim()) ? 1.5 : /[,;:]$/u.test(unidad.trim()) ? 1.2 : 1;
    return palabras * pausa;
  });
  const total = pesos.reduce((suma, peso) => suma + peso, 0);
  let acumulado = 0;
  return unidades.map((_, indice) => {
    const paso = { indice, inicio_ms: Math.round(acumulado / total * duracion_ms) };
    acumulado += pesos[indice] ?? 0;
    return paso;
  });
}
