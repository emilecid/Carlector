import type { AnclaLectura, FragmentoLectura, PartePdfLectura, PoliticaMatematica, TipoFragmento, UnidadLectura } from "./modelos";
import type { BloqueDocumento } from "./documentos.ts";

const PATRON_MATEMATICA_BLOQUE = /(?:\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|<math[\s\S]+?<\/math>)/gi;
const PATRON_MATEMATICA_TEXTO = /(?:\$[^$\n]+\$|\\\([^\n]+?\\\))/gi;
const PATRON_CITA_NUMERICA = /\[\s*\d+[a-z]?(?:\s*[-–,;]\s*\d+[a-z]?)*\s*\]/giu;
const PATRON_CITA_AUTOR_FECHA = /\((?=[^()]{0,600},\s*(?:1[5-9]|20)\d{2}[a-z]?\b)(?=[^()]{0,600}\p{L})[^()]+\)/giu;
const ABREVIATURAS = new Set(["aprox", "art", "arts", "cap", "dr", "dra", "ej", "etc", "fig", "no", "num", "pag", "pags", "prof", "sr", "sra", "srta", "ud", "uds", "vol"]);
const NOMBRES_COMANDOS_MATEMATICOS: Record<string, string> = {
  alpha: "alfa", beta: "beta", gamma: "gamma", delta: "delta", epsilon: "épsilon", theta: "theta",
  lambda: "lambda", mu: "mu", pi: "pi", rho: "rho", sigma: "sigma", phi: "fi", chi: "ji", psi: "psi", omega: "omega",
  sum: "sumatoria", prod: "productoria", int: "integral", partial: "derivada parcial", infty: "infinito",
  times: "por", cdot: "por", div: "dividido por", pm: "más menos", leq: "menor o igual", geq: "mayor o igual",
  neq: "distinto de", approx: "aproximadamente", to: "tiende a", rightarrow: "implica",
};
const NOMBRES_SIMBOLOS_MATEMATICOS: Record<string, string> = {
  "=": "igual", "+": "más", "-": "menos", "−": "menos", "×": "por", "÷": "dividido por", "/": "dividido por",
  "≤": "menor o igual", "≥": "mayor o igual", "≠": "distinto de", "≈": "aproximadamente", "±": "más menos",
  "∑": "sumatoria", "∏": "productoria", "∫": "integral", "√": "raíz cuadrada de", "∞": "infinito", "∂": "derivada parcial",
  "α": "alfa", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "épsilon", "θ": "theta", "λ": "lambda",
  "μ": "mu", "π": "pi", "ρ": "rho", "σ": "sigma", "φ": "fi", "χ": "ji", "ψ": "psi", "ω": "omega",
};

export interface OpcionesSegmentacion { saltar_citas?: boolean }
const OPCIONES_PREDETERMINADAS: OpcionesSegmentacion = { saltar_citas: false };

export interface TramoTextoCanonico {
  inicio: number;
  fin: number;
  inicio_fuente: number;
  fin_fuente: number;
}

export interface TextoLecturaCanonico {
  original: string;
  texto: string;
  tramos: TramoTextoCanonico[];
}

export interface UnidadPalabraLectura {
  texto: string;
  inicio: number;
  fin: number;
  inicio_fuente: number;
  fin_fuente: number;
}

interface TokenFuente {
  texto: string;
  inicio: number;
  fin: number;
}

