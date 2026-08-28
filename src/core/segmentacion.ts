import type { FragmentoLectura, PoliticaMatematica, TipoFragmento } from "./modelos";
import type { BloqueDocumento } from "./documentos.ts";

const PATRON_MATEMATICA_BLOQUE = /(?:\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|<math[\s\S]+?<\/math>)/gi;
const PATRON_MATEMATICA_TEXTO = /(?:\$[^$\n]+\$|\\\([^\n]+?\\\))/gi;
const PATRON_CITA_NUMERICA = /\[\s*\d+[a-z]?(?:\s*[-–,;]\s*\d+[a-z]?)*\s*\]/giu;
const PATRON_CITA_AUTOR_FECHA = /\((?=[^()]{0,600},\s*(?:1[5-9]|20)\d{2}[a-z]?\b)(?=[^()]{0,600}\p{L})[^()]+\)/giu;
const ABREVIATURAS = new Set(["aprox", "art", "arts", "cap", "dr", "dra", "ej", "etc", "fig", "no", "num", "pag", "pags", "prof", "sr", "sra", "srta", "ud", "uds", "vol"]);

export interface OpcionesSegmentacion { saltar_citas?: boolean }
const OPCIONES_PREDETERMINADAS: OpcionesSegmentacion = { saltar_citas: false };

function es_punto_interno(texto: string, indice: number): boolean {
  const anterior = texto[indice - 1] ?? "";
  const siguiente = texto[indice + 1] ?? "";
  if (/\d/u.test(anterior) && /\d/u.test(siguiente)) return true;
  if (/\p{L}/u.test(anterior) && /\p{L}/u.test(siguiente)) return true;
  const palabra = texto.slice(0, indice).match(/([\p{L}]+)$/u)?.[1]?.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("es") ?? "";
  if (ABREVIATURAS.has(palabra)) return true;
  const siguiente_visible = texto.slice(indice + 1).trimStart()[0] ?? "";
  return palabra.length === 1 && /\p{Lu}/u.test(siguiente_visible);
}

