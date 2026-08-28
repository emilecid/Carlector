import DOMPurify from "dompurify";
import ePub from "epubjs";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import url_trabajador_pdf from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

import { clasificar_linea_pdf, type BloqueDocumento, type DocumentoProcesado } from "../core/documentos.ts";
import { detectar_lineas_marginales_repetidas, type LineaMarginalPdf } from "../core/limpieza_pdf.ts";
import type { EntradaIndice } from "../core/modelos.ts";
import { clasificar_estructura_epub } from "./semantica_epub.ts";

GlobalWorkerOptions.workerSrc = url_trabajador_pdf;
const VERSION_CACHE_DOCUMENTO = 5;

interface ElementoTextoPdf {
  str: string;
  transform: number[];
  fontName: string;
  hasEOL: boolean;
}

interface LineaPdf {
  posicion_y: number;
  elementos: ElementoTextoPdf[];
}

export type NotificadorExtraccion = (completados: number, total: number, etapa: string) => void;

function es_elemento_texto_pdf(valor: unknown): valor is ElementoTextoPdf {
  return typeof valor === "object" && valor !== null && "str" in valor && "transform" in valor;
}

function agrupar_lineas_pdf(elementos: ElementoTextoPdf[]): LineaPdf[] {
  const lineas: LineaPdf[] = [];
  const ordenados = [...elementos].sort((a, b) => (b.transform[5] ?? 0) - (a.transform[5] ?? 0));
  for (const elemento of ordenados) {
    const posicion_y = elemento.transform[5] ?? 0;
    const linea = lineas.at(-1);
    if (linea && Math.abs(linea.posicion_y - posicion_y) <= 3) linea.elementos.push(elemento);
    else lineas.push({ posicion_y, elementos: [elemento] });
  }
  return lineas
    .map((linea) => ({ ...linea, elementos: linea.elementos.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0)) }));
}

function ceder_control_interfaz(): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, 0));
}

export async function extraer_pdf(datos: ArrayBuffer, nombre_archivo: string, notificar?: NotificadorExtraccion): Promise<DocumentoProcesado> {
  const tarea = getDocument({ data: new Uint8Array(datos) });
  const pdf = await tarea.promise;
  const total_paginas = pdf.numPages;
  const bloques: BloqueDocumento[] = [];
  const lineas_extraidas: Array<LineaMarginalPdf & { fuentes: string[] }> = [];
  const metadata = await pdf.getMetadata().catch(() => null);

  for (let numero_pagina = 1; numero_pagina <= total_paginas; numero_pagina += 1) {
    const pagina = await pdf.getPage(numero_pagina);
    const contenido = await pagina.getTextContent({ disableNormalization: false });
    const alto_pagina = pagina.getViewport({ scale: 1 }).height;
    const elementos = contenido.items.filter(es_elemento_texto_pdf) as ElementoTextoPdf[];
    const lineas = agrupar_lineas_pdf(elementos);
    for (const [indice, linea] of lineas.entries()) {
      const texto = linea.elementos.map((elemento) => elemento.str).join(" ").replace(/\s+/g, " ").trim();
      if (!texto) continue;
      const fuentes = linea.elementos.map((elemento) => elemento.fontName);
      lineas_extraidas.push({ id: `pagina-${numero_pagina}-linea-${indice}`, pagina: numero_pagina, texto, posicion_y: linea.posicion_y, alto_pagina, fuentes });
    }
    pagina.cleanup();
    notificar?.(numero_pagina, total_paginas, "Extrayendo páginas");
    await ceder_control_interfaz();
  }
  const marginales = detectar_lineas_marginales_repetidas(lineas_extraidas);
  lineas_extraidas.filter(({ id }) => !marginales.has(id)).forEach(({ id, pagina, texto, fuentes }) => {
    bloques.push({ id, contenido: texto, tipo: clasificar_linea_pdf(texto, fuentes), pagina });
  });
  const informacion = metadata?.info as { Title?: string; Author?: string } | undefined;
  const indice_documento: EntradaIndice[] = [];
  const esquema = await pdf.getOutline().catch(() => null);
  async function recorrer_esquema(items: NonNullable<typeof esquema>, nivel = 1): Promise<void> {
    for (const item of items) {
      let destino = item.dest;
      if (typeof destino === "string") destino = await pdf.getDestination(destino);
      let pagina: number | null = null;
      if (Array.isArray(destino) && destino[0]) pagina = await pdf.getPageIndex(destino[0]).then((valor) => valor + 1).catch(() => null);
      const texto_objetivo = bloques.find((bloque) => bloque.pagina === pagina)?.contenido ?? item.title;
      if (item.title?.trim()) indice_documento.push({ titulo: item.title.trim(), nivel, texto_objetivo });
      if (item.items?.length) await recorrer_esquema(item.items, nivel + 1);
    }
  }
  if (esquema) await recorrer_esquema(esquema);
  await pdf.destroy();
  return {
    titulo: informacion?.Title?.trim() || nombre_archivo.replace(/\.pdf$/i, ""),
    autor: informacion?.Author?.trim() || "Autor desconocido",
    idioma: "",
    formato: "PDF",
    bloques,
    indice: indice_documento,
    total_paginas,
    version_cache: VERSION_CACHE_DOCUMENTO,
  };
}