const PATRON_CIERRE_SEPARADO = /^[.,;:!?…%)\]}»”’]+$/u;
const PATRON_APERTURA_SEPARADA = /^(?:[¿¡([{«“‘]+|[$#])$/u;

type RolComilla = "apertura" | "cierre" | null;

function roles_comillas(tokens: TokenFuente[]): RolComilla[] {
  const abiertas = new Map<string, boolean>();
  return tokens.map(({ texto }) => {
    if (texto !== '"' && texto !== "'") return null;
    const abierta = abiertas.get(texto) ?? false;
    abiertas.set(texto, !abierta);
    return abierta ? "cierre" : "apertura";
  });
}

function unir_tokens_separados(anterior: TokenFuente, actual: TokenFuente, rol_anterior: RolComilla, rol_actual: RolComilla): boolean {
  if (PATRON_CIERRE_SEPARADO.test(actual.texto)) return true;
  if (rol_actual === "cierre" || rol_anterior === "apertura") return true;
  if (rol_actual === "apertura" || rol_anterior === "cierre") return false;
  if (!PATRON_APERTURA_SEPARADA.test(anterior.texto)) return false;
  if (anterior.texto === "$" || anterior.texto === "#") return /^[\p{L}\p{N}]/u.test(actual.texto);
  return true;
}

export function normalizar_texto_lectura(original: string): TextoLecturaCanonico {
  const tokens = [...original.matchAll(/\S+/gu)].map((coincidencia): TokenFuente => ({
    texto: coincidencia[0].normalize("NFC"),
    inicio: coincidencia.index ?? 0,
    fin: (coincidencia.index ?? 0) + coincidencia[0].length,
  }));
  if (!tokens.length) return { original, texto: "", tramos: [] };
  const roles = roles_comillas(tokens);

  let texto = "";
  const tramos: TramoTextoCanonico[] = [];
  tokens.forEach((token, indice) => {
    const anterior = tokens[indice - 1];
    if (anterior && !unir_tokens_separados(anterior, token, roles[indice - 1] ?? null, roles[indice] ?? null)) {
      const separador_fuente = original.slice(anterior.fin, token.inicio);
      const separador = /\n[^\S\n]*\n/u.test(separador_fuente.replace(/\r\n?/gu, "\n")) ? "\n\n" : " ";
      const inicio = texto.length;
      texto += separador;
      tramos.push({ inicio, fin: texto.length, inicio_fuente: anterior.fin, fin_fuente: token.inicio });
    }
    const inicio = texto.length;
    texto += token.texto;
    tramos.push({ inicio, fin: texto.length, inicio_fuente: token.inicio, fin_fuente: token.fin });
  });
  return { original, texto, tramos };
}

function rango_fuente(canonico: TextoLecturaCanonico, inicio: number, fin: number): { inicio: number; fin: number } {
  const solapados = canonico.tramos.filter((tramo) => tramo.fin > inicio && tramo.inicio < fin);
  return {
    inicio: solapados[0]?.inicio_fuente ?? 0,
    fin: solapados.at(-1)?.fin_fuente ?? 0,
  };
}

export function segmentar_palabras_lectura(original: string): UnidadPalabraLectura[] {
  const canonico = normalizar_texto_lectura(original);
  const unidades = [...canonico.texto.matchAll(/\S+/gu)].map((coincidencia): UnidadPalabraLectura => {
    const inicio = coincidencia.index ?? 0;
    const fin = inicio + coincidencia[0].length;
    const fuente = rango_fuente(canonico, inicio, fin);
    return { texto: coincidencia[0], inicio, fin, inicio_fuente: fuente.inicio, fin_fuente: fuente.fin };
  });
  const resultado: UnidadPalabraLectura[] = [];
  let prefijo: UnidadPalabraLectura | null = null;
  for (const unidad of unidades) {
    if (/[\p{L}\p{N}]/u.test(unidad.texto)) {
      if (prefijo) {
        unidad.texto = prefijo.texto + unidad.texto;
        unidad.inicio = prefijo.inicio;
        unidad.inicio_fuente = prefijo.inicio_fuente;
        prefijo = null;
      }
      resultado.push(unidad);
      continue;
    }
    const anterior = resultado.at(-1);
    if (anterior) {
      anterior.texto += unidad.texto;
      anterior.fin = unidad.fin;
      anterior.fin_fuente = unidad.fin_fuente;
    } else if (prefijo === null) prefijo = { ...unidad };
    else {
      prefijo.texto += unidad.texto;
      prefijo.fin = unidad.fin;
      prefijo.fin_fuente = unidad.fin_fuente;
    }
  }
  return resultado;
}

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

interface RangoTextoSegmentado {
  texto: string;
  inicio: number;
  fin: number;
}

function agregar_rango_texto(unidades: RangoTextoSegmentado[], texto: string, inicio: number, fin: number): void {
  while (inicio < fin && /\s/u.test(texto[inicio] ?? "")) inicio += 1;
  while (fin > inicio && /\s/u.test(texto[fin - 1] ?? "")) fin -= 1;
  if (inicio < fin) unidades.push({ texto: texto.slice(inicio, fin), inicio, fin });
}

function dividir_por_puntuacion(texto: string): RangoTextoSegmentado[] {
  const unidades: RangoTextoSegmentado[] = [];
  let inicio = 0;
  let profundidad_parentesis = 0;
  let profundidad_corchetes = 0;
  for (let indice = 0; indice < texto.length; indice += 1) {
    const caracter = texto[indice] ?? "";
    if (caracter === "(") profundidad_parentesis += 1;
    else if (caracter === ")") profundidad_parentesis = Math.max(0, profundidad_parentesis - 1);
    else if (caracter === "[") profundidad_corchetes += 1;
    else if (caracter === "]") profundidad_corchetes = Math.max(0, profundidad_corchetes - 1);
    if (caracter === "\n" && texto[indice + 1] === "\n") {
      agregar_rango_texto(unidades, texto, inicio, indice);
      while (texto[indice + 1] === "\n") indice += 1;
      inicio = indice + 1;
      continue;
    }
    if (!/[.!?…]/u.test(caracter)) continue;
    if (profundidad_parentesis > 0 || profundidad_corchetes > 0) continue;
    if (caracter === "." && es_punto_interno(texto, indice)) continue;
    let fin = indice + 1;
    while (/[.!?…]/u.test(texto[fin] ?? "")) fin += 1;
    while (/[»”’"')\]}]/u.test(texto[fin] ?? "")) fin += 1;
    agregar_rango_texto(unidades, texto, inicio, fin);
    inicio = fin;
    indice = fin - 1;
  }
  agregar_rango_texto(unidades, texto, inicio, texto.length);
  return unidades;
}

function esMatematicaHeuristica(texto: string): boolean {
  const limpio = texto.trim();
  if (!limpio) return false;
  if (/^(?:\$\$|\$|\\\[|\\\(|<math)/i.test(limpio) && /(?:\$\$|\$|\\\]|\\\)|<\/math>)$/i.test(limpio)) return true;
  const sin_matematica_en_linea = limpio.replace(PATRON_MATEMATICA_TEXTO, " ");
  if (sin_matematica_en_linea !== limpio && /\p{L}{2,}/u.test(sin_matematica_en_linea)) return false;
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

function extraer_grupo_tex(texto: string, inicio: number): { contenido: string; fin: number } | null {
  if (texto[inicio] !== "{") return null;
  let profundidad = 0;
  for (let indice = inicio; indice < texto.length; indice += 1) {
    if (texto[indice] === "{") profundidad += 1;
    else if (texto[indice] === "}") profundidad -= 1;
    if (profundidad === 0) return { contenido: texto.slice(inicio + 1, indice), fin: indice + 1 };
  }
  return null;
}

function sustituir_fracciones_tex(texto: string): string {
  let resultado = texto;
  let inicio = resultado.search(/\\(?:d|t)?frac\s*\{/u);
  while (inicio >= 0) {
    const llave_numerador = resultado.indexOf("{", inicio);
    const numerador = extraer_grupo_tex(resultado, llave_numerador);
    const llave_denominador = numerador ? resultado.slice(numerador.fin).search(/\S/u) + numerador.fin : -1;
    const denominador = numerador && llave_denominador >= numerador.fin ? extraer_grupo_tex(resultado, llave_denominador) : null;
    if (!numerador || !denominador) break;
    const reemplazo = ` fracción ${sustituir_fracciones_tex(numerador.contenido)} sobre ${sustituir_fracciones_tex(denominador.contenido)} `;
    resultado = resultado.slice(0, inicio) + reemplazo + resultado.slice(denominador.fin);
    inicio = resultado.search(/\\(?:d|t)?frac\s*\{/u);
  }
  return resultado;
}

interface NodoMathml {
  nombre: string;
  texto: string;
  hijos: NodoMathml[];
}

function contenido_nodo_mathml(nodo: NodoMathml): string {
  const contenidos = nodo.hijos.map(contenido_nodo_mathml).filter(Boolean);
  const unido = [nodo.texto, ...contenidos].filter(Boolean).join(" ");
  if (nodo.nombre === "annotation" || nodo.nombre === "annotation-xml") return "";
  if (nodo.nombre === "mfrac") return `fracción ${contenidos[0] ?? ""} sobre ${contenidos[1] ?? ""}`;
  if (nodo.nombre === "msqrt") return `raíz cuadrada de ${unido}`;
  if (nodo.nombre === "mroot") return `raíz ${contenidos[1] ?? ""} de ${contenidos[0] ?? ""}`;
  if (nodo.nombre === "msup") {
    const exponente = contenidos[1] ?? "";
    const potencia = exponente === "2" ? "al cuadrado" : exponente === "3" ? "al cubo" : `elevado a ${exponente}`;
    return `${contenidos[0] ?? ""} ${potencia}`;
  }
  if (nodo.nombre === "msub") return `${contenidos[0] ?? ""} subíndice ${contenidos[1] ?? ""}`;
  return unido;
}

function verbalizar_estructura_mathml(mathml: string): string {
  const raiz: NodoMathml = { nombre: "raiz", texto: "", hijos: [] };
  const pila = [raiz];
  for (const token of mathml.match(/<[^>]+>|[^<]+/gu) ?? []) {
    if (token.startsWith("</")) {
      if (pila.length > 1) pila.pop();
      continue;
    }
    if (token.startsWith("<")) {
      if (/^<\?|^<!/u.test(token)) continue;
      const nombre = token.match(/^<\s*(?:[\w.-]+:)?([\w.-]+)/u)?.[1]?.toLocaleLowerCase("es") ?? "";
      if (!nombre) continue;
      const nodo: NodoMathml = { nombre, texto: "", hijos: [] };
      pila.at(-1)?.hijos.push(nodo);
      if (!/\/\s*>$/u.test(token)) pila.push(nodo);
      continue;
    }
    const actual = pila.at(-1);
    if (actual) actual.texto += ` ${token.trim()} `;
  }
  return contenido_nodo_mathml(raiz);
}

function verbalizar_matematica(visible: string): string | null {
  let texto = visible.normalize("NFC");
  if (/<(?:[\w.-]+:)?math\b/iu.test(texto)) texto = verbalizar_estructura_mathml(texto);
  texto = texto
    .replace(/<annotation\b[\s\S]*?<\/annotation>/giu, " ")
    .replace(/<mfrac\b[^>]*>/giu, " fracción ")
    .replace(/<msqrt\b[^>]*>/giu, " raíz cuadrada de ")
    .replace(/<mroot\b[^>]*>/giu, " raíz de ")
    .replace(/<msup\b[^>]*>/giu, " potencia ")
    .replace(/<msub\b[^>]*>/giu, " subíndice ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&(?:InvisibleTimes|times);/giu, " por ")
    .replace(/&le;|&#x2264;|&#8804;/giu, " menor o igual ")
    .replace(/&ge;|&#x2265;|&#8805;/giu, " mayor o igual ")
    .replace(/&ne;|&#x2260;|&#8800;/giu, " distinto de ")
    .replace(/&lt;/giu, " menor que ")
    .replace(/&gt;/giu, " mayor que ")
    .replace(/&amp;/giu, " y ");
  texto = texto.replace(/^\s*(?:\$\$|\$|\\\[|\\\()/u, "").replace(/(?:\$\$|\$|\\\]|\\\))\s*$/u, "");
  texto = sustituir_fracciones_tex(texto)
    .replace(/\\sqrt\s*\{([^{}]+)\}/gu, " raíz cuadrada de $1 ")
    .replace(/\^\s*(?:\{\s*2\s*\}|2)\b/gu, " al cuadrado ")
    .replace(/\^\s*(?:\{\s*3\s*\}|3)\b/gu, " al cubo ")
    .replace(/\^\s*\{([^{}]+)\}/gu, " elevado a $1 ")
    .replace(/\^\s*([\p{L}\p{N}])/gu, " elevado a $1 ")
    .replace(/_\s*\{([^{}]+)\}/gu, " subíndice $1 ")
    .replace(/_\s*([\p{L}\p{N}])/gu, " subíndice $1 ")
    .replace(/\\([A-Za-z]+)/gu, (_, comando: string) => ` ${NOMBRES_COMANDOS_MATEMATICOS[comando] ?? comando} `);
  for (const [simbolo, nombre] of Object.entries(NOMBRES_SIMBOLOS_MATEMATICOS)) texto = texto.replaceAll(simbolo, ` ${nombre} `);
  texto = texto
    .replace(/[{}$]/gu, " ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
  if (!/[\p{L}\p{N}]/u.test(texto)) return null;
  return /[.!?…]$/u.test(texto) ? texto : `${texto}.`;
}

export function texto_para_locucion(
  visible: string,
  tipo: TipoFragmento,
  politica: PoliticaMatematica,
  saltar_citas = false,
): string | null {
  if (tipo !== "matematica") {
    const con_matematica_verbalizada = visible.replace(PATRON_MATEMATICA_TEXTO, (matematica) => {
      if (politica === "omitir") return " ";
      if (politica === "indicar") return " Ecuación ";
      return ` ${verbalizar_matematica(matematica)?.replace(/[.!?…]$/u, "") ?? matematica} `;
    });
    const canonico = normalizar_texto_lectura(con_matematica_verbalizada).texto;
    const texto = saltar_citas ? quitar_citas_bibliograficas(canonico) : canonico;
    return /[\p{L}\p{N}]/u.test(texto) ? texto : null;
  }
  if (politica === "omitir") return null;
  if (politica === "indicar") return "Ecuación.";
  return verbalizar_matematica(visible);
}

interface FragmentoConFuente {
  fragmento: FragmentoLectura;
  inicio_fuente: number;
  fin_fuente: number;
}

function unidades_de_texto(texto: string): UnidadLectura[] {
  return segmentar_palabras_lectura(texto).map(({ texto: unidad, inicio, fin }) => ({ texto: unidad, inicio, fin }));
}

export function unidades_fragmento_lectura(fragmento: FragmentoLectura): UnidadLectura[] {
  return fragmento.unidades ?? unidades_de_texto(fragmento.visible);
}

function segmentar_texto_con_fuente(texto: string, politica: PoliticaMatematica, opciones: OpcionesSegmentacion): FragmentoConFuente[] {
  const canonico = normalizar_texto_lectura(texto.replace(/\r\n?/g, "\n"));
  if (!canonico.texto) return [];

  const bloques: Array<{ inicio: number; fin: number; tipo: TipoFragmento }> = [];
  let cursor = 0;
  for (const coincidencia of canonico.texto.matchAll(PATRON_MATEMATICA_BLOQUE)) {
    const inicio = coincidencia.index ?? 0;
    if (inicio > cursor) bloques.push({ inicio: cursor, fin: inicio, tipo: "texto" });
    bloques.push({ inicio, fin: inicio + coincidencia[0].length, tipo: "matematica" });
    cursor = inicio + coincidencia[0].length;
  }
  if (cursor < canonico.texto.length) bloques.push({ inicio: cursor, fin: canonico.texto.length, tipo: "texto" });

  const fragmentos: FragmentoConFuente[] = [];
  for (const bloque of bloques) {
    const unidades = bloque.tipo === "matematica"
      ? [{ texto: canonico.texto.slice(bloque.inicio, bloque.fin), inicio: bloque.inicio, fin: bloque.fin }]
      : dividir_por_puntuacion(canonico.texto.slice(bloque.inicio, bloque.fin)).map((unidad) => ({
        ...unidad,
        inicio: unidad.inicio + bloque.inicio,
        fin: unidad.fin + bloque.inicio,
      }));
    for (const unidad of unidades) {
      const visible = unidad.texto;
      const tipo = bloque.tipo === "matematica" || esMatematicaHeuristica(visible) ? "matematica" : "texto";
      const fuente = rango_fuente(canonico, unidad.inicio, unidad.fin);
      fragmentos.push({
        fragmento: {
          id: `fragmento-${fragmentos.length}`,
          visible,
          tipo,
          locucion: texto_para_locucion(visible, tipo, politica, opciones.saltar_citas),
          unidades: unidades_de_texto(visible),
        },
        inicio_fuente: fuente.inicio,
        fin_fuente: fuente.fin,
      });
    }
  }
  return fragmentos;
}

export function segmentar_texto(texto: string, politica: PoliticaMatematica, opciones: OpcionesSegmentacion = OPCIONES_PREDETERMINADAS): FragmentoLectura[] {
  return segmentar_texto_con_fuente(texto, politica, opciones).map(({ fragmento }) => fragmento);
}

interface TramoBloquePdf {
  bloque: BloqueDocumento;
  inicio: number;
  fin: number;
}

function es_linea_pdf(bloque: BloqueDocumento): boolean {
  return bloque.pagina !== undefined && bloque.estructura === undefined && bloque.tipo === "texto";
}

function termina_frase(texto: string): boolean {
  return /[.!?…][»”’"')\]}]*$/u.test(texto.trim());
}

function parecen_lineas_pdf_continuas(anterior: BloqueDocumento, siguiente: BloqueDocumento): boolean {
  if (!es_linea_pdf(anterior) || !es_linea_pdf(siguiente) || termina_frase(anterior.contenido)) return false;
  const misma_pagina = anterior.pagina === siguiente.pagina;
  const pagina_siguiente = anterior.pagina !== undefined && siguiente.pagina === anterior.pagina + 1;
  if (!misma_pagina && !pagina_siguiente) return false;
  const texto_anterior = anterior.contenido.trim();
  const texto_siguiente = siguiente.contenido.trim();
  if (!texto_anterior || !texto_siguiente) return false;
  if (/@|\b(?:https?:\/\/|www\.)/iu.test(texto_anterior)) return false;
  if (/-$/u.test(texto_anterior)) return true;

  const geometria_anterior = anterior.geometria_pdf;
  const geometria_siguiente = siguiente.geometria_pdf;
  if (geometria_anterior && geometria_siguiente) {
    const alto = Math.max(geometria_anterior.alto, geometria_siguiente.alto, 1);
    const salto_vertical = geometria_anterior.y - geometria_siguiente.y;
    const proporcion_altos = Math.max(geometria_anterior.alto, geometria_siguiente.alto) / Math.max(1, Math.min(geometria_anterior.alto, geometria_siguiente.alto));
    if (pagina_siguiente) return proporcion_altos <= 1.45 && geometria_siguiente.y > geometria_anterior.y;
    const cambio_columna = geometria_siguiente.x - geometria_anterior.x >= geometria_anterior.ancho_pagina * .15 && geometria_siguiente.y > geometria_anterior.y;
    if (proporcion_altos > 1.45) return false;
    if (cambio_columna) return true;
    const misma_columna = Math.abs(geometria_anterior.x - geometria_siguiente.x) <= Math.max(24, geometria_anterior.ancho_pagina * .12);
    if (salto_vertical <= 0 || salto_vertical > alto * 2.4 || !misma_columna) return false;
    return true;
  }

  const palabras_anteriores = texto_anterior.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  const siguiente_empieza_minuscula = /^[«“‘("'¿¡]*[\p{Ll}\p{N}]/u.test(texto_siguiente);
  const anterior_deja_continuacion = /[,;:]$/u.test(texto_anterior);
  return siguiente_empieza_minuscula || anterior_deja_continuacion || palabras_anteriores >= 7;
}

function combinar_lineas_pdf(bloques: BloqueDocumento[]): { texto: string; tramos: TramoBloquePdf[] } {
  let texto = "";
  const tramos: TramoBloquePdf[] = [];
  bloques.forEach((bloque, indice) => {
    if (indice > 0) {
      const siguiente_empieza_minuscula = /^\p{Ll}/u.test(bloque.contenido.trimStart());
      if (texto.endsWith("-") && siguiente_empieza_minuscula) {
        texto = texto.slice(0, -1);
        const anterior = tramos.at(-1);
        if (anterior) anterior.fin -= 1;
      } else texto += " ";
    }
    const inicio = texto.length;
    texto += bloque.contenido;
    tramos.push({ bloque, inicio, fin: texto.length });
  });
  return { texto, tramos };
}

function anclas_fragmento_pdf(entrada: FragmentoConFuente, tramos: TramoBloquePdf[]): AnclaLectura[] {
  return tramos.flatMap(({ bloque, inicio, fin }): AnclaLectura[] => {
    if (fin <= entrada.inicio_fuente || inicio >= entrada.fin_fuente) return [];
    const inicio_solapado = Math.max(inicio, entrada.inicio_fuente);
    const fin_solapado = Math.min(fin, entrada.fin_fuente);
    const inicio_bloque = inicio_solapado - inicio;
    const fin_bloque = fin_solapado === fin ? bloque.contenido.length : fin_solapado - inicio;
    return [{ bloque_id: bloque.id, inicio: inicio_bloque, fin: fin_bloque, pagina: bloque.pagina }];
  });
}

function crear_partes_pdf(anclas: AnclaLectura[], bloques: BloqueDocumento[]): PartePdfLectura[] {
  const partes: PartePdfLectura[] = [];
  anclas.forEach((ancla) => {
    const bloque = bloques.find(({ id }) => id === ancla.bloque_id);
    const pagina = ancla.pagina ?? bloque?.pagina;
    if (!bloque || pagina === undefined) return;
    const texto_ancla = bloque.contenido.slice(ancla.inicio, ancla.fin);
    const parte = partes.at(-1);
    if (parte?.pagina === pagina) {
      const unir_sin_guion = parte.texto.endsWith("-") && /^\p{Ll}/u.test(texto_ancla.trimStart());
      parte.texto = `${unir_sin_guion ? parte.texto.slice(0, -1) : `${parte.texto} `}${texto_ancla}`;
    } else partes.push({ pagina, texto: texto_ancla });
  });
  return partes.map(({ pagina, texto }) => ({ pagina, texto: normalizar_texto_lectura(texto).texto }));
}

function asignar_paginas_unidades(unidades: UnidadLectura[], partes: PartePdfLectura[]): UnidadLectura[] {
  if (partes.length <= 1) return unidades.map((unidad) => ({ ...unidad, pagina: partes[0]?.pagina }));
  const limites: Array<{ pagina: number; fin: number }> = [];
  let acumulado = 0;
  partes.forEach((parte, indice) => {
    acumulado += parte.texto.length;
    limites.push({ pagina: parte.pagina, fin: acumulado });
    if (indice < partes.length - 1) acumulado += 1;
  });
  return unidades.map((unidad) => {
    const centro = (unidad.inicio + unidad.fin) / 2;
    const pagina = limites.find(({ fin }) => centro <= fin)?.pagina ?? limites.at(-1)?.pagina;
    return { ...unidad, pagina };
  });
}

function agregar_lineas_pdf(resultado: FragmentoLectura[], bloques: BloqueDocumento[], politica: PoliticaMatematica, opciones: OpcionesSegmentacion): void {
  const combinado = combinar_lineas_pdf(bloques);
  segmentar_texto_con_fuente(combinado.texto, politica, opciones).forEach((entrada) => {
    const anclas = anclas_fragmento_pdf(entrada, combinado.tramos);
    const bloque_inicial = bloques.find(({ id }) => id === anclas[0]?.bloque_id) ?? bloques[0];
    const partes_pdf = crear_partes_pdf(anclas, bloques);
    const paginas = [...new Set(partes_pdf.map(({ pagina }) => pagina))];
    resultado.push({
      ...entrada.fragmento,
      unidades: asignar_paginas_unidades(entrada.fragmento.unidades ?? [], partes_pdf),
      id: `fragmento-${resultado.length}`,
      pagina: bloque_inicial?.pagina,
      paginas,
      partes_pdf,
      bloque_id: anclas[0]?.bloque_id,
      estructura: "parrafo",
      inicio_bloque: anclas[0]?.inicio === 0,
      fin_bloque: anclas.at(-1)?.fin === bloques.find(({ id }) => id === anclas.at(-1)?.bloque_id)?.contenido.length,
      ancla: anclas[0],
      anclas,
    });
  });
}

export function segmentar_bloques(bloques: BloqueDocumento[], politica: PoliticaMatematica, opciones: OpcionesSegmentacion = OPCIONES_PREDETERMINADAS): FragmentoLectura[] {
  const resultado: FragmentoLectura[] = [];
  for (let indice_bloque = 0; indice_bloque < bloques.length; indice_bloque += 1) {
    const bloque = bloques[indice_bloque]!;
    if (es_linea_pdf(bloque)) {
      const lineas = [bloque];
      while (indice_bloque + 1 < bloques.length && parecen_lineas_pdf_continuas(lineas.at(-1)!, bloques[indice_bloque + 1]!)) {
        indice_bloque += 1;
        lineas.push(bloques[indice_bloque]!);
      }
      agregar_lineas_pdf(resultado, lineas, politica, opciones);
      continue;
    }
    const omitir_referencia = opciones.saltar_citas === true && bloque.estructura === "referencia";
    let fragmentos_bloque: FragmentoConFuente[] = bloque.estructura === "preformateado"
      ? [...bloque.contenido.matchAll(/[^\n]*(?:\n|$)/gu)].filter(({ 0: linea }) => linea.length > 0).map((coincidencia): FragmentoConFuente => {
        const inicio = coincidencia.index ?? 0;
        const linea = coincidencia[0].replace(/\n$/u, "");
        return {
          fragmento: { id: "", visible: linea || " ", tipo: "texto", locucion: texto_para_locucion(linea, "texto", politica), unidades: unidades_de_texto(linea), salto_linea_antes: inicio > 0 },
          inicio_fuente: inicio,
          fin_fuente: inicio + linea.length,
        };
      })
      : bloque.tipo === "matematica"
        ? [{
          fragmento: { id: "", visible: normalizar_texto_lectura(bloque.contenido).texto, tipo: "matematica", locucion: texto_para_locucion(bloque.contenido, "matematica", politica), unidades: unidades_de_texto(bloque.contenido) },
          inicio_fuente: 0,
          fin_fuente: bloque.contenido.length,
        }]
        : segmentar_texto_con_fuente(bloque.contenido, politica, opciones);
    if (bloque.estructura !== "preformateado" && bloque.tipo !== "matematica") {
      let fin_previo = 0;
      fragmentos_bloque = fragmentos_bloque.map((entrada, indice) => {
        const salto_linea_antes = indice > 0 && bloque.contenido.slice(fin_previo, entrada.inicio_fuente).includes("\n");
        fin_previo = entrada.fin_fuente;
        return {
          ...entrada,
          fragmento: {
            ...entrada.fragmento,
            locucion: omitir_referencia ? null : entrada.fragmento.locucion,
            salto_linea_antes,
          },
        };
      });
    }
    fragmentos_bloque.forEach(({ fragmento, inicio_fuente, fin_fuente }, indice) => {
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
      ancla: { bloque_id: bloque.id, inicio: inicio_fuente, fin: fin_fuente },
      anclas: [{ bloque_id: bloque.id, inicio: inicio_fuente, fin: fin_fuente }],
    });
    });
  }
  return resultado;
}
