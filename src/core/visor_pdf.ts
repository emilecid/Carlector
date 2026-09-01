import type { FragmentoLectura, UnidadLectura } from "./modelos.ts";

export function pagina_de_fragmento(fragmentos: FragmentoLectura[], indice: number, alternativa: number, total_paginas: number): number {
  const pagina = fragmentos[indice]?.pagina ?? alternativa;
  return Math.min(Math.max(1, Math.trunc(pagina)), Math.max(1, Math.trunc(total_paginas)));
}

export function indice_inicial_pagina(fragmentos: FragmentoLectura[], pagina: number): number | null {
  const indice = fragmentos.findIndex((fragmento) => pertenece_fragmento_a_pagina(fragmento, pagina));
  return indice >= 0 ? indice : null;
}

function normalizar_seleccion_pdf(texto: string): string {
  return texto.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function pertenece_fragmento_a_pagina(fragmento: FragmentoLectura, pagina: number): boolean {
  return fragmento.pagina === pagina || fragmento.paginas?.includes(pagina) === true;
}

function texto_fragmento_en_pagina(fragmento: FragmentoLectura, pagina: number): string {
  return fragmento.partes_pdf?.find((parte) => parte.pagina === pagina)?.texto ?? fragmento.visible;
}

export interface RangoTextoPdf {
  inicio: number;
  fin: number;
}

export interface RangoFragmentoPdf extends RangoTextoPdf {
  indice_fragmento: number;
}

export interface PosicionTextoPdf {
  x: number;
  y: number;
  ancho?: number;
  alto?: number;
  fin_linea?: boolean;
  vacio?: boolean;
}

interface ElementoOrdenPdf {
  posicion: PosicionTextoPdf;
  indice: number;
}

interface LineaOrdenPdf {
  x: number;
  fin_x: number;
  y: number;
  alto: number;
  cerrada: boolean;
  elementos: ElementoOrdenPdf[];
}

interface ColumnaOrdenPdf {
  inicio: number;
  fin: number;
  lineas: LineaOrdenPdf[];
}

function crear_lineas_pdf(posiciones: PosicionTextoPdf[], tolerancia_vertical: number): LineaOrdenPdf[] {
  const lineas: LineaOrdenPdf[] = [];
  posiciones.forEach((posicion, indice) => {
    if (posicion.vacio) return;
    const anterior = lineas.at(-1);
    const ultimo_x = anterior?.elementos.at(-1)?.posicion.x ?? Number.NEGATIVE_INFINITY;
    const alto = posicion.alto ?? 0;
    const es_continuacion_capitular = anterior && !anterior.cerrada && anterior.alto >= Math.max(alto * 1.8, alto + tolerancia_vertical) && posicion.y > anterior.y && posicion.y <= anterior.y + anterior.alto;
    const continua = anterior && !anterior.cerrada && posicion.x >= ultimo_x - tolerancia_vertical && (Math.abs(anterior.y - posicion.y) <= tolerancia_vertical || es_continuacion_capitular);
    const elemento = { posicion, indice };
    if (continua) {
      anterior.elementos.push(elemento);
      anterior.x = Math.min(anterior.x, posicion.x);
      anterior.fin_x = Math.max(anterior.fin_x, posicion.x + (posicion.ancho ?? 0));
      anterior.y = Math.max(anterior.y, posicion.y);
      anterior.alto = Math.max(anterior.alto, alto);
      anterior.cerrada = posicion.fin_linea === true;
    } else lineas.push({
      x: posicion.x,
      fin_x: posicion.x + (posicion.ancho ?? 0),
      y: posicion.y,
      alto,
      cerrada: posicion.fin_linea === true,
      elementos: [elemento],
    });
  });
  return lineas;
}

function mediana(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const centro = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0 ? ((ordenados[centro - 1] ?? 0) + (ordenados[centro] ?? 0)) / 2 : ordenados[centro] ?? 0;
}

function detectar_columnas_pdf(lineas: LineaOrdenPdf[], ancho_pagina: number): ColumnaOrdenPdf[] {
  const candidatas = lineas.filter((linea) => linea.fin_x > linea.x && linea.fin_x - linea.x <= ancho_pagina * .72);
  const tolerancia = Math.max(12, ancho_pagina * .06);
  const grupos: LineaOrdenPdf[][] = [];
  [...candidatas].sort((a, b) => a.x - b.x).forEach((linea) => {
    const grupo = grupos.at(-1);
    const centro = grupo ? mediana(grupo.map(({ x }) => x)) : Number.NEGATIVE_INFINITY;
    if (grupo && linea.x - centro <= tolerancia) grupo.push(linea);
    else grupos.push([linea]);
  });
  const soporte_minimo = Math.max(2, Math.ceil(candidatas.length * .08));
  const columnas = grupos
    .filter((grupo) => grupo.length >= soporte_minimo)
    .map((grupo): ColumnaOrdenPdf => ({
      inicio: mediana(grupo.map(({ x }) => x)),
      fin: mediana(grupo.map(({ fin_x }) => fin_x)),
      lineas: grupo,
    }))
    .sort((a, b) => a.inicio - b.inicio);
  return columnas.reduce((validas, columna) => {
    const anterior = validas.at(-1);
    if (!anterior || columna.inicio - anterior.inicio >= ancho_pagina * .16) validas.push(columna);
    else if (columna.lineas.length > anterior.lineas.length) validas[validas.length - 1] = columna;
    return validas;
  }, [] as ColumnaOrdenPdf[]);
}

function solapamiento_horizontal(linea: LineaOrdenPdf, columna: ColumnaOrdenPdf): number {
  return Math.max(0, Math.min(linea.fin_x, columna.fin) - Math.max(linea.x, columna.inicio));
}

function indice_columna_linea(linea: LineaOrdenPdf, columnas: ColumnaOrdenPdf[]): number {
  return columnas.reduce((mejor, columna, indice) => {
    const solapamiento = solapamiento_horizontal(linea, columna);
    const mejor_solapamiento = solapamiento_horizontal(linea, columnas[mejor]!);
    if (solapamiento !== mejor_solapamiento) return solapamiento > mejor_solapamiento ? indice : mejor;
    return Math.abs(linea.x - columna.inicio) < Math.abs(linea.x - columnas[mejor]!.inicio) ? indice : mejor;
  }, 0);
}

function abarca_varias_columnas(linea: LineaOrdenPdf, columnas: ColumnaOrdenPdf[]): boolean {
  return columnas.filter((columna) => solapamiento_horizontal(linea, columna) >= Math.max(8, (columna.fin - columna.inicio) * .2)).length > 1;
}

function ordenar_region_columnas(lineas: LineaOrdenPdf[], columnas: ColumnaOrdenPdf[]): LineaOrdenPdf[] {
  const grupos = columnas.map((): LineaOrdenPdf[] => []);
  lineas.forEach((linea) => grupos[indice_columna_linea(linea, columnas)]?.push(linea));
  return grupos.flatMap((grupo) => grupo.sort((a, b) => b.y - a.y || a.x - b.x));
}

function ordenar_lineas_pdf(lineas: LineaOrdenPdf[], tolerancia_vertical: number, ancho_pagina?: number): LineaOrdenPdf[] {
  if (!ancho_pagina) return [...lineas].sort((a, b) => b.y - a.y || a.x - b.x);
  const columnas = detectar_columnas_pdf(lineas, ancho_pagina);
  if (columnas.length < 2) return [...lineas].sort((a, b) => b.y - a.y || a.x - b.x);
  const transversales = lineas.filter((linea) => abarca_varias_columnas(linea, columnas)).sort((a, b) => b.y - a.y || a.x - b.x);
  let pendientes = lineas.filter((linea) => !transversales.includes(linea));
  const resultado: LineaOrdenPdf[] = [];
  for (let indice = 0; indice < transversales.length;) {
    const y = transversales[indice]!.y;
    const fila: LineaOrdenPdf[] = [];
    while (indice < transversales.length && Math.abs((transversales[indice]?.y ?? y) - y) <= tolerancia_vertical) {
      fila.push(transversales[indice]!);
      indice += 1;
    }
    const superiores = pendientes.filter((linea) => linea.y > y + tolerancia_vertical);
    resultado.push(...ordenar_region_columnas(superiores, columnas), ...fila.sort((a, b) => a.x - b.x));
    pendientes = pendientes.filter((linea) => linea.y <= y + tolerancia_vertical);
  }
  resultado.push(...ordenar_region_columnas(pendientes, columnas));
  return resultado;
}

export function agrupar_indices_lineas_texto_pdf(posiciones: PosicionTextoPdf[], tolerancia_vertical = 3, ancho_pagina?: number): number[][] {
  const posiciones_invalidas = posiciones.some(({ x, y, ancho, alto }) => !Number.isFinite(x) || !Number.isFinite(y) || ancho !== undefined && (!Number.isFinite(ancho) || ancho < 0) || alto !== undefined && (!Number.isFinite(alto) || alto < 0));
  if (!Number.isFinite(tolerancia_vertical) || tolerancia_vertical < 0 || ancho_pagina !== undefined && (!Number.isFinite(ancho_pagina) || ancho_pagina <= 0) || posiciones_invalidas) throw new Error("Las posiciones PDF deben ser finitas, sus dimensiones válidas y la tolerancia no negativa.");
  return ordenar_lineas_pdf(crear_lineas_pdf(posiciones, tolerancia_vertical), tolerancia_vertical, ancho_pagina)
    .map((linea) => linea.elementos.sort((a, b) => a.posicion.x - b.posicion.x).map(({ indice }) => indice));
}

export function ordenar_indices_texto_pdf(posiciones: PosicionTextoPdf[], tolerancia_vertical = 3, ancho_pagina?: number): number[] {
  return agrupar_indices_lineas_texto_pdf(posiciones, tolerancia_vertical, ancho_pagina).flat();
}

export function rangos_textos_pdf(textos: string[]): RangoTextoPdf[] {
  const normalizados = textos.map(normalizar_seleccion_pdf);
  const total = normalizados.filter(Boolean).reduce((suma, texto) => suma + texto.length, 0) + Math.max(0, normalizados.filter(Boolean).length - 1);
  if (total <= 0) return textos.map(() => ({ inicio: 0, fin: 0 }));
  let posicion = 0;
  let tiene_anterior = false;
  return normalizados.map((texto) => {
    if (!texto) return { inicio: posicion / total, fin: posicion / total };
    if (tiene_anterior) posicion += 1;
    const inicio = posicion / total;
    posicion += texto.length;
    tiene_anterior = true;
    return { inicio, fin: posicion / total };
  });
}

function buscar_texto_completo_pdf(texto_pagina: string, texto_fragmento: string, desde: number): number {
  let posicion = texto_pagina.indexOf(texto_fragmento, desde);
  while (posicion >= 0) {
    const limite_inicial = posicion === 0 || texto_pagina[posicion - 1] === " ";
    const fin = posicion + texto_fragmento.length;
    const limite_final = fin === texto_pagina.length || texto_pagina[fin] === " ";
    if (limite_inicial && limite_final) return posicion;
    posicion = texto_pagina.indexOf(texto_fragmento, posicion + 1);
  }
  return -1;
}

function buscar_texto_sin_espacios_pdf(texto_pagina: string, texto_fragmento: string, desde: number): { inicio: number; fin: number } | null {
  const indices: number[] = [];
  let pagina_compacta = "";
  for (let indice = 0; indice < texto_pagina.length; indice += 1) {
    const caracter = texto_pagina[indice];
    if (caracter === " ") continue;
    indices.push(indice);
    pagina_compacta += caracter;
  }
  const fragmento_compacto = texto_fragmento.replaceAll(" ", "");
  if (!fragmento_compacto) return null;
  const desde_compacto = indices.findIndex((indice) => indice >= desde);
  const posicion = pagina_compacta.indexOf(fragmento_compacto, Math.max(0, desde_compacto));
  if (posicion < 0) return null;
  const inicio = indices[posicion];
  const ultimo = indices[posicion + fragmento_compacto.length - 1];
  return inicio === undefined || ultimo === undefined ? null : { inicio, fin: ultimo + 1 };
}

export function mapear_fragmentos_pdf(fragmentos: FragmentoLectura[], pagina: number, textos_spans: string[]): RangoFragmentoPdf[] {
  const texto_pagina = textos_spans.map(normalizar_seleccion_pdf).filter(Boolean).join(" ");
  if (!texto_pagina) return [];
  const resultado: RangoFragmentoPdf[] = [];
  let cursor = 0;
  fragmentos.forEach((fragmento, indice_fragmento) => {
    if (!pertenece_fragmento_a_pagina(fragmento, pagina)) return;
    const texto_fragmento = normalizar_seleccion_pdf(texto_fragmento_en_pagina(fragmento, pagina));
    if (!texto_fragmento) return;
    const inicio_exacto = buscar_texto_completo_pdf(texto_pagina, texto_fragmento, cursor);
    const flexible = inicio_exacto < 0 ? buscar_texto_sin_espacios_pdf(texto_pagina, texto_fragmento, cursor) : null;
    const inicio = inicio_exacto >= 0 ? inicio_exacto : flexible?.inicio ?? -1;
    if (inicio < 0) return;
    const fin = inicio_exacto >= 0 ? inicio + texto_fragmento.length : flexible?.fin ?? inicio;
    resultado.push({ indice_fragmento, inicio: inicio / texto_pagina.length, fin: fin / texto_pagina.length });
    cursor = fin;
  });
  return resultado;
}

export function indice_de_seleccion_pdf(fragmentos: FragmentoLectura[], pagina: number, seleccion: string): number | null {
  const texto_seleccionado = normalizar_seleccion_pdf(seleccion);
  if (!texto_seleccionado) return null;
  const candidatos = fragmentos.map((fragmento, indice) => ({ fragmento, indice })).filter(({ fragmento }) => pertenece_fragmento_a_pagina(fragmento, pagina));
  const exacto = candidatos.find(({ fragmento }) => {
    const visible = normalizar_seleccion_pdf(texto_fragmento_en_pagina(fragmento, pagina));
    return visible.includes(texto_seleccionado) || texto_seleccionado.includes(visible);
  });
  if (exacto) return exacto.indice;
  const palabras = new Set(texto_seleccionado.split(" "));
  let mejor: { indice: number; proporcion: number } | null = null;
  for (const candidato of candidatos) {
    const visibles = new Set(normalizar_seleccion_pdf(texto_fragmento_en_pagina(candidato.fragmento, pagina)).split(" ").filter(Boolean));
    const coincidencias = [...palabras].filter((palabra) => visibles.has(palabra)).length;
    const proporcion = coincidencias / Math.max(1, palabras.size);
    if (proporcion >= .6 && (!mejor || proporcion > mejor.proporcion)) mejor = { indice: candidato.indice, proporcion };
  }
  return mejor?.indice ?? null;
}

export function rango_relativo_fragmento_pdf(fragmentos: FragmentoLectura[], indice: number, pagina_forzada?: number): { inicio: number; fin: number } | null {
  const pagina = pagina_forzada ?? fragmentos[indice]?.pagina;
  if (pagina === undefined) return null;
  const indices_pagina = fragmentos.map((fragmento, posicion) => ({ fragmento, posicion })).filter(({ fragmento }) => pertenece_fragmento_a_pagina(fragmento, pagina)).map(({ posicion }) => posicion);
  const posicion = indices_pagina.indexOf(indice);
  if (posicion < 0 || indices_pagina.length === 0) return null;
  const pesos = indices_pagina.map((indice_pagina) => Math.max(1, [...texto_fragmento_en_pagina(fragmentos[indice_pagina]!, pagina).trim().replace(/\s+/gu, " ")].length));
  const total = pesos.reduce((suma, peso) => suma + peso, 0);
  const inicio = pesos.slice(0, posicion).reduce((suma, peso) => suma + peso, 0) / total;
  return { inicio, fin: inicio + (pesos[posicion] ?? 1) / total };
}

export function rango_relativo_unidad_pdf(fragmentos: FragmentoLectura[], indice: number, unidad: number, pesos_unidades: number[], rango_exacto?: RangoTextoPdf): { inicio: number; fin: number } | null {
  const rango_fragmento = rango_exacto ?? rango_relativo_fragmento_pdf(fragmentos, indice);
  if (!rango_fragmento || !Number.isInteger(unidad) || unidad < 0 || unidad >= pesos_unidades.length || pesos_unidades.some((peso) => !Number.isFinite(peso) || peso <= 0)) return null;
  const total = pesos_unidades.reduce((suma, peso) => suma + peso, 0);
  if (total <= 0) return null;
  const proporcion_inicio = pesos_unidades.slice(0, unidad).reduce((suma, peso) => suma + peso, 0) / total;
  const proporcion_fin = proporcion_inicio + (pesos_unidades[unidad] ?? 0) / total;
  const ancho_fragmento = rango_fragmento.fin - rango_fragmento.inicio;
  return { inicio: rango_fragmento.inicio + ancho_fragmento * proporcion_inicio, fin: rango_fragmento.inicio + ancho_fragmento * proporcion_fin };
}

export function rango_textual_unidad_pdf(texto_fragmento: string, unidades: string[], unidad: number, rango_fragmento: RangoTextoPdf): RangoTextoPdf | null {
  if (!Number.isInteger(unidad) || unidad < 0 || unidad >= unidades.length || rango_fragmento.fin <= rango_fragmento.inicio) return null;
  const texto = normalizar_seleccion_pdf(texto_fragmento);
  const objetivo = normalizar_seleccion_pdf(unidades[unidad] ?? "");
  if (!texto || !objetivo) return null;
  let cursor = 0;
  for (let indice = 0; indice <= unidad; indice += 1) {
    const parte = normalizar_seleccion_pdf(unidades[indice] ?? "");
    const inicio = texto.indexOf(parte, cursor);
    if (inicio < 0) return null;
    if (indice === unidad) {
      const ancho = rango_fragmento.fin - rango_fragmento.inicio;
      return {
        inicio: rango_fragmento.inicio + ancho * (inicio / texto.length),
        fin: rango_fragmento.inicio + ancho * ((inicio + parte.length) / texto.length),
      };
    }
    cursor = inicio + parte.length;
  }
  return null;
}

export function rango_canonico_unidad_pdf(texto_fragmento: string, unidad: UnidadLectura, rango_fragmento: RangoTextoPdf): RangoTextoPdf | null {
  if (!Number.isInteger(unidad.inicio) || !Number.isInteger(unidad.fin) || unidad.inicio < 0 || unidad.fin <= unidad.inicio || unidad.fin > texto_fragmento.length || rango_fragmento.fin <= rango_fragmento.inicio) return null;
  if (texto_fragmento.slice(unidad.inicio, unidad.fin) !== unidad.texto) return null;
  const ancho = rango_fragmento.fin - rango_fragmento.inicio;
  return {
    inicio: rango_fragmento.inicio + ancho * (unidad.inicio / texto_fragmento.length),
    fin: rango_fragmento.inicio + ancho * (unidad.fin / texto_fragmento.length),
  };
}

export function indice_de_punto_pdf(fragmentos: FragmentoLectura[], pagina: number, progreso: number, texto = ""): number | null {
  if (!Number.isFinite(progreso)) return null;
  const candidatos = fragmentos.map((fragmento, indice) => ({ fragmento, indice })).filter(({ fragmento }) => pertenece_fragmento_a_pagina(fragmento, pagina));
  if (!candidatos.length) return null;
  const punto = Math.min(1, Math.max(0, progreso));
  const texto_objetivo = normalizar_seleccion_pdf(texto);
  const compatibles = texto_objetivo ? candidatos.filter(({ fragmento }) => {
    const visible = normalizar_seleccion_pdf(texto_fragmento_en_pagina(fragmento, pagina));
    return visible.includes(texto_objetivo) || texto_objetivo.includes(visible);
  }) : candidatos;
  const elegibles = compatibles.length ? compatibles : candidatos;
  return elegibles.reduce((mejor, candidato) => {
    const rango_mejor = rango_relativo_fragmento_pdf(fragmentos, mejor.indice, pagina);
    const rango_candidato = rango_relativo_fragmento_pdf(fragmentos, candidato.indice, pagina);
    const distancia_mejor = rango_mejor ? Math.abs((rango_mejor.inicio + rango_mejor.fin) / 2 - punto) : Infinity;
    const distancia_candidato = rango_candidato ? Math.abs((rango_candidato.inicio + rango_candidato.fin) / 2 - punto) : Infinity;
    return distancia_candidato < distancia_mejor ? candidato : mejor;
  }).indice;
}

export function calcular_escala_pdf(ancho_disponible: number, ancho_pagina: number, zoom: number): number {
  if (ancho_disponible <= 0 || ancho_pagina <= 0 || zoom <= 0) throw new Error("Ancho y zoom deben ser mayores que cero.");
  return ancho_disponible / ancho_pagina * zoom;
}

export function ajustar_zoom_pdf(zoom: number, cambio: number): number {
  return Math.min(2.5, Math.max(.5, Math.round((zoom + cambio) * 100) / 100));
}

export function cambio_zoom_gesto_pdf(delta_y: number, es_gesto_ampliacion: boolean): number {
  if (!es_gesto_ampliacion || !Number.isFinite(delta_y) || delta_y === 0) return 0;
  return Math.max(-.12, Math.min(.12, -delta_y / 400));
}

export function resolver_pagina_pdf(valor: string, total_paginas: number): number | null {
  if (!/^\d+$/u.test(valor.trim()) || !Number.isInteger(total_paginas) || total_paginas < 1) return null;
  const pagina = Number(valor);
  return pagina >= 1 && pagina <= total_paginas ? pagina : null;
}