function limpiar_documento_epub(documento: Document): Document {
  const copia = documento.cloneNode(true) as Document;
  copia.querySelectorAll("script,iframe,object,embed,form,link,meta[http-equiv]").forEach((elemento) => elemento.remove());
  copia.querySelectorAll("*").forEach((elemento) => {
    for (const atributo of [...elemento.attributes]) {
      if (/^on/i.test(atributo.name) || /^(?:src|href|xlink:href)$/i.test(atributo.name) && /^(?:https?:|data:|javascript:)/i.test(atributo.value.trim())) {
        elemento.removeAttribute(atributo.name);
      }
    }
  });
  return copia;
}

function extraer_texto_epub(elemento: Element): string {
  if (elemento.localName.toLowerCase() === "pre") return elemento.textContent?.replace(/\r\n?/g, "\n").trim() ?? "";
  if (elemento.localName.toLowerCase() === "table") {
    return [...elemento.querySelectorAll("tr")].map((fila) => [...fila.querySelectorAll("th,td")].map((celda) => celda.textContent?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean).join(" · ")).filter(Boolean).join("\n");
  }
  const copia = elemento.cloneNode(true) as Element;
  copia.querySelectorAll("br").forEach((salto) => salto.replaceWith("\n"));
  return (copia.textContent ?? "").replace(/[\t\f\v ]+/g, " ").replace(/ *\n */g, "\n").trim();
}

function calcular_tamano_relativo(elemento: Element): number {
  const tamanos_titulo: Record<string, number> = { h1: 1.8, h2: 1.55, h3: 1.35, h4: 1.2, h5: 1.1, h6: 1 };
  const etiqueta = elemento.localName.toLowerCase();
  const base = tamanos_titulo[etiqueta] ?? (etiqueta === "pre" || etiqueta === "table" ? .9 : 1);
  const declarado = (elemento.getAttribute("style") ?? "").match(/font-size\s*:\s*([\d.]+)\s*(%|em|rem|px)/i);
  if (!declarado) return base;
  const valor = Number(declarado[1]);
  const unidad = declarado[2]?.toLowerCase();
  const relativo = unidad === "%" ? valor / 100 : unidad === "px" ? valor / 16 : valor;
  return Number.isFinite(relativo) ? Math.min(2.4, Math.max(.7, relativo)) : base;
}

function extraer_alineacion(elemento: Element): "left" | "center" | "right" | "justify" | undefined {
  const estilo = elemento.getAttribute("style") ?? "";
  const alineacion = estilo.match(/text-align\s*:\s*(left|center|right|justify)/i)?.[1]?.toLowerCase();
  return alineacion === "left" || alineacion === "center" || alineacion === "right" || alineacion === "justify" ? alineacion : undefined;
}

