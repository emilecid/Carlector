import { GlobalWorkerOptions, getDocument, TextLayer, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import url_trabajador_pdf from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

import { calcular_escala_pdf, ordenar_indices_texto_pdf, rangos_textos_pdf } from "../core/visor_pdf.ts";

GlobalWorkerOptions.workerSrc = url_trabajador_pdf;

interface ElementoTextoPosicionadoPdf {
  str: string;
  transform: number[];
}

function es_texto_posicionado_pdf(elemento: unknown): elemento is ElementoTextoPosicionadoPdf {
  return typeof elemento === "object" && elemento !== null && "str" in elemento && "transform" in elemento;
}

export interface OpcionesCascadaPdf {
  contenedor: HTMLElement;
  ancho_disponible: number;
  zoom: number;
  pagina_inicial: number;
  al_cambiar_pagina?: (pagina: number) => void;
  al_renderizar_pagina?: (pagina: number) => void;
}

export class VisorPdf {
  private tarea_carga: PDFDocumentLoadingTask | null = null;
  private documento: PDFDocumentProxy | null = null;
  private tareas_renderizado = new Set<RenderTask>();
  private capas_texto = new Set<TextLayer>();
  private paginas_renderizando = new Map<number, Promise<void>>();
  private observador_renderizado: IntersectionObserver | null = null;
  private observador_pagina: IntersectionObserver | null = null;
  private observador_miniaturas: IntersectionObserver | null = null;
  private visibilidad_paginas = new Map<number, number>();
  private contenedor: HTMLElement | null = null;
  private al_renderizar_pagina: ((pagina: number) => void) | null = null;
  private generacion_renderizado = 0;

  get total_paginas(): number {
    return this.documento?.numPages ?? 0;
  }

  async abrir(datos: ArrayBuffer): Promise<void> {
    await this.cerrar();
    this.tarea_carga = getDocument({ data: new Uint8Array(datos.slice(0)) });
    this.documento = await this.tarea_carga.promise;
  }

  async montar_cascada(opciones: OpcionesCascadaPdf): Promise<void> {
    if (!this.documento) throw new Error("El PDF original no está abierto.");
    await this.cancelar_cascada();
    const generacion = this.generacion_renderizado;
    this.contenedor = opciones.contenedor;
    this.al_renderizar_pagina = opciones.al_renderizar_pagina ?? null;
    opciones.contenedor.replaceChildren();
    const ancho = Math.max(240, opciones.ancho_disponible);
    for (let numero = 1; numero <= this.documento.numPages; numero += 1) {
      const hoja = document.createElement("article");
      hoja.className = "hoja-pdf-original";
      hoja.dataset.paginaPdf = String(numero);
      hoja.setAttribute("aria-label", `Página ${numero} de ${this.documento.numPages}`);
      hoja.style.width = `${ancho * opciones.zoom}px`;
      hoja.style.minHeight = `${ancho * opciones.zoom * 1.414}px`;
      const carga = document.createElement("span");
      carga.className = "carga-hoja-pdf";
      carga.textContent = `Preparando página ${numero}…`;
      hoja.append(carga);
      opciones.contenedor.append(hoja);
    }

    const renderizar = (elemento: Element): void => {
      const hoja = elemento as HTMLElement;
      const numero = Number(hoja.dataset.paginaPdf);
      if (Number.isInteger(numero)) void this.renderizar_hoja(hoja, numero, ancho, opciones.zoom, generacion);
    };
    if (typeof IntersectionObserver === "function") {
      this.observador_renderizado = new IntersectionObserver((entradas) => entradas.filter(({ isIntersecting }) => isIntersecting).forEach(({ target }) => renderizar(target)), { root: opciones.contenedor, rootMargin: "900px 0px" });
      opciones.contenedor.querySelectorAll("[data-pagina-pdf]").forEach((hoja) => this.observador_renderizado?.observe(hoja));
      this.observador_pagina = new IntersectionObserver((entradas) => {
        entradas.forEach(({ target, intersectionRatio }) => this.visibilidad_paginas.set(Number((target as HTMLElement).dataset.paginaPdf), intersectionRatio));
        const visible = [...this.visibilidad_paginas.entries()].sort((a, b) => b[1] - a[1])[0];
        if (visible && visible[1] > 0) opciones.al_cambiar_pagina?.(visible[0]);
      }, { root: opciones.contenedor, threshold: [0, .25, .5, .75, 1] });
      opciones.contenedor.querySelectorAll("[data-pagina-pdf]").forEach((hoja) => this.observador_pagina?.observe(hoja));
    }
    const inicial = Math.min(Math.max(1, Math.trunc(opciones.pagina_inicial)), this.documento.numPages);
    const hoja_inicial = opciones.contenedor.querySelector<HTMLElement>(`[data-pagina-pdf="${inicial}"]`);
    if (hoja_inicial) {
      await this.renderizar_hoja(hoja_inicial, inicial, ancho, opciones.zoom, generacion);
      hoja_inicial.scrollIntoView({ block: "start" });
    }
  }

  async ir_a_pagina(numero_pagina: number, comportamiento: ScrollBehavior = "smooth"): Promise<void> {
    if (!this.documento || !this.contenedor) return;
    const numero = Math.min(Math.max(1, Math.trunc(numero_pagina)), this.documento.numPages);
    const hoja = this.contenedor.querySelector<HTMLElement>(`[data-pagina-pdf="${numero}"]`);
    hoja?.scrollIntoView({ behavior: comportamiento, block: "start" });
  }

  async montar_miniaturas(contenedor: HTMLElement, al_seleccionar: (pagina: number) => void): Promise<void> {
    if (!this.documento) return;
    this.observador_miniaturas?.disconnect();
    contenedor.replaceChildren();
    for (let numero = 1; numero <= this.documento.numPages; numero += 1) {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.dataset.paginaMiniatura = String(numero);
      boton.setAttribute("aria-label", `Ir a página ${numero}`);
      boton.tabIndex = numero === 1 ? 0 : -1;
      const rotulo = document.createElement("span");
      rotulo.textContent = String(numero);
      boton.append(rotulo);
      boton.addEventListener("click", () => al_seleccionar(numero));
      boton.addEventListener("keydown", (evento) => {
        if (evento.key !== "ArrowLeft" && evento.key !== "ArrowRight" && evento.key !== "Home" && evento.key !== "End") return;
        evento.preventDefault();
        const destino = evento.key === "Home" ? 1 : evento.key === "End" ? this.documento?.numPages ?? numero : Math.min(Math.max(1, numero + (evento.key === "ArrowRight" ? 1 : -1)), this.documento?.numPages ?? numero);
        const siguiente = contenedor.querySelector<HTMLButtonElement>(`[data-pagina-miniatura="${destino}"]`);
        if (siguiente) { boton.tabIndex = -1; siguiente.tabIndex = 0; siguiente.focus(); siguiente.scrollIntoView({ block: "nearest", inline: "nearest" }); }
      });
      contenedor.append(boton);
    }
    const renderizar = (elemento: Element): void => { void this.renderizar_miniatura(elemento as HTMLButtonElement, Number((elemento as HTMLElement).dataset.paginaMiniatura)); };
    if (typeof IntersectionObserver === "function") {
      this.observador_miniaturas = new IntersectionObserver((entradas) => entradas.filter(({ isIntersecting }) => isIntersecting).forEach(({ target }) => renderizar(target)), { root: contenedor, rootMargin: "0px 500px" });
      contenedor.querySelectorAll("[data-pagina-miniatura]").forEach((miniatura) => this.observador_miniaturas?.observe(miniatura));
    } else contenedor.querySelectorAll("[data-pagina-miniatura]").forEach(renderizar);
    let x_inicial = 0;
    let scroll_inicial = 0;
    let arrastrando = false;
    contenedor.addEventListener("pointerdown", (evento) => {
      x_inicial = evento.clientX; scroll_inicial = contenedor.scrollLeft; arrastrando = false; contenedor.setPointerCapture(evento.pointerId);
    });
    contenedor.addEventListener("pointermove", (evento) => {
      if (!contenedor.hasPointerCapture(evento.pointerId)) return;
      const cambio = evento.clientX - x_inicial;
      if (Math.abs(cambio) > 4) arrastrando = true;
      contenedor.scrollLeft = scroll_inicial - cambio;
    });
    contenedor.addEventListener("click", (evento) => { if (arrastrando) { evento.preventDefault(); evento.stopPropagation(); arrastrando = false; } }, true);
  }

  private async renderizar_miniatura(boton: HTMLButtonElement, numero: number): Promise<void> {
    if (!this.documento || boton.dataset.renderizada === "true" || boton.dataset.renderizando === "true" || !Number.isInteger(numero)) return;
    boton.dataset.renderizando = "true";
    let tarea: RenderTask | null = null;
    try {
      const pagina = await this.documento.getPage(numero);
      const base = pagina.getViewport({ scale: 1 });
      const vista = pagina.getViewport({ scale: 92 / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(vista.width));
      canvas.height = Math.max(1, Math.round(vista.height));
      canvas.setAttribute("aria-hidden", "true");
      const contexto = canvas.getContext("2d");
      if (!contexto) return;
      tarea = pagina.render({ canvasContext: contexto, viewport: vista });
      this.tareas_renderizado.add(tarea);
      await tarea.promise;
      boton.prepend(canvas);
      boton.dataset.renderizada = "true";
    } catch {
      boton.title = "No se pudo cargar la miniatura. Se reintentará al volver a verla.";
    } finally {
      delete boton.dataset.renderizando;
      if (tarea) this.tareas_renderizado.delete(tarea);
    }
  }

  async cerrar(): Promise<void> {
    await this.cancelar_cascada();
    const tarea = this.tarea_carga;
    this.tarea_carga = null;
    this.documento = null;
    if (tarea) await tarea.destroy();
  }

  private async renderizar_hoja(hoja: HTMLElement, numero: number, ancho: number, zoom: number, generacion: number): Promise<void> {
    if (!this.documento || hoja.dataset.renderizada === "true" || generacion !== this.generacion_renderizado) return;
    const existente = this.paginas_renderizando.get(numero);
    if (existente) return existente;
    const promesa = this.dibujar_hoja(hoja, numero, ancho, zoom, generacion);
    this.paginas_renderizando.set(numero, promesa);
    try { await promesa; }
    finally { if (this.paginas_renderizando.get(numero) === promesa) this.paginas_renderizando.delete(numero); }
  }

  private async dibujar_hoja(hoja: HTMLElement, numero: number, ancho: number, zoom: number, generacion: number): Promise<void> {
    const documento = this.documento;
    if (!documento) return;
    const pagina = await documento.getPage(numero);
    if (generacion !== this.generacion_renderizado) { pagina.cleanup(); return; }
    const base = pagina.getViewport({ scale: 1 });
    const vista = pagina.getViewport({ scale: calcular_escala_pdf(ancho, base.width, zoom) });
    hoja.style.width = `${vista.width}px`;
    hoja.style.height = `${vista.height}px`;
    hoja.style.minHeight = "0";
    hoja.style.setProperty("--scale-factor", String(vista.scale));
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    const contexto = canvas.getContext("2d");
    if (!contexto) { pagina.cleanup(); throw new Error("Canvas 2D no disponible para mostrar el PDF."); }
    const escala_salida = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.floor(vista.width * escala_salida));
    canvas.height = Math.max(1, Math.floor(vista.height * escala_salida));
    canvas.style.width = `${vista.width}px`;
    canvas.style.height = `${vista.height}px`;
    const contenido_texto = await pagina.getTextContent({ includeMarkedContent: true, disableNormalization: true });
    const elementos_texto = contenido_texto.items.flatMap((elemento): ElementoTextoPosicionadoPdf[] => es_texto_posicionado_pdf(elemento) ? [{ str: elemento.str, transform: [...elemento.transform] }] : []);
    const capa = document.createElement("div");
    capa.className = "textLayer capa-texto-pdf";
    capa.setAttribute("aria-label", `Texto seleccionable de la página ${numero}`);
    const capa_texto = new TextLayer({ textContentSource: contenido_texto, container: capa, viewport: vista });
    this.capas_texto.add(capa_texto);
    const transformacion = escala_salida === 1 ? undefined : [escala_salida, 0, 0, escala_salida, 0, 0];
    const tarea = pagina.render({ canvasContext: contexto, viewport: vista, transform: transformacion });
    this.tareas_renderizado.add(tarea);
    hoja.replaceChildren(canvas, capa);
    try {
      await Promise.all([tarea.promise, capa_texto.render()]);
      if (generacion === this.generacion_renderizado) {
        const indices_visuales = elementos_texto.length === capa_texto.textDivs.length
          ? ordenar_indices_texto_pdf(elementos_texto.map(({ transform }) => ({ x: transform[4] ?? 0, y: transform[5] ?? 0 })))
          : capa_texto.textDivs.map((_, indice) => indice);
        const elementos_visuales = indices_visuales.map((indice) => capa_texto.textDivs[indice]).filter((elemento): elemento is HTMLSpanElement => Boolean(elemento));
        const rangos = rangos_textos_pdf(elementos_visuales.map((elemento) => elemento.textContent ?? ""));
        elementos_visuales.forEach((elemento, indice) => {
          const { inicio, fin } = rangos[indice] ?? { inicio: 0, fin: 0 };
          elemento.dataset.ordenTextoPdf = String(indice);
          elemento.dataset.inicioTextoPdf = String(inicio);
          elemento.dataset.finTextoPdf = String(fin);
          elemento.dataset.progresoTextoPdf = String((inicio + fin) / 2);
        });
        hoja.dataset.renderizada = "true";
        this.al_renderizar_pagina?.(numero);
      }
    } catch (error) {
      const nombre = error instanceof Error ? error.name : "";
      if (generacion === this.generacion_renderizado && nombre !== "RenderingCancelledException" && nombre !== "AbortException") throw error;
    } finally {
      this.tareas_renderizado.delete(tarea);
      this.capas_texto.delete(capa_texto);
      pagina.cleanup();
    }
  }

  private async cancelar_cascada(): Promise<void> {
    this.generacion_renderizado += 1;
    this.observador_renderizado?.disconnect();
    this.observador_pagina?.disconnect();
    this.observador_miniaturas?.disconnect();
    this.observador_renderizado = null;
    this.observador_pagina = null;
    this.observador_miniaturas = null;
    this.visibilidad_paginas.clear();
    this.al_renderizar_pagina = null;
    this.capas_texto.forEach((capa) => capa.cancel());
    this.capas_texto.clear();
    const tareas = [...this.tareas_renderizado];
    tareas.forEach((tarea) => tarea.cancel());
    await Promise.allSettled(tareas.map((tarea) => tarea.promise));
    this.tareas_renderizado.clear();
    await Promise.allSettled(this.paginas_renderizando.values());
    this.paginas_renderizando.clear();
    this.contenedor = null;
  }
}
