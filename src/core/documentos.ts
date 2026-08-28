import type { EntradaIndice, EstructuraDocumento, TipoFragmento } from "./modelos.ts";
import { normalizar_texto_pdf, type CambioNormalizacionPdf } from "./limpieza_pdf.ts";

const PATRON_SIMBOLOS_MATEMATICOS = /[=≈≠≤≥∑∫√∞∂∇±×÷^_{}()[\]|]/g;
const PATRON_FUENTE_MATEMATICA = /(?:math|symbol|cmr|cmmi|cmsy|msam|msbm|stix)/i;

export interface BloqueDocumento {
  id: string;
  contenido: string;
  contenido_original?: string;
  normalizaciones?: CambioNormalizacionPdf[];
  tipo: TipoFragmento;
  pagina?: number;
  estructura?: EstructuraDocumento;
  nivel?: number;
  tamano_relativo?: number;
  alineacion?: "left" | "center" | "right" | "justify";
  inicio_fuente?: number;
  fin_fuente?: number;
}

export function crear_bloque_pdf(id: string, pagina: number, contenido_original: string, fuentes: string[]): BloqueDocumento {
  const normalizado = normalizar_texto_pdf(contenido_original);
  const fue_modificado = normalizado.texto !== contenido_original;
  return {
    id,
    contenido: normalizado.texto,
    contenido_original: fue_modificado ? contenido_original : undefined,
    normalizaciones: fue_modificado ? normalizado.cambios : undefined,
    tipo: clasificar_linea_pdf(normalizado.texto, fuentes),
    pagina,
  };
}

export interface DocumentoProcesado {
  titulo: string;
  autor: string;
  idioma: string;
  formato: "PDF" | "EPUB" | "MARKDOWN";
  bloques: BloqueDocumento[];
  indice: EntradaIndice[];
  portada?: string;
  total_paginas?: number;
  version_cache?: number;
}

export function clasificar_linea_pdf(texto: string, fuentes: string[]): TipoFragmento {
  const linea = texto.trim();
  if (!linea) return "texto";
  const cantidad_simbolos = (linea.match(PATRON_SIMBOLOS_MATEMATICOS) ?? []).length;
  const cantidad_palabras = (linea.match(/\p{L}{3,}/gu) ?? []).length;
  const usa_fuente_matematica = fuentes.some((fuente) => PATRON_FUENTE_MATEMATICA.test(fuente));
  const densidad_matematica = cantidad_simbolos / Math.max(linea.length, 1);
  if (usa_fuente_matematica && cantidad_simbolos >= 1) return "matematica";
  if (cantidad_simbolos >= 3 && densidad_matematica >= 0.08) return "matematica";
  if (cantidad_simbolos >= 2 && cantidad_simbolos >= cantidad_palabras) return "matematica";
  return "texto";
}

export function convertir_bloques_a_texto(bloques: BloqueDocumento[]): string {
  return bloques.map((bloque) => {
    if (bloque.tipo !== "matematica") return bloque.contenido;
    return /^<math[\s>]/i.test(bloque.contenido.trim()) ? bloque.contenido : `$$${bloque.contenido}$$`;
  }).join("\n\n");
}
