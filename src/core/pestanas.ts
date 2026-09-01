export interface SesionPestanas {
  abiertas: string[];
  activa: string | null;
}

export interface SesionDivision {
  documentos: string[];
  proporciones: number[];
}

export const MAX_DOCUMENTOS_MOSAICO = 3;

export interface ResultadoAlternanciaMosaico {
  division: SesionDivision;
  limite_alcanzado: boolean;
}

export function abrir_pestana(sesion: SesionPestanas, id_documento: string): SesionPestanas {
  const abiertas = sesion.abiertas.includes(id_documento) ? [...sesion.abiertas] : [...sesion.abiertas, id_documento];
  return { abiertas, activa: id_documento };
}

export function cerrar_pestana(sesion: SesionPestanas, id_documento: string): SesionPestanas {
  const indice = sesion.abiertas.indexOf(id_documento);
  if (indice < 0) return { abiertas: [...sesion.abiertas], activa: sesion.activa };
  const abiertas = sesion.abiertas.filter((id) => id !== id_documento);
  if (sesion.activa !== id_documento) return { abiertas, activa: sesion.activa };
  return { abiertas, activa: abiertas[Math.min(indice, abiertas.length - 1)] ?? null };
}

export function normalizar_sesion_pestanas(sesion: SesionPestanas, ids_disponibles: Set<string>): SesionPestanas {
  const abiertas = [...new Set(sesion.abiertas)].filter((id) => ids_disponibles.has(id));
  const activa = sesion.activa && abiertas.includes(sesion.activa) ? sesion.activa : abiertas[0] ?? null;
  return { abiertas, activa };
}

export function normalizar_documentos_divididos(ids: string[], activo: string | null, disponibles: Set<string>): string[] {
  return [...new Set(ids)].filter((id) => id !== activo && disponibles.has(id)).slice(0, 2);
}

export function normalizar_sesion_division(sesion: Partial<SesionDivision>, activo: string | null, disponibles: Set<string>): SesionDivision {
  const documentos = normalizar_documentos_divididos(sesion.documentos ?? [], activo, disponibles);
  const cantidad = documentos.length + (activo ? 1 : 0);
  const proporciones = sesion.proporciones?.length === cantidad
    ? normalizar_proporciones(sesion.proporciones)
    : proporciones_uniformes(cantidad);
  return {
    documentos,
    proporciones,
  };
}

export function alternar_documento_mosaico(
  sesion: Partial<SesionDivision>,
  id_documento: string,
  activo: string | null,
  disponibles: Set<string>,
): ResultadoAlternanciaMosaico {
  const division_actual = normalizar_sesion_division(sesion, activo, disponibles);
  if (!activo || id_documento === activo || !disponibles.has(id_documento)) {
    return { division: division_actual, limite_alcanzado: false };
  }
  if (division_actual.documentos.includes(id_documento)) {
    const documentos = division_actual.documentos.filter((id) => id !== id_documento);
    return {
      division: { documentos, proporciones: proporciones_uniformes(documentos.length + 1) },
      limite_alcanzado: false,
    };
  }
  if (division_actual.documentos.length + 1 >= MAX_DOCUMENTOS_MOSAICO) {
    return { division: division_actual, limite_alcanzado: true };
  }
  const documentos = [...division_actual.documentos, id_documento];
  return {
    division: { documentos, proporciones: proporciones_uniformes(documentos.length + 1) },
    limite_alcanzado: false,
  };
}

export function ajustar_proporciones_paneles(proporciones: number[], divisor: number, cambio: number, minimo = 15): number[] {
  if (divisor < 0 || divisor >= proporciones.length - 1 || !Number.isFinite(cambio)) return [...proporciones];
  const resultado = [...proporciones];
  const izquierda = resultado[divisor] ?? 0;
  const derecha = resultado[divisor + 1] ?? 0;
  const aplicado = Math.min(derecha - minimo, Math.max(minimo - izquierda, cambio));
  resultado[divisor] = Math.round((izquierda + aplicado) * 100) / 100;
  resultado[divisor + 1] = Math.round((derecha - aplicado) * 100) / 100;
  return resultado;
}

export function proporciones_uniformes(cantidad: number): number[] {
  if (!Number.isInteger(cantidad) || cantidad < 1) return [];
  const base = Math.floor(10_000 / cantidad) / 100;
  return Array.from({ length: cantidad }, (_, indice) => indice === cantidad - 1 ? Math.round((100 - base * (cantidad - 1)) * 100) / 100 : base);
}

function normalizar_proporciones(proporciones: number[]): number[] {
  if (proporciones.some((valor) => !Number.isFinite(valor) || valor <= 0)) return proporciones_uniformes(proporciones.length);
  const total = proporciones.reduce((suma, valor) => suma + valor, 0);
  if (total <= 0) return proporciones_uniformes(proporciones.length);
  const normalizadas = proporciones.map((valor) => Math.round((valor / total) * 10_000) / 100);
  normalizadas[normalizadas.length - 1] = Math.round((100 - normalizadas.slice(0, -1).reduce((suma, valor) => suma + valor, 0)) * 100) / 100;
  return normalizadas;
}