function dividir_parrafo_por_puntuacion(texto: string): string[] {
  const unidades: string[] = [];
  let inicio = 0;
  let profundidad_parentesis = 0;
  let profundidad_corchetes = 0;
  for (let indice = 0; indice < texto.length; indice += 1) {
    const caracter = texto[indice] ?? "";
    if (caracter === "(") profundidad_parentesis += 1;
    else if (caracter === ")") profundidad_parentesis = Math.max(0, profundidad_parentesis - 1);
    else if (caracter === "[") profundidad_corchetes += 1;
    else if (caracter === "]") profundidad_corchetes = Math.max(0, profundidad_corchetes - 1);
    if (!/[,;:.]/u.test(caracter)) continue;
    if (profundidad_parentesis > 0 || profundidad_corchetes > 0) continue;
    if (caracter === "." && es_punto_interno(texto, indice)) continue;
    let fin = indice + 1;
    while (texto[fin] === ".") fin += 1;
    while (/[”’"')\]]/u.test(texto[fin] ?? "")) fin += 1;
    const unidad = texto.slice(inicio, fin).trim();
    if (unidad) unidades.push(unidad);
    inicio = fin;
    indice = fin - 1;
  }
  const restante = texto.slice(inicio).trim();
  if (restante) unidades.push(restante);
  return unidades;
}

function dividir_por_puntuacion(texto: string): string[] {
  return texto.split(/\n\s*\n/u).flatMap(dividir_parrafo_por_puntuacion);
}

function esMatematicaHeuristica(texto: string): boolean {
  const limpio = texto.trim();
  if (!limpio) return false;
  if (/^(?:\$\$|\\\[|<math)/i.test(limpio)) return true;
  const simbolos = (limpio.match(/[=≈≠≤≥∑∫√∞∂∇^_{}]/g) ?? []).length;
  const palabras = (limpio.match(/\p{L}{2,}/gu) ?? []).length;
  return simbolos >= 2 && simbolos >= palabras;
}

function quitar_citas_bibliograficas(texto: string): string {
  return texto
    .replace(PATRON_CITA_AUTOR_FECHA, " ")
    .replace(PATRON_CITA_NUMERICA, " ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

export function texto_para_locucion(
  visible: string,
  tipo: TipoFragmento,
  politica: PoliticaMatematica,
  saltar_citas = false,
): string | null {
  if (tipo !== "matematica") {
    const texto = saltar_citas ? quitar_citas_bibliograficas(visible) : visible.trim();
    return /[\p{L}\p{N}]/u.test(texto) ? texto : null;
  }
  if (politica === "omitir") return null;
  if (politica === "indicar") return "Ecuación.";
  return visible.replace(PATRON_MATEMATICA_BLOQUE, " ").replace(PATRON_MATEMATICA_TEXTO, " ").trim() || visible.trim();
}

export function segmentar_texto(texto: string, politica: PoliticaMatematica, opciones: OpcionesSegmentacion = OPCIONES_PREDETERMINADAS): FragmentoLectura[] {
  const normalizado = texto.replace(/\r\n?/g, "\n").trim();
  if (!normalizado) return [];

  const bloques: Array<{ texto: string; tipo: TipoFragmento }> = [];
  let cursor = 0;
  for (const coincidencia of normalizado.matchAll(PATRON_MATEMATICA_BLOQUE)) {
    const inicio = coincidencia.index ?? 0;
    if (inicio > cursor) bloques.push({ texto: normalizado.slice(cursor, inicio), tipo: "texto" });
    bloques.push({ texto: coincidencia[0], tipo: "matematica" });
    cursor = inicio + coincidencia[0].length;
  }
  if (cursor < normalizado.length) bloques.push({ texto: normalizado.slice(cursor), tipo: "texto" });

  const fragmentos: FragmentoLectura[] = [];
  for (const bloque of bloques) {
    const unidades = bloque.tipo === "matematica" ? [bloque.texto] : dividir_por_puntuacion(bloque.texto);
    for (const visible of unidades) {
      const tipo = bloque.tipo === "matematica" || esMatematicaHeuristica(visible) ? "matematica" : "texto";
      fragmentos.push({
        id: `fragmento-${fragmentos.length}`,
        visible,
        tipo,
        locucion: texto_para_locucion(visible, tipo, politica, opciones.saltar_citas),
      });
    }
  }
  return fragmentos;
}

export function segmentar_bloques(bloques: BloqueDocumento[], politica: PoliticaMatematica, opciones: OpcionesSegmentacion = OPCIONES_PREDETERMINADAS): FragmentoLectura[] {
  const resultado: FragmentoLectura[] = [];
  for (const bloque of bloques) {
    const omitir_referencia = opciones.saltar_citas === true && bloque.estructura === "referencia";
    const lineas = bloque.tipo === "matematica" ? [bloque.contenido] : bloque.contenido.split("\n");
    const fragmentos_bloque = bloque.estructura === "preformateado"
      ? lineas.map((linea, indice_linea): FragmentoLectura => ({ id: "", visible: linea || " ", tipo: "texto", locucion: texto_para_locucion(linea, "texto", politica), salto_linea_antes: indice_linea > 0 }))
      : lineas.flatMap((linea, indice_linea) => segmentar_texto(linea, politica, opciones).map((fragmento, indice_en_linea) => ({
        ...fragmento,
        locucion: omitir_referencia ? null : fragmento.locucion,
        salto_linea_antes: indice_linea > 0 && indice_en_linea === 0,
      })));
    let cursor_ancla = 0;
    fragmentos_bloque.forEach((fragmento, indice) => {
      const texto_ancla = fragmento.visible === " " ? "" : fragmento.visible;
      const inicio_encontrado = texto_ancla ? bloque.contenido.indexOf(texto_ancla, cursor_ancla) : cursor_ancla;
      const inicio_ancla = inicio_encontrado >= 0 ? inicio_encontrado : cursor_ancla;
      const fin_ancla = inicio_ancla + texto_ancla.length;
      cursor_ancla = fin_ancla;
      resultado.push({
      ...fragmento,
      id: `fragmento-${resultado.length}`,
      pagina: bloque.pagina,
      bloque_id: bloque.id,
      estructura: bloque.estructura ?? (bloque.tipo === "matematica" ? "matematica" : bloque.tipo === "tabla" ? "tabla" : "parrafo"),
      nivel: bloque.nivel,
      tamano_relativo: bloque.tamano_relativo,
      alineacion: bloque.alineacion,
      inicio_bloque: indice === 0,
      fin_bloque: indice === fragmentos_bloque.length - 1,
      ancla: { bloque_id: bloque.id, inicio: inicio_ancla, fin: fin_ancla },
    });
    });
  }
  return resultado;
}
