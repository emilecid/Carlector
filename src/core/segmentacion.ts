import type { FragmentoLectura, PoliticaMatematica, TipoFragmento } from "./modelos";
import type { BloqueDocumento } from "./documentos.ts";

const PATRON_MATEMATICA_BLOQUE = /(?:\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|<math[\s\S]+?<\/math>)/gi;
const PATRON_MATEMATICA_TEXTO = /(?:\$[^$\n]+\$|\\\([^\n]+?\\\))/gi;
const PATRON_ORACION = /[^.!?…]+(?:[.!?…]+[”’"')\]]*|$)/gu;
const PALABRAS_POR_FRAGMENTO = 5;

export type EstrategiaSegmentacion = "cinco_palabras" | "puntuacion";
export interface OpcionesSegmentacion { estrategia: EstrategiaSegmentacion; maximo_palabras: number }
const OPCIONES_PREDETERMINADAS: OpcionesSegmentacion = { estrategia: "cinco_palabras", maximo_palabras: 12 };

function dividir_oracion(oracion: string): string[] {
  const palabras = oracion.trim().split(/\s+/u).filter(Boolean);
  const grupos: string[] = [];
  for (let indice = 0; indice < palabras.length; indice += PALABRAS_POR_FRAGMENTO) {
    grupos.push(palabras.slice(indice, indice + PALABRAS_POR_FRAGMENTO).join(" "));
  }
  return grupos;
}

function dividir_limite_palabras(texto: string, maximo: number): string[] {
  const palabras = texto.trim().split(/\s+/u).filter(Boolean);
  const grupos: string[] = [];
  for (let indice = 0; indice < palabras.length; indice += maximo) grupos.push(palabras.slice(indice, indice + maximo).join(" "));
  return grupos;
}

function dividir_por_puntuacion(texto: string, maximo_palabras: number): string[] {
  const unidades: string[] = [];
  let inicio = 0;
  for (let indice = 0; indice < texto.length; indice += 1) {
    const caracter = texto[indice] ?? "";
    if (!/[,;:.!?…]/u.test(caracter)) continue;
    if (caracter === "." && /\d/u.test(texto[indice - 1] ?? "") && /\d/u.test(texto[indice + 1] ?? "")) continue;
    const unidad = texto.slice(inicio, indice + 1).trim();
    if (unidad) unidades.push(...dividir_limite_palabras(unidad, maximo_palabras));
    inicio = indice + 1;
  }
  const restante = texto.slice(inicio).trim();
  if (restante) unidades.push(...dividir_limite_palabras(restante, maximo_palabras));
  return unidades;
}

function esMatematicaHeuristica(texto: string): boolean {
  const limpio = texto.trim();
  if (!limpio) return false;
  if (/^(?:\$\$|\\\[|<math)/i.test(limpio)) return true;
  const simbolos = (limpio.match(/[=≈≠≤≥∑∫√∞∂∇^_{}]/g) ?? []).length;
  const palabras = (limpio.match(/\p{L}{2,}/gu) ?? []).length;
  return simbolos >= 2 && simbolos >= palabras;
}

export function texto_para_locucion(
  visible: string,
  tipo: TipoFragmento,
  politica: PoliticaMatematica,
): string | null {
  if (tipo !== "matematica") return visible.trim() || null;
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
    const unidades = bloque.tipo === "matematica" ? [bloque.texto] : opciones.estrategia === "puntuacion"
      ? dividir_por_puntuacion(bloque.texto, Math.max(1, opciones.maximo_palabras))
      : (bloque.texto.match(PATRON_ORACION) ?? []).flatMap(dividir_oracion).filter(Boolean);
    for (const visible of unidades) {
      const tipo = bloque.tipo === "matematica" || esMatematicaHeuristica(visible) ? "matematica" : "texto";
      fragmentos.push({
        id: `fragmento-${fragmentos.length}`,
        visible,
        tipo,
        locucion: texto_para_locucion(visible, tipo, politica),
      });
    }
  }
  return fragmentos;
}

export function segmentar_bloques(bloques: BloqueDocumento[], politica: PoliticaMatematica, opciones: OpcionesSegmentacion = OPCIONES_PREDETERMINADAS): FragmentoLectura[] {
  const resultado: FragmentoLectura[] = [];
  for (const bloque of bloques) {
    const lineas = bloque.tipo === "matematica" ? [bloque.contenido] : bloque.contenido.split("\n");
    const fragmentos_bloque = bloque.estructura === "preformateado"
      ? lineas.map((linea, indice_linea): FragmentoLectura => ({ id: "", visible: linea || " ", tipo: "texto", locucion: linea.trim() || null, salto_linea_antes: indice_linea > 0 }))
      : lineas.flatMap((linea, indice_linea) => segmentar_texto(linea, politica, opciones).map((fragmento, indice_en_linea) => ({
        ...fragmento,
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