function extraer_bloques_seccion(documento: Document, indice_seccion: number): { bloques: BloqueDocumento[]; indice: EntradaIndice[] } {
  const documento_limpio = limpiar_documento_epub(documento);
  const nombres_bloque = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "cite", "q", "aside", "pre", "math", "table"]);
  const elementos = [...documento_limpio.querySelectorAll("*")].filter((elemento) => {
    if (!nombres_bloque.has(elemento.localName.toLowerCase())) return false;
    let ancestro = elemento.parentElement;
    while (ancestro) {
      if (nombres_bloque.has(ancestro.localName.toLowerCase())) return false;
      ancestro = ancestro.parentElement;
    }
    return true;
  });
  const indice_documento: EntradaIndice[] = [];
  const bloques = elementos.flatMap((elemento, indice): BloqueDocumento[] => {
    if (elemento.localName.toLowerCase() === "math") {
      const prefijo = elemento.prefix;
      const prefijo_escapado = prefijo?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const expresion_prefijo = prefijo_escapado ? new RegExp(`(<\\/?)${prefijo_escapado}:`, "g") : null;
      const mathml_normalizado = expresion_prefijo
        ? elemento.outerHTML.replace(expresion_prefijo, "$1").replace(new RegExp(`xmlns:${prefijo_escapado}=`, "g"), "xmlns=")
        : elemento.outerHTML;
      const mathml = DOMPurify.sanitize(mathml_normalizado, { USE_PROFILES: { mathMl: true } });
      return mathml ? [{ id: `seccion-${indice_seccion}-bloque-${indice}`, contenido: mathml, tipo: "matematica" }] : [];
    }
    const etiqueta = elemento.localName.toLowerCase();
    const contenido = extraer_texto_epub(elemento);
    if (!contenido) return [];
    const nivel = /^h[1-6]$/i.test(etiqueta) ? Number(etiqueta.slice(1)) : undefined;
    if (nivel) indice_documento.push({ titulo: contenido, nivel, texto_objetivo: contenido });
    const tipo = etiqueta === "table" ? "tabla" : "texto";
    const tipo_epub = elemento.getAttribute("epub:type") ?? elemento.getAttribute("type") ?? "";
    const estructura = clasificar_estructura_epub(etiqueta, tipo_epub);
    return [{ id: `seccion-${indice_seccion}-bloque-${indice}`, contenido, tipo, estructura, nivel, tamano_relativo: calcular_tamano_relativo(elemento), alineacion: extraer_alineacion(elemento) }];
  });
  return { bloques, indice: indice_documento };
}

export async function extraer_epub(datos: ArrayBuffer, nombre_archivo: string, notificar?: NotificadorExtraccion): Promise<DocumentoProcesado> {
  const libro = ePub();
  await libro.open(new Uint8Array(datos) as unknown as ArrayBuffer, "binary");
  await libro.ready;
  const ruta_portada = await libro.loaded.cover.catch(() => "");
  const portada_extraida = ruta_portada && libro.archive ? await libro.archive.getBase64(ruta_portada).catch(() => undefined) : undefined;
  const portada = portada_extraida && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(portada_extraida) ? portada_extraida : undefined;
  const bloques: BloqueDocumento[] = [];
  const indice_documento: EntradaIndice[] = [];
  const secciones: Array<ReturnType<typeof libro.spine.first>> = [];
  libro.spine.each((seccion: ReturnType<typeof libro.spine.first>) => secciones.push(seccion));
  const secciones_lineales = secciones.filter((seccion) => seccion.linear);

  for (const [indice, seccion] of secciones_lineales.entries()) {
    const documento = await seccion.load(libro.load.bind(libro));
    const extraido = extraer_bloques_seccion(documento, indice);
    bloques.push(...extraido.bloques);
    indice_documento.push(...extraido.indice);
    seccion.unload();
    notificar?.(indice + 1, secciones_lineales.length, "Extrayendo capítulos");
    await ceder_control_interfaz();
  }

  const metadata = libro.packaging.metadata;
  libro.destroy();
  return {
    titulo: metadata.title?.trim() || nombre_archivo.replace(/\.epub$/i, ""),
    autor: metadata.creator?.trim() || "Autor desconocido",
    idioma: metadata.language?.trim() || "",
    formato: "EPUB",
    bloques,
    indice: indice_documento,
    portada,
    version_cache: VERSION_CACHE_DOCUMENTO,
  };
}

export async function extraer_documento(archivo: File): Promise<DocumentoProcesado> {
  const datos = await archivo.arrayBuffer();
  if (/\.pdf$/i.test(archivo.name)) return extraer_pdf(datos, archivo.name);
  if (/\.epub$/i.test(archivo.name)) return extraer_epub(datos, archivo.name);
  throw new Error("Formato no admitido. Seleccione PDF o EPUB.");
}
