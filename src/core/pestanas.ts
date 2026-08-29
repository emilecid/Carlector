export interface SesionPestanas {
  abiertas: string[];
  activa: string | null;
}

export interface SesionDivision {
  documentos: string[];
  proporciones: number[];
  orientacion: OrientacionMosaico;
}

export type OrientacionMosaico = "horizontal" | "vertical";
export type ZonaAcoplamiento = "izquierda" | "derecha" | "arriba" | "abajo";

export interface ResultadoAcoplamiento {
  activo: string | null;
  division: SesionDivision;
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
    orientacion: sesion.orientacion === "vertical" ? "vertical" : "horizontal",
  };
}

export function acoplar_documento(
  sesion: Partial<SesionDivision>,
  id_documento: string,
  activo: string | null,
  zona: ZonaAcoplamiento,
  disponibles: Set<string>,
  proporcion_destino?: number,
): ResultadoAcoplamiento {
  const division_actual = normalizar_sesion_division(sesion, activo, disponibles);
  if (!activo || id_documento === activo || !disponibles.has(id_documento)) return { activo, division: division_actual };
  const antes = zona === "izquierda" || zona === "arriba";
  const nuevo_activo = antes ? id_documento : activo;
  const restantes = division_actual.documentos.filter((id) => id !== id_documento);
  const documentos = (antes ? [activo, ...restantes] : [...restantes, id_documento]).slice(0, 2);
  const cantidad = documentos.length + 1;
  const indice_destino = antes ? 0 : cantidad - 1;
  return {
    activo: nuevo_activo,
    division: {
      documentos,
      proporciones: Number.isFinite(proporcion_destino)
        ? distribuir_proporcion_destino(cantidad, indice_destino, proporcion_destino as number)
        : proporciones_uniformes(cantidad),
      orientacion: zona === "arriba" || zona === "abajo" ? "vertical" : "horizontal",
    },
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

function distribuir_proporcion_destino(cantidad: number, indice_destino: number, proporcion_destino: number): number[] {
  if (cantidad < 2) return cantidad === 1 ? [100] : [];
  const minimo = 15;
  const maximo = 100 - minimo * (cantidad - 1);
  const destino = Math.min(maximo, Math.max(minimo, proporcion_destino));
  const restantes = proporciones_uniformes(cantidad - 1).map((valor) => valor * (100 - destino) / 100);
  const resultado = Array.from({ length: cantidad }, () => 0);
  let indice_restante = 0;
  resultado.forEach((_, indice) => {
    resultado[indice] = indice === indice_destino ? destino : restantes[indice_restante++] ?? minimo;
  });
  return normalizar_proporciones(resultado);
}
