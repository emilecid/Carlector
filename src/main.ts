import { agregar_documento, buscar_documentos, filtrar_documentos, reordenar_documentos, type FiltroBiblioteca } from "./core/biblioteca.ts";
import { ATAJOS_PREDETERMINADOS, accion_de_atajo, atajo_desde_evento, atajo_en_conflicto, describir_atajo, type AccionAtajo } from "./core/atajos.ts";
import { normalizar_binario } from "./core/binarios.ts";
import { mostrar_configuracion_kokoro, normalizar_configuracion_kokoro, VOCES_KOKORO } from "./core/configuracion_voz.ts";
import { buscar_indices_texto } from "./core/busqueda_lector.ts";
import { calcular_ventana_renderizado, crear_lotes_renderizado } from "./core/carga_documento.ts";
import { calcular_plan_rsvp, indices_locuciones_adelantadas, type PasoRsvp } from "./core/cola_kokoro.ts";
import { convertir_bloques_a_texto, type DocumentoProcesado } from "./core/documentos.ts";
import type { CarpetaBiblioteca, DocumentoBiblioteca, EstadoLecturaDocumento, FragmentoGuardado, FragmentoLectura, NotaDocumento, PerfilLectura, PoliticaMatematica } from "./core/modelos.ts";
import { debe_guardar_progreso, fragmento_esta_destacado, resolver_destino_indice } from "./core/herramientas_lectura.ts";
import { resolver_indice_fragmento } from "./core/navegacion_lector.ts";
import { calcular_posicion_superpuesta, crear_ejecutor_diferido } from "./core/interfaz.ts";
import { abrir_pestana, ajustar_proporciones_paneles, cerrar_pestana, normalizar_documentos_divididos, normalizar_sesion_pestanas, proporciones_uniformes, type SesionDivision, type SesionPestanas } from "./core/pestanas.ts";
import { resolver_control_paquete_voz } from "./core/interfaz_voz.ts";
import { crear_informe_error } from "./core/informador_errores.ts";
import { ajustar_palabras_por_minuto, ajustar_velocidad, clases_visibilidad_paneles, TEMAS_PREDEFINIDOS, normalizar_perfil } from "./core/perfiles.ts";
import { segmentar_bloques, segmentar_texto } from "./core/segmentacion.ts";
import { agrupar_locuciones, indice_locucion_en_posicion } from "./core/tts.ts";
import { ajustar_zoom_pdf, cambio_zoom_gesto_pdf, indice_de_punto_pdf, indice_de_seleccion_pdf, indice_inicial_pagina, mapear_fragmentos_pdf, pagina_de_fragmento, rango_relativo_fragmento_pdf, rango_relativo_unidad_pdf, rango_textual_unidad_pdf, resolver_pagina_pdf, type RangoTextoPdf } from "./core/visor_pdf.ts";
import { BIBLIOTECA_TEMAS } from "./core/temas.ts";
import { combinar_estado_repositorios, type RepositorioVoz } from "./core/repositorios_voz.ts";
import { ReproductorWebAudio } from "./infra/reproductor_web_audio.ts";
import { persistencia } from "./infra/persistencia.ts";
import DOMPurify from "dompurify";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

const TEXTO_DEMOSTRACION = `La lectura asistida coordina atención visual y narración local. El documento se divide en fragmentos manejables para avanzar sin generar un audiolibro completo.

$$f(x) = \\int_a^b x^2 \\, dx$$

Esta ecuación permanece visible. Según el perfil, la voz puede leerla, omitirla o sustituirla por una indicación breve. El resaltado sigue la oración actual y el auto-scroll conserva el contexto.`;

const DOCUMENTO_DEMOSTRACION: DocumentoBiblioteca = {
  id: "demostracion", titulo: "Lectura matemática local", autor: "Documento de demostración",
  formato: "EPUB", ruta: "demo://lectura-matematica", progreso: 18,
  etiquetas: ["Demostración", "Matemáticas"], ultima_lectura: new Date().toISOString(),
};

let perfil_actual: PerfilLectura = persistencia.perfil();
let documentos: DocumentoBiblioteca[] = persistencia.documentos();
let carpetas: CarpetaBiblioteca[] = persistencia.carpetas();
let temas_personalizados = persistencia.temasPersonalizados();
let estados_repositorios_voz = persistencia.repositoriosVoz();
let repositorios_voz = combinar_estado_repositorios(estados_repositorios_voz);
let kokoro_instalado = false;
let informes_error_habilitados = persistencia.informesError();
let fragmentos_guardados: FragmentoGuardado[] = persistencia.fragmentos();
let notas_documento: NotaDocumento[] = persistencia.notas();
let sesion_pestanas: SesionPestanas = persistencia.pestanas();
let sesion_division: SesionDivision = persistencia.division();
let filtro_biblioteca: FiltroBiblioteca = { tipo: "raiz" };
let consulta_biblioteca = "";
let pestana_izquierda: "biblioteca" | "indice" = "biblioteca";
let pestana_derecha: "perfil" | "fragmentos" = "fragmentos";
let documento_actual: DocumentoBiblioteca | null = null;
let fragmentos: FragmentoLectura[] = [];
let indice_fragmento = 0;
let reproduciendo = false;
let vista_actual: "biblioteca" | "lector" = "biblioteca";
const documentos_procesados = new Map<string, DocumentoProcesado>();
const binarios_pdf_web = new Map<string, ArrayBuffer>();
const TAMANO_VENTANA_TTS = 12;
const TAMANO_LOTE_RENDERIZADO = 320;
const TAMANO_VENTANA_DOM = 600;
const VERSION_CACHE_DOCUMENTO = 6;
const CANTIDAD_ADELANTADA_KOKORO = 3;
let indice_resaltado_anterior = -1;
let ultimo_guardado_progreso = 0;
let generacion_voz = 0;
let preparando_voz = false;
let siguiente_indice_cola = 0;
let locuciones_pendientes = 0;
let generacion_renderizado = 0;
let documento_renderizando = false;
let temporizador_avance: number | null = null;
let temporizador_seguimiento_pdf: number | null = null;
let indice_unidad_rsvp = 0;
let indice_unidad_pdf = 0;
let unidades_seguimiento_pdf: string[] = [];
let indice_fragmento_seguimiento_pdf = -1;
const reproductor_kokoro = new ReproductorWebAudio();
let desbloqueo_audio_kokoro: Promise<void> = Promise.resolve();
interface SolicitudAudioKokoro { promesa: Promise<AudioBuffer>; lista: boolean }
const audios_kokoro = new Map<string, SolicitudAudioKokoro>();
let cadena_sintesis_kokoro: Promise<void> = Promise.resolve();
let consulta_global = "";
let resultados_busqueda_lector: number[] = [];
let posicion_resultado_busqueda = -1;
type ModoVisualPdf = "texto" | "original" | "doble";
interface ControlVisorPdf {
  readonly total_paginas: number;
  abrir(datos: ArrayBuffer): Promise<void>;
  montar_cascada(opciones: { contenedor: HTMLElement; ancho_disponible: number; zoom: number; pagina_inicial: number; al_cambiar_pagina?: (pagina: number) => void; al_renderizar_pagina?: (pagina: number) => void }): Promise<void>;
  ir_a_pagina(numero_pagina: number, comportamiento?: ScrollBehavior): Promise<void>;
  montar_miniaturas(contenedor: HTMLElement, al_seleccionar: (pagina: number) => void): Promise<void>;
  cerrar(): Promise<void>;
}
let modo_visual_pdf: ModoVisualPdf = "texto";
let visor_pdf: ControlVisorPdf | null = null;
let documento_visor_pdf: string | null = null;
let pagina_pdf_actual = 1;
let total_paginas_pdf = 0;
let zoom_pdf = 1;
const mapas_fragmentos_pdf = new WeakMap<HTMLElement, Map<number, RangoTextoPdf>>();
let mapeo_pdf_exacto = true;
let desplazamiento_pendiente: number | null = null;
let proporcion_pdf_doble = 50;
let miniaturas_pdf_visibles = persistencia.miniaturasPdf();
let autoscroll_suspendido = false;
let cola_apertura_archivos: Promise<void> = Promise.resolve();
const ultimos_guardados_paneles = new Map<string, number>();
let foco_antes_modal: HTMLElement | null = null;
let foco_antes_busqueda: HTMLElement | null = null;
const ETIQUETAS_ATAJOS: Record<AccionAtajo, string> = {
  buscar: "Buscar",
  reproducir: "Reproducir o pausar",
  anterior: "Fragmento anterior",
  siguiente: "Fragmento siguiente",
  modo_enfoque: "Modo lectura",
  alternar_pdf: "Cambiar vista PDF",
};
const CONSULTA_INTERFAZ_MOVIL = "(max-width:700px), (max-width:900px) and (pointer:coarse)";

function es_interfaz_movil(): boolean {
  return window.matchMedia(CONSULTA_INTERFAZ_MOVIL).matches;
}

if (!documentos.some((documento) => documento.id === DOCUMENTO_DEMOSTRACION.id)) {
  documentos = agregar_documento(documentos, DOCUMENTO_DEMOSTRACION);
  persistencia.guardarDocumentos(documentos);
}

function escapar_html(valor: string): string {
  const REEMPLAZOS: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
  return valor.replace(/[&<>'"]/g, (caracter) => REEMPLAZOS[caracter] ?? caracter);
}

function informar_error(contexto: string, error: unknown): void {
  const informe = crear_informe_error(contexto, error);
  console.error(`[${informe.contexto}] ${informe.detalle}`, error);
  if (!informes_error_habilitados) return;
  const modal = document.querySelector<HTMLElement>("#informador-error");
  const titulo = document.querySelector<HTMLElement>("#error-contexto");
  const detalle = document.querySelector<HTMLElement>("#error-detalle");
  const fecha = document.querySelector<HTMLElement>("#error-fecha");
  if (titulo) titulo.textContent = informe.contexto;
  if (detalle) detalle.textContent = informe.detalle;
  if (fecha) fecha.textContent = new Date(informe.fecha).toLocaleString();
  if (modal) {
    foco_antes_modal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.hidden = false;
    requestAnimationFrame(() => modal.querySelector<HTMLElement>("button")?.focus());
  }
}

function cerrar_informador_error(): void {
  const no_mostrar = document.querySelector<HTMLInputElement>("#no-mostrar-errores");
  if (no_mostrar?.checked) {
    informes_error_habilitados = false;
    persistencia.guardarInformesError(false);
    const control = document.querySelector<HTMLInputElement>("#mostrar-informes-error");
    if (control) control.checked = false;
  }
  if (no_mostrar) no_mostrar.checked = false;
  document.querySelector<HTMLElement>("#informador-error")?.setAttribute("hidden", "");
  foco_antes_modal?.focus();
  foco_antes_modal = null;
}

function abrir_modal(selector: string): void {
  const modal = document.querySelector<HTMLElement>(selector);
  if (!modal) return;
  foco_antes_modal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modal.hidden = false;
  requestAnimationFrame(() => modal.querySelector<HTMLElement>("button,input,select,[tabindex='0']")?.focus());
}

function cerrar_modal(selector: string): void {
  document.querySelector<HTMLElement>(selector)?.setAttribute("hidden", "");
  foco_antes_modal?.focus();
  foco_antes_modal = null;
}

function aplicar_perfil(): void {
  document.documentElement.style.setProperty("--fuente-lectura", perfil_actual.fuente);
  document.documentElement.style.setProperty("--tamano-lectura", `${perfil_actual.tamano_fuente}px`);
  document.documentElement.style.setProperty("--interlineado", String(perfil_actual.interlineado));
  document.documentElement.style.setProperty("--ancho-lectura", `${perfil_actual.ancho_lectura}px`);
  Object.entries(perfil_actual.colores).forEach(([nombre, color]) => document.documentElement.style.setProperty(`--${nombre}`, color));
  document.body.classList.toggle("modo-oscuro", perfil_actual.tema === "oscuro");
  document.body.classList.toggle("modo-enfoque", perfil_actual.modo_enfoque);
  document.body.classList.remove("sin-panel-biblioteca", "sin-panel-inspector");
  document.body.classList.add(...clases_visibilidad_paneles(perfil_actual.componentes));
  const boton_biblioteca = document.querySelector<HTMLButtonElement>("#alternar-panel-biblioteca");
  const boton_inspector = document.querySelector<HTMLButtonElement>("#alternar-panel-inspector");
  if (boton_biblioteca) {
    boton_biblioteca.textContent = perfil_actual.componentes.biblioteca ? "‹" : "›";
    boton_biblioteca.setAttribute("aria-label", perfil_actual.componentes.biblioteca ? "Ocultar biblioteca" : "Mostrar biblioteca");
    boton_biblioteca.setAttribute("aria-expanded", String(perfil_actual.componentes.biblioteca));
  }
  if (boton_inspector) {
    boton_inspector.textContent = perfil_actual.componentes.inspector ? "›" : "‹";
    boton_inspector.setAttribute("aria-label", perfil_actual.componentes.inspector ? "Ocultar perfil activo" : "Mostrar perfil activo");
    boton_inspector.setAttribute("aria-expanded", String(perfil_actual.componentes.inspector));
  }
}

function renderizar_pestanas_documentos(): void {
  const barra = document.querySelector<HTMLElement>("#pestanas-documentos");
  if (!barra) return;
  const foco = document.activeElement instanceof HTMLElement
    ? document.activeElement.dataset.pestanaDocumento ?? document.activeElement.dataset.dividirPestana ?? document.activeElement.dataset.cerrarPestana
    : undefined;
  const accion_foco = document.activeElement instanceof HTMLElement
    ? document.activeElement.hasAttribute("data-dividir-pestana") ? "dividir" : document.activeElement.hasAttribute("data-cerrar-pestana") ? "cerrar" : "pestana"
    : undefined;
  sesion_pestanas = normalizar_sesion_pestanas(sesion_pestanas, new Set(documentos.map(({ id }) => id)));
  sesion_division.documentos = normalizar_documentos_divididos(sesion_division.documentos, sesion_pestanas.activa, new Set(sesion_pestanas.abiertas));
  persistencia.guardarPestanas(sesion_pestanas);
  barra.innerHTML = sesion_pestanas.abiertas.map((id) => {
    const documento = documentos.find((actual) => actual.id === id);
    if (!documento) return "";
    const activa = vista_actual === "lector" && sesion_pestanas.activa === id;
    const dividida = sesion_division.documentos.includes(id);
    return `<span class="pestana-documento"><button type="button" role="tab" aria-selected="${activa}" tabindex="${activa ? "0" : "-1"}" data-pestana-documento="${escapar_html(id)}" title="${escapar_html(documento.titulo)}">${escapar_html(documento.titulo)}</button><button type="button" class="dividir-pestana ${dividida ? "activa" : ""}" data-dividir-pestana="${escapar_html(id)}" aria-pressed="${dividida}" aria-label="${dividida ? "Quitar de pantalla dividida" : "Mostrar junto al documento activo"}: ${escapar_html(documento.titulo)}" ${activa ? "disabled" : ""}>↔</button><button type="button" class="cerrar-pestana" data-cerrar-pestana="${escapar_html(id)}" aria-label="Cerrar ${escapar_html(documento.titulo)}">×</button></span>`;
  }).join("");
  if (foco && accion_foco) {
    const atributo = accion_foco === "dividir" ? "data-dividir-pestana" : accion_foco === "cerrar" ? "data-cerrar-pestana" : "data-pestana-documento";
    barra.querySelector<HTMLElement>(`[${atributo}="${CSS.escape(foco)}"]`)?.focus();
  }
  document.querySelector<HTMLElement>("[data-vista='biblioteca']")?.classList.toggle("activa", vista_actual === "biblioteca");
}

async function cerrar_pestana_documento(id: string): Promise<void> {
  const era_activa = sesion_pestanas.activa === id;
  if (era_activa) guardar_posicion_actual(true);
  sesion_pestanas = cerrar_pestana(sesion_pestanas, id);
  sesion_division.documentos = sesion_division.documentos.filter((actual) => actual !== id);
  persistencia.guardarPestanas(sesion_pestanas);
  persistencia.guardarDivision(sesion_division);
  if (era_activa && sesion_pestanas.activa) await abrir_documento(sesion_pestanas.activa);
  else if (era_activa) { documento_actual = null; cambiar_vista("biblioteca"); }
  renderizar_pestanas_documentos();
}

function alternar_pestana_dividida(id: string): void {
  if (id === sesion_pestanas.activa) return;
  sesion_division.documentos = sesion_division.documentos.includes(id)
    ? sesion_division.documentos.filter((actual) => actual !== id)
    : [...sesion_division.documentos, id].slice(-2);
  sesion_division.proporciones = proporciones_uniformes(sesion_division.documentos.length + 1);
  persistencia.guardarDivision(sesion_division);
  renderizar_pestanas_documentos();
  if (vista_actual === "lector") void renderizar_lector();
}

function crear_portada(documento: DocumentoBiblioteca): string {
  const clase = documento.id === "demostracion" ? "demo" : documento.formato.toLowerCase();
  return `<button class="tarjeta-libro" draggable="true" data-documento="${escapar_html(documento.id)}" title="Click derecho para editar, mover o eliminar">
    <span class="portada ${clase}"><span class="portada-formato">${documento.formato}</span>
    <strong class="portada-titulo">${escapar_html(documento.titulo)}</strong>
    <span class="portada-autor">${escapar_html(documento.autor || "Autor desconocido")}</span></span>
    <span class="libro-titulo">${escapar_html(documento.titulo)}</span><span class="libro-meta">${documento.progreso}% leído</span>
    <span class="progreso"><span style="width:${documento.progreso}%"></span></span></button>`;
}

function renderizar_biblioteca(consulta = consulta_biblioteca): void {
  consulta_biblioteca = consulta;
  const resultados = buscar_documentos(filtrar_documentos(documentos, filtro_biblioteca), consulta);
  const principal = document.querySelector<HTMLElement>("#vista-principal");
  if (!principal) return;
  const carpeta_activa = filtro_biblioteca.tipo === "carpeta" ? filtro_biblioteca.carpeta_id : null;
  const titulo = carpeta_activa ? carpetas.find(({ id }) => id === carpeta_activa)?.nombre ?? "Carpeta" : filtro_biblioteca.tipo === "todos" ? "Todos los libros" : filtro_biblioteca.tipo === "en_progreso" ? "En progreso" : "Biblioteca";
  const contenido = `<header class="cabecera-vista">
    <div><h1>${escapar_html(titulo)}</h1><p>${resultados.length} documentos · todo permanece en este equipo</p></div>
    </header>${resultados.length ? `<div class="cuadricula">${resultados.map(crear_portada).join("")}</div>` : `<section class="estado-vacio-biblioteca"><span aria-hidden="true">◇</span><strong>Esta vista está vacía</strong><p>Añade un libro o elige otra carpeta.</p></section>`}`;
  const biblioteca = principal.querySelector<HTMLElement>(".biblioteca");
  if (biblioteca) biblioteca.innerHTML = contenido;
  else principal.innerHTML = `<section class="biblioteca">${contenido}</section>`;
}

function obtener_tarjeta_documento(objetivo: EventTarget | null): HTMLElement | null {
  return objetivo instanceof Element ? objetivo.closest<HTMLElement>("[data-documento]") : null;
}

function enlazar_eventos_biblioteca(): void {
  const principal = document.querySelector<HTMLElement>("#vista-principal");
  if (!principal) return;
  principal.addEventListener("click", (evento) => {
    const tarjeta = obtener_tarjeta_documento(evento.target);
    if (tarjeta) void abrir_documento(tarjeta.dataset.documento ?? "");
  });
  principal.addEventListener("contextmenu", (evento) => {
    const tarjeta = obtener_tarjeta_documento(evento.target);
    if (!tarjeta) return;
    evento.preventDefault();
    abrir_menu_documento(tarjeta.dataset.documento ?? "", evento.clientX, evento.clientY);
  });
  principal.addEventListener("dragstart", (evento) => {
    const tarjeta = obtener_tarjeta_documento(evento.target);
    if (tarjeta) evento.dataTransfer?.setData("text/carlector-documento", tarjeta.dataset.documento ?? "");
  });
  principal.addEventListener("dragover", (evento) => { if (obtener_tarjeta_documento(evento.target)) evento.preventDefault(); });
  principal.addEventListener("drop", (evento) => {
    const tarjeta = obtener_tarjeta_documento(evento.target);
    if (!tarjeta) return;
    evento.preventDefault();
    const id_movido = evento.dataTransfer?.getData("text/carlector-documento") ?? "";
    if (id_movido) void ordenar_documento(id_movido, tarjeta.dataset.documento ?? "");
  });
}

function actualizar_indicador_busqueda(): void {
  const indicador = document.querySelector<HTMLElement>("#estado-busqueda-global");
  if (!indicador) return;
  const botones = document.querySelectorAll<HTMLButtonElement>("#busqueda-anterior, #busqueda-siguiente");
  if (!consulta_global.trim()) { indicador.textContent = ""; botones.forEach((boton) => { boton.hidden = true; }); return; }
  if (vista_actual === "biblioteca") {
    const cantidad = buscar_documentos(filtrar_documentos(documentos, filtro_biblioteca), consulta_global).length;
    indicador.textContent = `${cantidad} resultado${cantidad === 1 ? "" : "s"}`;
    botones.forEach((boton) => { boton.hidden = true; });
    return;
  }
  indicador.textContent = resultados_busqueda_lector.length
    ? `${posicion_resultado_busqueda + 1}/${resultados_busqueda_lector.length}`
    : "Sin resultados";
  botones.forEach((boton) => { boton.hidden = resultados_busqueda_lector.length === 0; });
}

function actualizar_busqueda_global(consulta: string): void {
  consulta_global = consulta;
  if (vista_actual === "biblioteca") {
    renderizar_biblioteca(consulta);
    actualizar_indicador_busqueda();
    return;
  }
  resultados_busqueda_lector = buscar_indices_texto(fragmentos.map(({ visible }) => visible), consulta);
  posicion_resultado_busqueda = resultados_busqueda_lector.length ? 0 : -1;
  const primer_resultado = resultados_busqueda_lector[0];
  if (primer_resultado !== undefined) mover_lector_a_fragmento(primer_resultado);
  actualizar_indicador_busqueda();
}

function abrir_busqueda_global(): void {
  const contenedor = document.querySelector<HTMLElement>(".busqueda-global");
  const buscador = document.querySelector<HTMLInputElement>("#busqueda-global");
  if (!contenedor || !buscador) return;
  if (contenedor.hidden) foco_antes_busqueda = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  contenedor.hidden = false;
  buscador.placeholder = vista_actual === "biblioteca" ? "Buscar en la biblioteca" : "Buscar en el documento";
  buscador.focus();
  buscador.select();
}

function cerrar_busqueda_global(devolver_foco = true): void {
  const contenedor = document.querySelector<HTMLElement>(".busqueda-global");
  const buscador = document.querySelector<HTMLInputElement>("#busqueda-global");
  actualizar_busqueda_diferida.cancelar();
  if (buscador) buscador.value = "";
  actualizar_busqueda_global("");
  if (contenedor) contenedor.hidden = true;
  if (devolver_foco) foco_antes_busqueda?.focus();
  foco_antes_busqueda = null;
}

const actualizar_busqueda_diferida = crear_ejecutor_diferido(actualizar_busqueda_global, 150);

function mover_resultado_busqueda(direccion: number): void {
  if (!resultados_busqueda_lector.length) return;
  posicion_resultado_busqueda = (posicion_resultado_busqueda + direccion + resultados_busqueda_lector.length) % resultados_busqueda_lector.length;
  const resultado = resultados_busqueda_lector[posicion_resultado_busqueda];
  if (resultado === undefined) return;
  mover_lector_a_fragmento(resultado);
  actualizar_indicador_busqueda();
}

function renderizar_panel_biblioteca(): void {
  const navegacion = document.querySelector<HTMLElement>("#navegacion-biblioteca");
  const arbol = document.querySelector<HTMLElement>("#carpetas-biblioteca");
  if (!navegacion || !arbol) return;
  const cantidad_progreso = documentos.filter(({ progreso }) => progreso > 0 && progreso < 100).length;
  const cantidad_raiz = documentos.filter(({ carpeta_id }) => !carpeta_id).length;
  navegacion.innerHTML = `<button class="nav-item ${filtro_biblioteca.tipo === "raiz" ? "activo" : ""}" data-filtro="raiz">▦ Biblioteca <span class="nav-contador">${cantidad_raiz}</span></button><button class="nav-item ${filtro_biblioteca.tipo === "todos" ? "activo" : ""}" data-filtro="todos">≡ Todos <span class="nav-contador">${documentos.length}</span></button><button class="nav-item ${filtro_biblioteca.tipo === "en_progreso" ? "activo" : ""}" data-filtro="en_progreso">◷ En progreso <span class="nav-contador">${cantidad_progreso}</span></button>`;
  arbol.innerHTML = carpetas.length
    ? carpetas.map((carpeta) => `<button class="nav-item ${filtro_biblioteca.tipo === "carpeta" && filtro_biblioteca.carpeta_id === carpeta.id ? "activo" : ""}" data-carpeta="${escapar_html(carpeta.id)}" title="Arrastra libros aquí; click derecho para editar">▸ ${escapar_html(carpeta.nombre)} <span class="nav-contador">${documentos.filter((documento) => documento.carpeta_id === carpeta.id).length}</span></button>`).join("")
    : `<p class="carpetas-vacias">Sin carpetas. Usa + para añadir una.</p>`;
  navegacion.querySelectorAll<HTMLElement>("[data-filtro]").forEach((boton) => boton.addEventListener("click", () => {
    filtro_biblioteca = { tipo: boton.dataset.filtro as "raiz" | "todos" | "en_progreso" };
    renderizar_panel_biblioteca(); renderizar_biblioteca();
  }));
  arbol.querySelectorAll<HTMLElement>("[data-carpeta]").forEach((boton) => {
    boton.addEventListener("click", () => { filtro_biblioteca = { tipo: "carpeta", carpeta_id: boton.dataset.carpeta ?? "" }; renderizar_panel_biblioteca(); renderizar_biblioteca(); });
    boton.addEventListener("dragover", (evento) => { evento.preventDefault(); boton.classList.add("destino-arrastre"); });
    boton.addEventListener("dragleave", () => boton.classList.remove("destino-arrastre"));
    boton.addEventListener("drop", (evento) => { evento.preventDefault(); boton.classList.remove("destino-arrastre"); void mover_documento_a_carpeta(evento.dataTransfer?.getData("text/carlector-documento") ?? "", boton.dataset.carpeta ?? null); });
    boton.addEventListener("contextmenu", (evento) => { evento.preventDefault(); abrir_menu_carpeta(boton.dataset.carpeta ?? "", evento.clientX, evento.clientY); });
  });
}

function renderizar_panel_izquierdo(): void {
  document.querySelectorAll<HTMLElement>("[data-pestana-izquierda]").forEach((boton) => boton.classList.toggle("activo", boton.dataset.pestanaIzquierda === pestana_izquierda));
  const contenido_biblioteca = document.querySelector<HTMLElement>("#contenido-biblioteca");
  const contenido_indice = document.querySelector<HTMLElement>("#contenido-indice");
  if (contenido_biblioteca) contenido_biblioteca.hidden = pestana_izquierda !== "biblioteca";
  if (contenido_indice) contenido_indice.hidden = pestana_izquierda !== "indice";
  if (pestana_izquierda === "biblioteca") { renderizar_panel_biblioteca(); return; }
  if (!contenido_indice) return;
  const entradas = documento_actual ? documentos_procesados.get(documento_actual.id)?.indice ?? [] : [];
  contenido_indice.innerHTML = entradas.length
    ? `<nav class="navegacion indice-documento">${entradas.map((entrada) => `<button class="nav-item" data-destino-indice="${escapar_html(entrada.texto_objetivo)}" ${documento_renderizando ? "disabled" : ""} style="padding-left:${10 + Math.min(entrada.nivel - 1, 4) * 12}px">${escapar_html(entrada.titulo)}</button>`).join("")}</nav>`
    : `<p class="carpetas-vacias">${documento_actual ? "Documento sin índice estructurado." : "Abre un documento para ver su índice."}</p>`;
  contenido_indice.querySelectorAll<HTMLElement>("[data-destino-indice]").forEach((boton) => boton.addEventListener("click", () => {
    const destino = resolver_destino_indice(fragmentos, boton.dataset.destinoIndice ?? "");
    if (destino !== null) { if (vista_actual !== "lector") cambiar_vista("lector"); mover_lector_a_fragmento(destino); }
  }));
}

function renderizar_panel_fragmentos(): void {
  document.querySelectorAll<HTMLElement>("[data-pestana-derecha]").forEach((boton) => boton.classList.toggle("activo", boton.dataset.pestanaDerecha === pestana_derecha));
  const perfil = document.querySelector<HTMLElement>("#contenido-perfil");
  const guardados = document.querySelector<HTMLElement>("#contenido-fragmentos");
  if (perfil) perfil.hidden = pestana_derecha !== "perfil";
  if (!guardados) return;
  guardados.hidden = pestana_derecha !== "fragmentos";
  const del_documento = documento_actual ? fragmentos_guardados.filter(({ documento_id }) => documento_id === documento_actual?.id) : [];
  const notas_del_documento = documento_actual ? notas_documento.filter(({ documento_id }) => documento_id === documento_actual?.id) : [];
  const controles_nota = documento_actual ? "" : "disabled";
  guardados.innerHTML = `<div class="libreta-documento"><section id="libreta-fragmentos" class="seccion-libreta"><h2 class="panel-titulo">Fragmentos</h2><div class="lista-fragmentos">${del_documento.length ? del_documento.map((guardado) => `<article class="fragmento-guardado"><button data-ir-fragmento="${guardado.indice_fragmento}">${escapar_html(guardado.texto)}</button><button class="boton-destacado ${fragmento_esta_destacado(guardado) ? "activo" : ""}" data-destacar-fragmento="${escapar_html(guardado.id)}" aria-label="${fragmento_esta_destacado(guardado) ? "Quitar destacado" : "Destacar fragmento"}" title="${fragmento_esta_destacado(guardado) ? "Quitar destacado" : "Destacar fragmento"}">${fragmento_esta_destacado(guardado) ? "★" : "☆"}</button><button data-eliminar-fragmento="${escapar_html(guardado.id)}" aria-label="Eliminar fragmento">×</button></article>`).join("") : `<p class="carpetas-vacias">Selecciona texto y usa click derecho para guardarlo.</p>`}</div></section><section id="libreta-notas" class="seccion-libreta"><h2 class="panel-titulo">Notas</h2><form id="formulario-nota" class="formulario-nota"><label class="oculto" for="texto-nota">Nueva nota</label><textarea id="texto-nota" rows="3" maxlength="4000" placeholder="Escribe una nota sobre este documento" ${controles_nota}></textarea><button class="boton primario" type="submit" ${controles_nota}>Guardar nota</button></form><div id="lista-notas" class="lista-notas">${notas_del_documento.length ? notas_del_documento.map((nota) => `<article class="nota-documento"><p>${escapar_html(nota.texto).replace(/\n/g, "<br>")}</p><button data-eliminar-nota="${escapar_html(nota.id)}" aria-label="Eliminar nota">×</button></article>`).join("") : `<p class="carpetas-vacias">${documento_actual ? "Aún no hay notas." : "Abre un documento para escribir notas."}</p>`}</div></section></div>`;
  guardados.querySelectorAll<HTMLElement>("[data-ir-fragmento]").forEach((boton) => boton.addEventListener("click", () => {
    const guardado = del_documento.find(({ indice_fragmento }) => indice_fragmento === Number(boton.dataset.irFragmento));
    const ancla_guardada = guardado?.ancla;
    const destino_ancla = ancla_guardada ? fragmentos.findIndex(({ ancla }) => Boolean(ancla && ancla.bloque_id === ancla_guardada.bloque_id && ancla.inicio <= ancla_guardada.inicio && ancla.fin >= ancla_guardada.inicio)) : -1;
    if (vista_actual !== "lector") cambiar_vista("lector"); mover_lector_a_fragmento(destino_ancla >= 0 ? destino_ancla : Number(boton.dataset.irFragmento));
  }));
  guardados.querySelectorAll<HTMLElement>("[data-eliminar-fragmento]").forEach((boton) => boton.addEventListener("click", () => void eliminar_fragmento_guardado(boton.dataset.eliminarFragmento ?? "")));
  guardados.querySelectorAll<HTMLElement>("[data-destacar-fragmento]").forEach((boton) => boton.addEventListener("click", () => void alternar_destacado_fragmento(boton.dataset.destacarFragmento ?? "")));
  guardados.querySelector<HTMLFormElement>("#formulario-nota")?.addEventListener("submit", (evento) => { evento.preventDefault(); void guardar_nota_manual(); });
  guardados.querySelectorAll<HTMLElement>("[data-eliminar-nota]").forEach((boton) => boton.addEventListener("click", () => void eliminar_nota_manual(boton.dataset.eliminarNota ?? "")));
}

function esperar_siguiente_cuadro(): Promise<void> {
  return new Promise((resolver) => requestAnimationFrame(() => resolver()));
}

function crear_html_fragmento(fragmento: FragmentoLectura, indice: number, indices_guardados: Set<number>): string {
  const visible = fragmento.visible.trim();
  const contenido = fragmento.tipo === "matematica" && /^<math[\s>]/i.test(visible)
    ? DOMPurify.sanitize(visible, { USE_PROFILES: { mathMl: true } })
    : escapar_html(visible.replace(/^\$\$|\$\$$/g, "")).replace(/\n/g, "<br>");
  return `${fragmento.salto_linea_antes ? "<br>" : ""}<span id="${fragmento.id}" class="fragmento ${fragmento.tipo} ${indice === indice_fragmento ? "activo" : "no-activo"} ${indices_guardados.has(indice) ? "guardado" : ""}" role="button" tabindex="0" aria-label="Leer desde aquí" data-indice-fragmento="${indice}">${contenido}</span> `;
}

function crear_html_rango(inicio: number, fin: number, indices_guardados: Set<number>): string {
  let bloque_abierto = "";
  let html = "";
  fragmentos.slice(inicio, fin).forEach((fragmento, desplazamiento) => {
    const bloque = fragmento.bloque_id ?? fragmento.id;
    if (bloque !== bloque_abierto) {
      if (bloque_abierto) html += "</div>";
      const estructura = fragmento.estructura ?? "parrafo";
      const tamano = fragmento.tamano_relativo ?? 1;
      const alineacion = fragmento.alineacion ?? "left";
      html += `<div class="bloque-epub estructura-${estructura}" style="--tamano-relativo:${tamano};text-align:${alineacion}">`;
      bloque_abierto = bloque;
    }
    html += crear_html_fragmento(fragmento, inicio + desplazamiento, indices_guardados);
  });
  return bloque_abierto ? `${html}</div>` : html;
}

function montar_ventana_fragmentos(articulo: HTMLElement): void {
  const ventana = calcular_ventana_renderizado(fragmentos.length, indice_fragmento, TAMANO_VENTANA_DOM);
  const indices_guardados = new Set(fragmentos_guardados.filter((guardado) => guardado.documento_id === documento_actual?.id && fragmento_esta_destacado(guardado)).map(({ indice_fragmento }) => indice_fragmento));
  const anterior = ventana.inicio > 0 ? `<button class="cargar-tramo" data-cargar-ventana="${ventana.inicio - 1}">↑ Mostrar tramo anterior</button>` : "";
  const siguiente = ventana.fin < fragmentos.length ? `<button class="cargar-tramo" data-cargar-ventana="${ventana.fin}">Mostrar tramo siguiente ↓</button>` : "";
  articulo.innerHTML = `${anterior}${crear_html_rango(ventana.inicio, ventana.fin, indices_guardados)}${siguiente}`;
}

function actualizar_preparacion_documento(etapa: string, progreso: number): void {
  const indicador = document.querySelector<HTMLElement>("#preparacion-documento");
  const texto_etapa = indicador?.querySelector<HTMLElement>("[data-etapa-preparacion]");
  const barra = indicador?.querySelector<HTMLProgressElement>("progress");
  const porcentaje = indicador?.querySelector<HTMLElement>("[data-porcentaje-preparacion]");
  if (texto_etapa) texto_etapa.textContent = etapa;
  if (barra) barra.value = Math.max(0, Math.min(100, progreso));
  if (porcentaje) porcentaje.textContent = `${Math.round(progreso)}%`;
}

function es_vista_pdf_original(): boolean {
  return documento_actual?.formato === "PDF" && modo_visual_pdf !== "texto";
}

async function cerrar_visor_pdf(): Promise<void> {
  const visor = visor_pdf;
  visor_pdf = null;
  documento_visor_pdf = null;
  total_paginas_pdf = 0;
  if (visor) await visor.cerrar();
}

async function obtener_binario_pdf(documento: DocumentoBiblioteca): Promise<ArrayBuffer> {
  const binario_web = binarios_pdf_web.get(documento.id);
  if (binario_web) return binario_web.slice(0);
  if (isTauri()) return normalizar_binario(await invoke<unknown>("leer_documento", { idDocumento: documento.id }));
  throw new Error("El PDF original debe volver a añadirse para mostrarlo en esta sesión.");
}

function crear_cabecera_lector(es_original: boolean): string {
  if (!documento_actual) return "";
  if (documento_actual.formato === "PDF") return `<div class="lector-cabecera"><div id="herramientas-pdf" class="herramientas-pdf"><div class="selector-vista-pdf" role="group" aria-label="Presentación del PDF"><button id="vista-pdf-texto" type="button">Texto adaptado</button><button id="vista-pdf-original" type="button">Documento original</button><button id="modo-pdf-doble" type="button">PDF + RSVP</button></div><form id="salto-pagina-pdf" class="salto-pagina-pdf"><label for="numero-pagina-pdf">Página</label><input id="numero-pagina-pdf" type="number" min="1" step="1" inputmode="numeric"><span id="total-paginas-pdf">/—</span><button id="ir-pagina-pdf" type="submit">Ir</button><span id="error-pagina-pdf" role="status"></span></form></div></div>`;
  if (perfil_actual.modo_lectura === "rsvp" && !es_original) return "";
  return `<div class="lector-cabecera"><span>${escapar_html(documento_actual.formato)} · lectura local</span></div>`;
}

function crear_visor_pdf_original(): string {
  return `<section class="visor-pdf-original ${miniaturas_pdf_visibles ? "" : "sin-miniaturas"}" aria-label="PDF original">
    <div class="barra-visor-pdf">
      <span id="estado-pagina-pdf">Página —</span>
      <span class="separador-visor-pdf"></span>
      <button id="zoom-pdf-menos" class="boton-icono" type="button" aria-label="Reducir PDF">−</button>
      <span id="estado-zoom-pdf">100%</span>
      <button id="zoom-pdf-mas" class="boton-icono" type="button" aria-label="Ampliar PDF">+</button>
      <button id="alternar-miniaturas-pdf" class="boton" type="button" aria-controls="visor-miniaturas-pdf" aria-expanded="${miniaturas_pdf_visibles}">${miniaturas_pdf_visibles ? "Ocultar miniaturas" : "Mostrar miniaturas"}</button>
      <span id="estado-seleccion-pdf">Selecciona texto para comenzar desde allí</span>
    </div>
    <div id="contenedor-paginas-pdf" class="contenedor-paginas-pdf" aria-busy="true"></div>
    <aside id="visor-miniaturas-pdf" class="visor-miniaturas-pdf" aria-label="Previsualización de páginas" ${miniaturas_pdf_visibles ? "" : "hidden"}><div id="miniaturas-pdf" class="miniaturas-pdf"></div></aside>
  </section>`;
}

function alternar_miniaturas_pdf(): void {
  miniaturas_pdf_visibles = !miniaturas_pdf_visibles;
  persistencia.guardarMiniaturasPdf(miniaturas_pdf_visibles);
  const visor = document.querySelector<HTMLElement>(".visor-pdf-original");
  const miniaturas = document.querySelector<HTMLElement>("#visor-miniaturas-pdf");
  const boton = document.querySelector<HTMLButtonElement>("#alternar-miniaturas-pdf");
  visor?.classList.toggle("sin-miniaturas", !miniaturas_pdf_visibles);
  if (miniaturas) miniaturas.hidden = !miniaturas_pdf_visibles;
  if (boton) {
    boton.textContent = miniaturas_pdf_visibles ? "Ocultar miniaturas" : "Mostrar miniaturas";
    boton.setAttribute("aria-expanded", String(miniaturas_pdf_visibles));
  }
  if (miniaturas_pdf_visibles) actualizar_barra_visor_pdf();
}

function crear_vista_pdf_doble(): string {
  return `<section id="vista-pdf-doble" class="vista-pdf-doble" style="--proporcion-pdf:${proporcion_pdf_doble}%">
    ${crear_visor_pdf_original()}
    <button class="divisor-pdf-rsvp" type="button" role="separator" aria-orientation="vertical" aria-label="Ajustar ancho del PDF y RSVP" aria-valuemin="25" aria-valuemax="75" aria-valuenow="${proporcion_pdf_doble}"></button>
    <section id="panel-rsvp-doble" class="visor-rsvp" aria-label="Lectura RSVP"><div id="texto-rsvp" role="status" aria-live="polite" aria-atomic="true"></div></section>
  </section>`;
}

function actualizar_barra_visor_pdf(): void {
  const estado_pagina = document.querySelector<HTMLElement>("#estado-pagina-pdf");
  const estado_zoom = document.querySelector<HTMLElement>("#estado-zoom-pdf");
  if (estado_pagina) estado_pagina.textContent = total_paginas_pdf ? `Página ${pagina_pdf_actual} de ${total_paginas_pdf}` : "Página —";
  if (estado_zoom) estado_zoom.textContent = `${Math.round(zoom_pdf * 100)}%`;
  document.querySelectorAll<HTMLButtonElement>("[data-pagina-miniatura]").forEach((miniatura) => {
    const activa = Number(miniatura.dataset.paginaMiniatura) === pagina_pdf_actual;
    miniatura.setAttribute("aria-current", String(activa));
    miniatura.tabIndex = activa ? 0 : -1;
    if (activa) miniatura.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  actualizar_herramientas_pdf();
}

function cantidad_paginas_pdf_actual(): number {
  if (documento_actual?.formato !== "PDF") return 0;
  const procesado = documentos_procesados.get(documento_actual.id);
  const desde_bloques = Math.max(0, ...(procesado?.bloques.map(({ pagina }) => pagina ?? 0) ?? []));
  return Math.max(total_paginas_pdf, procesado?.total_paginas ?? 0, desde_bloques);
}

function actualizar_herramientas_pdf(): void {
  const herramientas = document.querySelector<HTMLElement>("#herramientas-pdf");
  if (!herramientas) return;
  const total = cantidad_paginas_pdf_actual();
  const texto = document.querySelector<HTMLButtonElement>("#vista-pdf-texto");
  const original = document.querySelector<HTMLButtonElement>("#vista-pdf-original");
  const doble = document.querySelector<HTMLButtonElement>("#modo-pdf-doble");
  const entrada = document.querySelector<HTMLInputElement>("#numero-pagina-pdf");
  const limite = document.querySelector<HTMLElement>("#total-paginas-pdf");
  texto?.classList.toggle("activo", modo_visual_pdf === "texto");
  original?.classList.toggle("activo", modo_visual_pdf === "original");
  doble?.classList.toggle("activo", modo_visual_pdf === "doble");
  texto?.setAttribute("aria-pressed", String(modo_visual_pdf === "texto"));
  original?.setAttribute("aria-pressed", String(modo_visual_pdf === "original"));
  doble?.setAttribute("aria-pressed", String(modo_visual_pdf === "doble"));
  if (entrada) {
    entrada.max = String(Math.max(1, total));
    entrada.disabled = total < 1;
    if (document.activeElement !== entrada) entrada.value = String(Math.max(1, pagina_pdf_actual));
  }
  if (limite) limite.textContent = total > 0 ? `/${total}` : "/—";
}

async function preparar_visor_pdf(): Promise<ControlVisorPdf> {
  if (!documento_actual || documento_actual.formato !== "PDF") throw new Error("El documento abierto no es PDF.");
  if (visor_pdf && documento_visor_pdf === documento_actual.id) return visor_pdf;
  await cerrar_visor_pdf();
  const datos = await obtener_binario_pdf(documento_actual);
  const { VisorPdf } = await import("./infra/visor_pdf.ts");
  const nuevo_visor = new VisorPdf();
  await nuevo_visor.abrir(datos);
  visor_pdf = nuevo_visor;
  documento_visor_pdf = documento_actual.id;
  total_paginas_pdf = nuevo_visor.total_paginas;
  return nuevo_visor;
}

async function renderizar_pagina_pdf(numero_pagina?: number): Promise<void> {
  if (!es_vista_pdf_original() || !documento_actual) return;
  const id_documento = documento_actual.id;
  const generacion = generacion_renderizado;
  const contenedor = document.querySelector<HTMLElement>("#contenedor-paginas-pdf");
  if (!contenedor) return;
  contenedor.setAttribute("aria-busy", "true");
  try {
    const visor = await preparar_visor_pdf();
    if (generacion !== generacion_renderizado || documento_actual?.id !== id_documento || !es_vista_pdf_original()) return;
    const pagina_objetivo = numero_pagina ?? pagina_de_fragmento(fragmentos, indice_fragmento, pagina_pdf_actual, visor.total_paginas);
    pagina_pdf_actual = Math.min(Math.max(1, Math.trunc(pagina_objetivo)), Math.max(1, visor.total_paginas));
    total_paginas_pdf = visor.total_paginas;
    actualizar_barra_visor_pdf();
    await visor.montar_cascada({
      contenedor,
      ancho_disponible: Math.max(es_interfaz_movil() ? 160 : 240, contenedor.clientWidth - 32),
      zoom: zoom_pdf,
      pagina_inicial: pagina_pdf_actual,
      al_cambiar_pagina: (pagina) => { pagina_pdf_actual = pagina; actualizar_barra_visor_pdf(); guardar_posicion_actual(); },
      al_renderizar_pagina: (pagina) => resaltar_fragmento_pdf(pagina),
    });
    const miniaturas = document.querySelector<HTMLElement>("#miniaturas-pdf");
    if (miniaturas) await visor.montar_miniaturas(miniaturas, (pagina) => {
      pagina_pdf_actual = pagina;
      actualizar_barra_visor_pdf();
      void visor.ir_a_pagina(pagina);
      guardar_posicion_actual(true);
    });
    if (generacion !== generacion_renderizado || documento_actual?.id !== id_documento) return;
    contenedor.setAttribute("aria-busy", "false");
    restaurar_desplazamiento_guardado();
  } catch (error) {
    contenedor.setAttribute("aria-busy", "false");
    contenedor.innerHTML = `<span class="estado-carga-pdf">No fue posible mostrar el PDF.</span>`;
    informar_error("Visor PDF original", error);
  }
}

function sincronizar_pagina_pdf_con_fragmento(): void {
  if (!es_vista_pdf_original() || total_paginas_pdf <= 0) return;
  const pagina = pagina_de_fragmento(fragmentos, indice_fragmento, pagina_pdf_actual, total_paginas_pdf);
  if (pagina === pagina_pdf_actual) return;
  pagina_pdf_actual = pagina;
  actualizar_barra_visor_pdf();
  void visor_pdf?.ir_a_pagina(pagina, reproduciendo ? "auto" : "smooth");
}

const renderizar_zoom_pdf_diferido = crear_ejecutor_diferido(() => { if (es_vista_pdf_original()) void renderizar_pagina_pdf(pagina_pdf_actual); }, 120);

function cambiar_zoom_pdf(cambio: number, diferir_renderizado = false): void {
  const nuevo_zoom = ajustar_zoom_pdf(zoom_pdf, cambio);
  if (nuevo_zoom === zoom_pdf) return;
  zoom_pdf = nuevo_zoom;
  actualizar_barra_visor_pdf();
  if (diferir_renderizado) renderizar_zoom_pdf_diferido();
  else { renderizar_zoom_pdf_diferido.cancelar(); void renderizar_pagina_pdf(pagina_pdf_actual); }
}

function resolver_seleccion_pdf(): { texto: string; indice: number } | null {
  const seleccion = window.getSelection();
  const texto = seleccion?.toString().trim() ?? "";
  const nodo = seleccion?.anchorNode;
  const origen = nodo instanceof Element ? nodo : nodo?.parentElement;
  const hoja = origen?.closest<HTMLElement>("[data-pagina-pdf]");
  const pagina = Number(hoja?.dataset.paginaPdf);
  if (!texto || !Number.isInteger(pagina)) return null;
  const indice = indice_de_seleccion_pdf(fragmentos, pagina, texto);
  return indice === null ? null : { texto, indice };
}

function actualizar_estado_fragmento_pdf(): void {
  const estado = document.querySelector<HTMLElement>("#estado-seleccion-pdf");
  if (!estado || !fragmentos.length) return;
  const seguimiento = estado_seguimiento_pdf();
  const unidad = seguimiento.unidades.length ? ` · palabra ${seguimiento.indice + 1}/${seguimiento.unidades.length}` : "";
  const precision = mapeo_pdf_exacto ? "" : " · ubicación aproximada";
  estado.textContent = `Fragmento ${indice_fragmento + 1}${unidad}${precision} · ${perfil_actual.voz_habilitada ? "voz activa" : "voz desactivada"}`;
}

function estado_seguimiento_pdf(): { unidades: string[]; indice: number } {
  if (perfil_actual.modo_lectura === "rsvp" && es_vista_pdf_original()) {
    const unidades = obtener_unidades_rsvp();
    return { unidades, indice: Math.min(indice_unidad_rsvp, Math.max(0, unidades.length - 1)) };
  }
  if (indice_fragmento_seguimiento_pdf !== indice_fragmento) return { unidades: [], indice: 0 };
  return { unidades: unidades_seguimiento_pdf, indice: Math.min(indice_unidad_pdf, Math.max(0, unidades_seguimiento_pdf.length - 1)) };
}

function limpiar_marcas_pdf(): void {
  document.querySelectorAll<HTMLElement>(".fragmento-pdf-activo,.unidad-pdf-activa").forEach((elemento) => {
    elemento.classList.remove("fragmento-pdf-activo", "unidad-pdf-activa");
    elemento.removeAttribute("aria-current");
    elemento.style.removeProperty("--inicio-unidad-pdf");
    elemento.style.removeProperty("--fin-unidad-pdf");
  });
}

function obtener_rango_visual_fragmento_pdf(hoja: HTMLElement, elementos: HTMLElement[], pagina: number): { rango: RangoTextoPdf; exacto: boolean } | null {
  let mapa = mapas_fragmentos_pdf.get(hoja);
  if (!mapa) {
    mapa = new Map(mapear_fragmentos_pdf(fragmentos, pagina, elementos.map((elemento) => elemento.textContent ?? "")).map(({ indice_fragmento: indice, inicio, fin }) => [indice, { inicio, fin }]));
    mapas_fragmentos_pdf.set(hoja, mapa);
  }
  const exacto = mapa.get(indice_fragmento);
  if (exacto) return { rango: exacto, exacto: true };
  const aproximado = rango_relativo_fragmento_pdf(fragmentos, indice_fragmento);
  return aproximado ? { rango: aproximado, exacto: false } : null;
}

function resaltar_fragmento_pdf(pagina_renderizada?: number): void {
  const fragmento = fragmentos[indice_fragmento];
  const pagina = fragmento?.pagina;
  if (!fragmento || pagina === undefined || pagina_renderizada !== undefined && pagina_renderizada !== pagina) return;
  limpiar_marcas_pdf();
  const hoja = document.querySelector<HTMLElement>(`[data-pagina-pdf="${pagina}"]`);
  const elementos = [...(hoja?.querySelectorAll<HTMLElement>("[data-progreso-texto-pdf]") ?? [])].sort((a, b) => Number(a.dataset.ordenTextoPdf) - Number(b.dataset.ordenTextoPdf));
  if (!hoja) return;
  const mapeo = obtener_rango_visual_fragmento_pdf(hoja, elementos, pagina);
  if (!mapeo) return;
  const { rango } = mapeo;
  mapeo_pdf_exacto = mapeo.exacto;
  let activos = elementos.filter((elemento) => {
    const inicio = Number(elemento.dataset.inicioTextoPdf);
    const fin = Number(elemento.dataset.finTextoPdf);
    return Number.isFinite(inicio) && Number.isFinite(fin) && fin > rango.inicio && inicio < rango.fin;
  });
  if (!activos.length && elementos.length) {
    const centro = (rango.inicio + rango.fin) / 2;
    activos = [elementos.reduce((mejor, elemento) => Math.abs(Number(elemento.dataset.progresoTextoPdf) - centro) < Math.abs(Number(mejor.dataset.progresoTextoPdf) - centro) ? elemento : mejor)];
  }
  activos.forEach((elemento) => elemento.classList.add("fragmento-pdf-activo"));
  const seguimiento = estado_seguimiento_pdf();
  const pesos = seguimiento.unidades.map((unidad, indice) => Math.max(1, [...unidad].length + (indice < seguimiento.unidades.length - 1 ? 1 : 0)));
  const rango_unidad = rango_textual_unidad_pdf(fragmento.visible, seguimiento.unidades, seguimiento.indice, rango)
    ?? rango_relativo_unidad_pdf(fragmentos, indice_fragmento, seguimiento.indice, pesos, rango);
  const unidades_activas = rango_unidad ? elementos.filter((elemento) => {
    const inicio = Number(elemento.dataset.inicioTextoPdf);
    const fin = Number(elemento.dataset.finTextoPdf);
    if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= rango_unidad.inicio || inicio >= rango_unidad.fin) return false;
    const ancho = Math.max(Number.EPSILON, fin - inicio);
    const inicio_local = Math.max(0, (rango_unidad.inicio - inicio) / ancho) * 100;
    const fin_local = Math.min(1, (rango_unidad.fin - inicio) / ancho) * 100;
    elemento.style.setProperty("--inicio-unidad-pdf", `${inicio_local}%`);
    elemento.style.setProperty("--fin-unidad-pdf", `${fin_local}%`);
    return true;
  }) : [];
  unidades_activas.forEach((elemento) => { elemento.classList.add("unidad-pdf-activa"); elemento.setAttribute("aria-current", "true"); });
  if (!unidades_activas.length) activos[0]?.setAttribute("aria-current", "true");
  const destino_scroll = unidades_activas[0] ?? activos[0];
  if (perfil_actual.auto_scroll && !autoscroll_suspendido) destino_scroll?.scrollIntoView({ behavior: reproduciendo ? "auto" : "smooth", block: "center", inline: "nearest" });
  actualizar_estado_fragmento_pdf();
}

function anclar_click_pdf(evento: Event): void {
  if (window.getSelection()?.toString().trim()) return;
  const elemento = evento.target instanceof Element ? evento.target.closest<HTMLElement>("[data-progreso-texto-pdf]") : null;
  const hoja = elemento?.closest<HTMLElement>("[data-pagina-pdf]");
  const pagina = Number(hoja?.dataset.paginaPdf);
  const progreso = Number(elemento?.dataset.progresoTextoPdf);
  if (!elemento || !Number.isInteger(pagina) || !Number.isFinite(progreso)) return;
  const indice = indice_de_punto_pdf(fragmentos, pagina, progreso, elemento.textContent ?? "");
  if (indice === null) return;
  mover_lector_a_fragmento(indice);
  actualizar_estado_fragmento_pdf();
}

function suspender_autoscroll_manual(): void {
  if (reproduciendo) autoscroll_suspendido = true;
}

function anclar_seleccion_pdf(): void {
  const seleccion = resolver_seleccion_pdf();
  if (!seleccion) return;
  mover_lector_a_fragmento(seleccion.indice);
  actualizar_estado_fragmento_pdf();
}

async function establecer_vista_pdf(modo: ModoVisualPdf): Promise<void> {
  if (documento_actual?.formato !== "PDF" || vista_actual !== "lector" || modo_visual_pdf === modo) return;
  guardar_posicion_actual(true);
  detener_voz();
  modo_visual_pdf = modo;
  if (modo_visual_pdf === "texto") await cerrar_visor_pdf();
  await renderizar_lector();
  actualizar_herramientas_pdf();
  guardar_posicion_actual(true);
}

async function saltar_a_pagina_pdf(): Promise<void> {
  if (documento_actual?.formato !== "PDF" || vista_actual !== "lector") return;
  const entrada = document.querySelector<HTMLInputElement>("#numero-pagina-pdf");
  const error = document.querySelector<HTMLElement>("#error-pagina-pdf");
  const total = cantidad_paginas_pdf_actual();
  const pagina = resolver_pagina_pdf(entrada?.value ?? "", total);
  if (pagina === null) {
    entrada?.setAttribute("aria-invalid", "true");
    if (error) error.textContent = total > 0 ? `Usa 1–${total}` : "Páginas no disponibles";
    return;
  }
  entrada?.removeAttribute("aria-invalid");
  if (error) error.textContent = "";
  pagina_pdf_actual = pagina;
  if (entrada) entrada.value = String(pagina);
  const indice = indice_inicial_pagina(fragmentos, pagina);
  if (modo_visual_pdf === "texto" && indice !== null) {
    mover_lector_a_fragmento(indice);
    return;
  }
  if (modo_visual_pdf === "texto") await establecer_vista_pdf("original");
  actualizar_barra_visor_pdf();
  await visor_pdf?.ir_a_pagina(pagina);
}

function enlazar_eventos_visor_pdf(): void {
  document.querySelector("#vista-pdf-texto")?.addEventListener("click", () => void establecer_vista_pdf("texto"));
  document.querySelector("#vista-pdf-original")?.addEventListener("click", () => void establecer_vista_pdf("original"));
  document.querySelector("#modo-pdf-doble")?.addEventListener("click", () => void establecer_vista_pdf("doble"));
  document.querySelector("#salto-pagina-pdf")?.addEventListener("submit", (evento) => { evento.preventDefault(); void saltar_a_pagina_pdf(); });
  document.querySelector("#zoom-pdf-menos")?.addEventListener("click", () => cambiar_zoom_pdf(-.25));
  document.querySelector("#zoom-pdf-mas")?.addEventListener("click", () => cambiar_zoom_pdf(.25));
  document.querySelector("#alternar-miniaturas-pdf")?.addEventListener("click", alternar_miniaturas_pdf);
  const contenedor = document.querySelector<HTMLElement>("#contenedor-paginas-pdf");
  contenedor?.addEventListener("click", anclar_click_pdf);
  contenedor?.addEventListener("mouseup", anclar_seleccion_pdf);
  contenedor?.addEventListener("scroll", () => guardar_posicion_actual(), { passive: true });
  contenedor?.addEventListener("wheel", (evento) => {
    const cambio = cambio_zoom_gesto_pdf(evento.deltaY, evento.ctrlKey);
    if (cambio === 0) return;
    evento.preventDefault();
    cambiar_zoom_pdf(cambio, true);
  }, { passive: false });
  contenedor?.addEventListener("wheel", suspender_autoscroll_manual, { passive: true });
  contenedor?.addEventListener("touchmove", suspender_autoscroll_manual, { passive: true });
  contenedor?.addEventListener("contextmenu", (evento) => {
    const seleccion = resolver_seleccion_pdf();
    if (!seleccion) return;
    evento.preventDefault();
    abrir_menu_seleccion(seleccion.texto, seleccion.indice, evento.clientX, evento.clientY);
  });
  actualizar_barra_visor_pdf();
  enlazar_divisor_pdf_rsvp();
}

function establecer_proporcion_pdf_doble(proporcion: number): void {
  proporcion_pdf_doble = Math.min(75, Math.max(25, Math.round(proporcion)));
  const vista = document.querySelector<HTMLElement>("#vista-pdf-doble");
  const divisor = document.querySelector<HTMLElement>(".divisor-pdf-rsvp");
  vista?.style.setProperty("--proporcion-pdf", `${proporcion_pdf_doble}%`);
  divisor?.setAttribute("aria-valuenow", String(proporcion_pdf_doble));
}

function enlazar_divisor_pdf_rsvp(): void {
  const divisor = document.querySelector<HTMLButtonElement>(".divisor-pdf-rsvp");
  const vista = document.querySelector<HTMLElement>("#vista-pdf-doble");
  if (!divisor || !vista) return;
  const movil = es_interfaz_movil();
  divisor.setAttribute("aria-orientation", movil ? "horizontal" : "vertical");
  divisor.addEventListener("keydown", (evento) => {
    if (evento.key === (movil ? "ArrowUp" : "ArrowLeft")) { evento.preventDefault(); establecer_proporcion_pdf_doble(proporcion_pdf_doble - 2); }
    if (evento.key === (movil ? "ArrowDown" : "ArrowRight")) { evento.preventDefault(); establecer_proporcion_pdf_doble(proporcion_pdf_doble + 2); }
  });
  divisor.addEventListener("pointerdown", (evento) => {
    evento.preventDefault();
    divisor.setPointerCapture(evento.pointerId);
    const mover = (movimiento: PointerEvent): void => {
      const limites = vista.getBoundingClientRect();
      establecer_proporcion_pdf_doble(movil
        ? ((movimiento.clientY - limites.top) / Math.max(1, limites.height)) * 100
        : ((movimiento.clientX - limites.left) / Math.max(1, limites.width)) * 100);
    };
    const terminar = (): void => {
      divisor.removeEventListener("pointermove", mover);
      divisor.removeEventListener("pointerup", terminar);
      divisor.removeEventListener("pointercancel", terminar);
      void renderizar_pagina_pdf(pagina_pdf_actual);
    };
    divisor.addEventListener("pointermove", mover);
    divisor.addEventListener("pointerup", terminar);
    divisor.addEventListener("pointercancel", terminar);
  });
}

function crear_panel_documento_secundario(id: string, proporcion: number): string {
  const documento = documentos.find((actual) => actual.id === id);
  if (!documento) return "";
  const procesado = documentos_procesados.get(id);
  const texto = id === "demostracion" ? TEXTO_DEMOSTRACION : procesado ? convertir_bloques_a_texto(procesado.bloques) : "Abre esta pestaña una vez para preparar su contenido local.";
  return `<section class="panel-documento-lectura panel-documento-secundario" data-panel-documento="${escapar_html(id)}" style="--proporcion-panel:${proporcion}"><header><button type="button" data-activar-panel="${escapar_html(id)}">${escapar_html(documento.titulo)}</button><span>${documento.progreso}%</span></header><article tabindex="0">${escapar_html(texto)}</article></section>`;
}

function guardar_desplazamiento_panel_secundario(id: string, desplazamiento: number): void {
  const ahora = performance.now();
  if (!debe_guardar_progreso(ultimos_guardados_paneles.get(id) ?? 0, ahora, false)) return;
  ultimos_guardados_paneles.set(id, ahora);
  const documento = documentos.find((actual) => actual.id === id);
  if (!documento) return;
  const estado_lectura: EstadoLecturaDocumento = {
    indice_fragmento: documento.estado_lectura?.indice_fragmento ?? 0,
    pagina: documento.estado_lectura?.pagina ?? 1,
    indice_unidad: documento.estado_lectura?.indice_unidad ?? 0,
    desplazamiento: Math.max(0, desplazamiento),
    modo_visual_pdf: documento.estado_lectura?.modo_visual_pdf ?? "texto",
    componentes: documento.estado_lectura?.componentes ?? { ...perfil_actual.componentes },
  };
  documentos = documentos.map((actual) => actual.id === id ? { ...actual, estado_lectura } : actual);
  persistencia.guardarDocumentos(documentos);
  if (isTauri() && id !== "demostracion") void invoke("guardar_progreso", { idDocumento: id, progreso: documento.progreso, estadoLectura: estado_lectura });
}

function aplicar_proporciones_paneles(): void {
  document.querySelectorAll<HTMLElement>("[data-panel-documento]").forEach((panel, indice) => panel.style.setProperty("--proporcion-panel", String(sesion_division.proporciones[indice] ?? 100)));
}

function cambiar_proporcion_paneles(divisor: number, cambio: number): void {
  sesion_division.proporciones = ajustar_proporciones_paneles(sesion_division.proporciones, divisor, cambio);
  persistencia.guardarDivision(sesion_division);
  aplicar_proporciones_paneles();
  const control = document.querySelector<HTMLElement>(`[data-divisor-panel="${divisor}"]`);
  control?.setAttribute("aria-valuenow", String(Math.round(sesion_division.proporciones[divisor] ?? 0)));
}

function enlazar_paneles_documentos(): void {
  const panel_activo = document.querySelector<HTMLElement>("#panel-documento-activo");
  panel_activo?.addEventListener("scroll", () => guardar_posicion_actual(), { passive: true });
  panel_activo?.addEventListener("wheel", suspender_autoscroll_manual, { passive: true });
  panel_activo?.addEventListener("touchmove", suspender_autoscroll_manual, { passive: true });
  document.querySelectorAll<HTMLElement>(".panel-documento-secundario").forEach((panel) => {
    const id = panel.dataset.panelDocumento ?? "";
    const articulo = panel.querySelector<HTMLElement>("article");
    if (!articulo) return;
    articulo.scrollTop = documentos.find((documento) => documento.id === id)?.estado_lectura?.desplazamiento ?? 0;
    articulo.addEventListener("scroll", () => guardar_desplazamiento_panel_secundario(id, articulo.scrollTop), { passive: true });
  });
  document.querySelectorAll<HTMLElement>("[data-activar-panel]").forEach((boton) => boton.addEventListener("click", () => {
    const id = boton.dataset.activarPanel;
    const anterior = sesion_pestanas.activa;
    if (!id || !anterior) return;
    sesion_division.documentos = [...sesion_division.documentos.filter((actual) => actual !== id), anterior].slice(-2);
    persistencia.guardarDivision(sesion_division);
    void abrir_documento(id);
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-divisor-panel]").forEach((divisor) => {
    const indice = Number(divisor.dataset.divisorPanel);
    const movil = es_interfaz_movil();
    divisor.setAttribute("aria-orientation", movil ? "horizontal" : "vertical");
    divisor.addEventListener("keydown", (evento) => {
      const disminuir = movil ? evento.key === "ArrowUp" : evento.key === "ArrowLeft";
      const aumentar = movil ? evento.key === "ArrowDown" : evento.key === "ArrowRight";
      if (disminuir) { evento.preventDefault(); cambiar_proporcion_paneles(indice, -2); }
      if (aumentar) { evento.preventDefault(); cambiar_proporcion_paneles(indice, 2); }
    });
    divisor.addEventListener("pointerdown", (evento) => {
      evento.preventDefault(); divisor.setPointerCapture(evento.pointerId);
      let posicion_anterior = movil ? evento.clientY : evento.clientX;
      const contenedor = document.querySelector<HTMLElement>("#paneles-documentos");
      const mover = (movimiento: PointerEvent): void => {
        const extension = Math.max(1, movil ? contenedor?.clientHeight ?? 1 : contenedor?.clientWidth ?? 1);
        const posicion = movil ? movimiento.clientY : movimiento.clientX;
        cambiar_proporcion_paneles(indice, ((posicion - posicion_anterior) / extension) * 100);
        posicion_anterior = posicion;
      };
      const terminar = (): void => { divisor.removeEventListener("pointermove", mover); divisor.removeEventListener("pointerup", terminar); divisor.removeEventListener("pointercancel", terminar); };
      divisor.addEventListener("pointermove", mover); divisor.addEventListener("pointerup", terminar); divisor.addEventListener("pointercancel", terminar);
    });
  });
}

async function renderizar_lector(): Promise<void> {
  const principal = document.querySelector<HTMLElement>("#vista-principal");
  if (!principal || !documento_actual) return;
  const generacion = ++generacion_renderizado;
  documento_renderizando = true;
  const documento_procesado = documentos_procesados.get(documento_actual.id);
  if (documento_actual.id !== "demostracion" && !documento_procesado) {
    documento_renderizando = false;
    principal.innerHTML = `<section class="estado-vacio"><strong>Vuelve a vincular el documento</strong>La referencia existe, pero su contenido no permanece en memoria después de cerrar la aplicación. El archivo original no fue modificado.</section>`;
    return;
  }
  const pdf_original = es_vista_pdf_original();
  const pdf_doble = modo_visual_pdf === "doble";
  const rsvp_visible = perfil_actual.modo_lectura === "rsvp" && !pdf_original;
  const lector_activo = `<main class="lector ${rsvp_visible ? "lector-rsvp" : ""} ${rsvp_visible && documento_actual.formato === "PDF" ? "lector-pdf-rsvp" : ""} ${pdf_original ? "lector-pdf-original" : ""} ${pdf_doble ? "lector-pdf-doble" : ""}">${crear_cabecera_lector(pdf_original)}${pdf_doble ? crear_vista_pdf_doble() : pdf_original ? crear_visor_pdf_original() : `${documento_procesado?.portada && !rsvp_visible ? `<figure class="portada-documento"><img src="${escapar_html(documento_procesado.portada)}" alt="Portada de ${escapar_html(documento_actual.titulo)}"></figure>` : ""}<article class="lector-articulo"></article><section class="visor-rsvp" ${rsvp_visible ? "" : "hidden"}><div id="texto-rsvp" role="status" aria-live="polite" aria-atomic="true"></div></section>`}</main><section id="preparacion-documento" class="preparacion-documento" aria-live="polite"><div><strong>Preparando documento completo</strong><span data-etapa-preparacion>Organizando contenido…</span><progress max="100" value="5"></progress><small data-porcentaje-preparacion>5%</small></div></section>`;
  const secundarios = normalizar_documentos_divididos(sesion_division.documentos, documento_actual.id, new Set(sesion_pestanas.abiertas));
  sesion_division.documentos = secundarios;
  const cantidad_paneles = secundarios.length + 1;
  if (sesion_division.proporciones.length !== cantidad_paneles) sesion_division.proporciones = proporciones_uniformes(cantidad_paneles);
  persistencia.guardarDivision(sesion_division);
  principal.classList.toggle("vista-dividida", secundarios.length > 0);
  if (secundarios.length) {
    const paneles = [`<section id="panel-documento-activo" class="panel-documento-lectura" data-panel-documento="${escapar_html(documento_actual.id)}" style="--proporcion-panel:${sesion_division.proporciones[0]}">${lector_activo}</section>`, ...secundarios.map((id, indice) => crear_panel_documento_secundario(id, sesion_division.proporciones[indice + 1] ?? 0))];
    principal.innerHTML = `<section id="paneles-documentos" class="paneles-documentos">${paneles.map((panel, indice) => `${panel}${indice < paneles.length - 1 ? `<button type="button" class="divisor-panel-documento" data-divisor-panel="${indice}" role="separator" aria-orientation="${es_interfaz_movil() ? "horizontal" : "vertical"}" aria-label="Redimensionar documentos" aria-valuemin="15" aria-valuemax="85" aria-valuenow="${Math.round(sesion_division.proporciones[indice] ?? 0)}"></button>` : ""}`).join("")}</section>`;
  } else principal.innerHTML = lector_activo;
  enlazar_paneles_documentos();
  enlazar_eventos_visor_pdf();
  await esperar_siguiente_cuadro();
  if (generacion !== generacion_renderizado || vista_actual !== "lector") return;
  const texto_documento = documento_actual.id === "demostracion" ? TEXTO_DEMOSTRACION : convertir_bloques_a_texto(documento_procesado?.bloques ?? []);
  actualizar_preparacion_documento("Segmentando texto…", 15);
  const opciones_segmentacion = { saltar_citas: perfil_actual.saltar_citas };
  fragmentos = documento_actual.id === "demostracion" ? segmentar_texto(texto_documento, perfil_actual.politica_matematica, opciones_segmentacion) : segmentar_bloques(documento_procesado?.bloques ?? [], perfil_actual.politica_matematica, opciones_segmentacion);
  if (documento_actual.formato === "PDF") total_paginas_pdf = Math.max(total_paginas_pdf, documento_procesado?.total_paginas ?? 0, ...fragmentos.map(({ pagina }) => pagina ?? 0));
  actualizar_herramientas_pdf();
  indice_resaltado_anterior = -1;
  if (indice_fragmento < 0) {
    indice_fragmento = Math.min(Math.max(0, fragmentos.length - 1), Math.floor((documento_actual.progreso / 100) * fragmentos.length));
  } else indice_fragmento = Math.min(Math.max(0, fragmentos.length - 1), indice_fragmento);
  if (pdf_original) {
    principal.querySelector("#preparacion-documento")?.remove();
    documento_renderizando = false;
    renderizar_panel_izquierdo();
    actualizar_controles();
    await renderizar_pagina_pdf();
    if (pdf_doble) actualizar_visor_rsvp();
    return;
  }
  const articulo = principal.querySelector<HTMLElement>(".lector-articulo");
  if (!articulo) return;
  if (rsvp_visible) {
    articulo.hidden = true;
    principal.querySelector("#preparacion-documento")?.remove();
    documento_renderizando = false;
    actualizar_resaltado();
    renderizar_panel_izquierdo();
    return;
  }
  const ventana = calcular_ventana_renderizado(fragmentos.length, indice_fragmento, TAMANO_VENTANA_DOM);
  const indices_guardados = new Set(fragmentos_guardados.filter((guardado) => guardado.documento_id === documento_actual?.id && fragmento_esta_destacado(guardado)).map(({ indice_fragmento }) => indice_fragmento));
  const lotes = crear_lotes_renderizado(ventana.fin - ventana.inicio, TAMANO_LOTE_RENDERIZADO);
  if (ventana.inicio > 0) articulo.insertAdjacentHTML("beforeend", `<button class="cargar-tramo" data-cargar-ventana="${ventana.inicio - 1}">↑ Mostrar tramo anterior</button>`);
  for (const lote of lotes) {
    if (generacion !== generacion_renderizado || vista_actual !== "lector") return;
    const inicio_absoluto = ventana.inicio + lote.inicio;
    const fin_absoluto = ventana.inicio + lote.fin;
    const html = crear_html_rango(inicio_absoluto, fin_absoluto, indices_guardados);
    articulo.insertAdjacentHTML("beforeend", html);
    actualizar_preparacion_documento(`Preparando vista ágil · ${fragmentos.length.toLocaleString("es-CL")} fragmentos indexados…`, 20 + lote.progreso * .8);
    await esperar_siguiente_cuadro();
  }
  if (ventana.fin < fragmentos.length) articulo.insertAdjacentHTML("beforeend", `<button class="cargar-tramo" data-cargar-ventana="${ventana.fin}">Mostrar tramo siguiente ↓</button>`);
  if (generacion !== generacion_renderizado || vista_actual !== "lector") return;
  articulo.addEventListener("click", (evento) => {
    const boton_tramo = evento.target instanceof Element ? evento.target.closest<HTMLElement>("[data-cargar-ventana]") : null;
    if (boton_tramo) { mover_lector_a_fragmento(Number(boton_tramo.dataset.cargarVentana)); return; }
    const elemento = evento.target instanceof Element ? evento.target.closest<HTMLElement>("[data-indice-fragmento]") : null;
    const indice = resolver_indice_fragmento(elemento?.dataset.indiceFragmento, fragmentos.length);
    if (indice !== null) mover_lector_a_fragmento(indice);
  });
  articulo.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter" && evento.key !== " ") return;
    const elemento = evento.target instanceof Element ? evento.target.closest<HTMLElement>("[data-indice-fragmento]") : null;
    const indice = resolver_indice_fragmento(elemento?.dataset.indiceFragmento, fragmentos.length);
    if (indice !== null) { evento.preventDefault(); mover_lector_a_fragmento(indice); }
  });
  articulo.addEventListener("contextmenu", (evento) => {
    const seleccion_actual = window.getSelection();
    const seleccion = seleccion_actual?.toString().trim() ?? "";
    if (!seleccion || !seleccion_actual) return;
    evento.preventDefault();
    const nodo_origen = seleccion_actual.anchorNode;
    const elemento_origen = nodo_origen instanceof Element ? nodo_origen : nodo_origen?.parentElement;
    const elemento = elemento_origen?.closest<HTMLElement>("[data-indice-fragmento]")
      ?? (evento.target instanceof Element ? evento.target.closest<HTMLElement>("[data-indice-fragmento]") : null);
    const indice = resolver_indice_fragmento(elemento?.dataset.indiceFragmento, fragmentos.length);
    if (indice !== null) abrir_menu_seleccion(seleccion, indice, evento.clientX, evento.clientY);
  });
  principal.querySelector("#preparacion-documento")?.remove();
  documento_renderizando = false;
  actualizar_resaltado();
  restaurar_desplazamiento_guardado();
  renderizar_panel_izquierdo();
}

function actualizar_resaltado(): void {
  if (documento_actual?.formato === "PDF" && !es_vista_pdf_original()) {
    pagina_pdf_actual = pagina_de_fragmento(fragmentos, indice_fragmento, pagina_pdf_actual, Math.max(1, cantidad_paginas_pdf_actual()));
    actualizar_herramientas_pdf();
  }
  if (es_vista_pdf_original()) { resaltar_fragmento_pdf(); sincronizar_pagina_pdf_con_fragmento(); if (modo_visual_pdf === "doble") actualizar_visor_rsvp(); actualizar_controles(); return; }
  if (perfil_actual.modo_lectura === "rsvp") { actualizar_visor_rsvp(); actualizar_controles(); return; }
  const anterior = document.getElementById(fragmentos[indice_resaltado_anterior]?.id ?? "");
  anterior?.classList.remove("activo");
  anterior?.classList.add("no-activo");
  let actual = document.getElementById(fragmentos[indice_fragmento]?.id ?? "");
  if (!actual && vista_actual === "lector" && indice_fragmento >= 0) {
    const articulo = document.querySelector<HTMLElement>(".lector-articulo");
    if (articulo) {
      montar_ventana_fragmentos(articulo);
      indice_resaltado_anterior = -1;
      actual = document.getElementById(fragmentos[indice_fragmento]?.id ?? "");
    }
  }
  actual?.classList.add("activo");
  actual?.classList.remove("no-activo");
  indice_resaltado_anterior = indice_fragmento;
  if (perfil_actual.auto_scroll && !autoscroll_suspendido) actual?.scrollIntoView({ behavior: reproduciendo ? "auto" : "smooth", block: "center" });
  actualizar_controles();
}

function actualizar_destacados_visibles(): void {
  document.querySelectorAll<HTMLElement>(".fragmento.guardado").forEach((elemento) => elemento.classList.remove("guardado"));
  fragmentos_guardados.filter((guardado) => guardado.documento_id === documento_actual?.id && fragmento_esta_destacado(guardado)).forEach(({ indice_fragmento: indice }) => {
    document.getElementById(fragmentos[indice]?.id ?? "")?.classList.add("guardado");
  });
}

function cancelar_seguimiento_pdf(): void {
  if (temporizador_seguimiento_pdf !== null) window.clearTimeout(temporizador_seguimiento_pdf);
  temporizador_seguimiento_pdf = null;
}

function preparar_seguimiento_pdf(indice = indice_fragmento): string[] {
  cancelar_seguimiento_pdf();
  const unidades = fragmentos[indice]?.visible.trim().split(/\s+/u).filter(Boolean) ?? [];
  indice_fragmento_seguimiento_pdf = indice;
  unidades_seguimiento_pdf = unidades;
  indice_unidad_pdf = 0;
  if (es_vista_pdf_original()) resaltar_fragmento_pdf();
  return unidades;
}

function actualizar_seguimiento_pdf_por_progreso(progreso: number): void {
  if (indice_fragmento_seguimiento_pdf !== indice_fragmento || !unidades_seguimiento_pdf.length) preparar_seguimiento_pdf();
  const pesos = unidades_seguimiento_pdf.map((unidad) => Math.max(1, [...unidad].length));
  const total = pesos.reduce((suma, peso) => suma + peso, 0);
  const objetivo = Math.min(1, Math.max(0, progreso)) * total;
  let acumulado = 0;
  const indice = pesos.findIndex((peso) => {
    acumulado += peso;
    return objetivo < acumulado;
  });
  indice_unidad_pdf = indice < 0 ? Math.max(0, pesos.length - 1) : indice;
  if (es_vista_pdf_original()) resaltar_fragmento_pdf();
}

function programar_plan_seguimiento_pdf(plan: PasoRsvp[], posicion: number, indice_seguido: number, generacion: number): void {
  const paso = plan[posicion];
  const anterior = plan[posicion - 1];
  if (!paso || !anterior) return;
  temporizador_seguimiento_pdf = window.setTimeout(() => {
    if (generacion !== generacion_voz || !reproduciendo || indice_fragmento !== indice_seguido) return;
    indice_unidad_pdf = paso.indice;
    resaltar_fragmento_pdf();
    programar_plan_seguimiento_pdf(plan, posicion + 1, indice_seguido, generacion);
  }, Math.max(0, paso.inicio_ms - anterior.inicio_ms));
}

function programar_seguimiento_pdf(duracion_ms: number, generacion: number): void {
  if (!es_vista_pdf_original()) return;
  const indice_seguido = indice_fragmento;
  const unidades = preparar_seguimiento_pdf(indice_seguido);
  const plan = calcular_plan_rsvp(unidades, duracion_ms);
  programar_plan_seguimiento_pdf(plan, 1, indice_seguido, generacion);
}

function detener_voz(guardar = true): void {
  generacion_voz += 1;
  preparando_voz = false;
  window.speechSynthesis?.cancel();
  reproductor_kokoro.detener();
  audios_kokoro.clear();
  if (temporizador_avance !== null) window.clearTimeout(temporizador_avance);
  temporizador_avance = null;
  cancelar_seguimiento_pdf();
  reproduciendo = false;
  locuciones_pendientes = 0;
  if (guardar) guardar_posicion_actual(true);
  actualizar_controles();
}

function solicitar_audio_kokoro(clave: string, texto: string, generacion: number): SolicitudAudioKokoro {
  const existente = audios_kokoro.get(clave);
  if (existente) return existente;
  const solicitud = { promesa: Promise.resolve(null as unknown as AudioBuffer), lista: false };
  const configuracion = { voz: perfil_actual.voz_base, velocidad: perfil_actual.velocidad, idioma: perfil_actual.idioma_voz };
  const sintetizar = cadena_sintesis_kokoro.catch(() => undefined).then(async () => {
    if (generacion !== generacion_voz) throw new Error("Síntesis Kokoro cancelada");
    const wav = normalizar_binario(await invoke<unknown>("sintetizar_kokoro", { texto, ...configuracion }));
    return reproductor_kokoro.decodificar(wav);
  });
  solicitud.promesa = sintetizar.then((datos) => { solicitud.lista = true; return datos; });
  cadena_sintesis_kokoro = solicitud.promesa.then(() => undefined, () => undefined);
  audios_kokoro.set(clave, solicitud);
  return solicitud;
}

function preparar_audio_adelantado_kokoro(inicio: number, modo: "continua" | "rsvp", generacion: number): void {
  for (const indice of indices_locuciones_adelantadas(fragmentos, inicio, CANTIDAD_ADELANTADA_KOKORO)) {
    const texto = fragmentos[indice]?.locucion;
    if (texto) solicitar_audio_kokoro(`${modo}:${indice}:0`, texto, generacion);
  }
}

function avanzar_fragmento_kokoro(generacion: number): void {
  if (generacion !== generacion_voz || !reproduciendo) return;
  const siguiente = indices_locuciones_adelantadas(fragmentos, indice_fragmento + 1, 1)[0];
  if (siguiente === undefined) { detener_voz(); return; }
  indice_fragmento = siguiente;
  indice_unidad_rsvp = 0;
  indice_fragmento_seguimiento_pdf = -1;
  guardar_posicion_actual();
  actualizar_resaltado();
  void reproducir_fragmento_kokoro(generacion);
}

function reproducir_fragmento(): void {
  if (!fragmentos.length) return;
  detener_voz(false);
  autoscroll_suspendido = false;
  reproduciendo = true;
  if (perfil_actual.voz_habilitada && perfil_actual.motor_voz === "kokoro_onnx" && isTauri()) desbloqueo_audio_kokoro = reproductor_kokoro.desbloquear();
  if (perfil_actual.modo_lectura === "rsvp" || modo_visual_pdf === "doble") { reproducir_rsvp(); return; }
  if (!perfil_actual.voz_habilitada) { reproducir_sin_voz(); return; }
  if (perfil_actual.motor_voz === "kokoro_onnx" && isTauri()) { void reproducir_fragmento_kokoro(generacion_voz); return; }
  if (!window.speechSynthesis) return;
  siguiente_indice_cola = indice_fragmento;
  encolar_ventana_tts(generacion_voz);
  actualizar_resaltado();
}

async function reproducir_fragmento_kokoro(generacion: number): Promise<void> {
  const fragmento = fragmentos[indice_fragmento];
  if (!fragmento || generacion !== generacion_voz || !reproduciendo) return;
  if (fragmento.locucion === null) { avanzar_fragmento_kokoro(generacion); return; }
  const clave = `continua:${indice_fragmento}:0`;
  const solicitud = solicitar_audio_kokoro(clave, fragmento.locucion, generacion);
  preparando_voz = !solicitud.lista;
  actualizar_controles();
  try {
    await desbloqueo_audio_kokoro;
    if (generacion !== generacion_voz || !reproduciendo) return;
    const datos = await solicitud.promesa;
    audios_kokoro.delete(clave);
    if (generacion !== generacion_voz || !reproduciendo) return;
    await reproductor_kokoro.reproducir_buffer(datos, () => avanzar_fragmento_kokoro(generacion), (duracion_segundos) => {
      if (generacion !== generacion_voz || !reproduciendo) return;
      actualizar_resaltado();
      programar_seguimiento_pdf(duracion_segundos * 1_000, generacion);
      preparar_audio_adelantado_kokoro(indice_fragmento + 1, "continua", generacion);
    });
  } catch (error) {
    detener_voz();
    informar_error("Reproducción Kokoro", error);
  } finally {
    if (generacion === generacion_voz) { preparando_voz = false; actualizar_controles(); }
  }
}

function obtener_unidades_rsvp(): string[] {
  const fragmento = fragmentos[indice_fragmento];
  if (!fragmento) return [];
  if (fragmento.tipo === "matematica") return [fragmento.visible.replace(/^\$\$|\$\$$/g, "")];
  const visible = fragmento.visible.trim();
  if (perfil_actual.unidad_rsvp === "frase") return visible ? [visible] : [];
  return visible.split(/\s+/u).filter(Boolean);
}

function actualizar_visor_rsvp(): void {
  if (es_vista_pdf_original()) {
    resaltar_fragmento_pdf();
    sincronizar_pagina_pdf_con_fragmento();
    actualizar_controles();
    if (modo_visual_pdf === "original") return;
  }
  const unidades = obtener_unidades_rsvp();
  indice_unidad_rsvp = Math.min(Math.max(0, indice_unidad_rsvp), Math.max(0, unidades.length - 1));
  const texto = document.querySelector<HTMLElement>("#texto-rsvp");
  if (texto) texto.textContent = unidades[indice_unidad_rsvp] ?? "";
}

function avanzar_unidad_rsvp(): boolean {
  const unidades = obtener_unidades_rsvp();
  if (indice_unidad_rsvp < unidades.length - 1) { indice_unidad_rsvp += 1; return true; }
  if (indice_fragmento >= fragmentos.length - 1) return false;
  indice_fragmento += 1;
  indice_unidad_rsvp = 0;
  guardar_posicion_actual();
  return true;
}

function reproducir_rsvp(): void {
  if (!reproduciendo) return;
  const unidad = obtener_unidades_rsvp()[indice_unidad_rsvp] ?? "";
  const avanzar = (): void => {
    if (!reproduciendo) return;
    if (!avanzar_unidad_rsvp()) { detener_voz(); return; }
    reproducir_rsvp();
  };
  const locucion_permitida = fragmentos[indice_fragmento]?.locucion !== null;
  if (perfil_actual.voz_habilitada && locucion_permitida && perfil_actual.motor_voz === "kokoro_onnx" && isTauri()) {
    void reproducir_fragmento_rsvp_kokoro(generacion_voz);
    return;
  }
  if (perfil_actual.voz_habilitada && locucion_permitida && window.speechSynthesis) {
    const locucion = new SpeechSynthesisUtterance(unidad);
    locucion.lang = perfil_actual.idioma_voz;
    locucion.rate = perfil_actual.velocidad;
    locucion.onstart = actualizar_visor_rsvp;
    locucion.onend = avanzar;
    locucion.onerror = () => detener_voz();
    window.speechSynthesis.speak(locucion);
    return;
  }
  actualizar_visor_rsvp();
  const palabras = Math.max(1, unidad.split(/\s+/u).filter(Boolean).length);
  const pausa = /[.!?…]$/u.test(unidad) ? 1.65 : /[,;:]$/u.test(unidad) ? 1.25 : 1;
  temporizador_avance = window.setTimeout(avanzar, Math.max(80, palabras / perfil_actual.palabras_por_minuto * 60_000 * pausa));
}

function programar_plan_rsvp_kokoro(plan: PasoRsvp[], posicion: number, indice_inicial: number, generacion: number): void {
  const paso = plan[posicion];
  const anterior = plan[posicion - 1];
  if (!paso || !anterior) return;
  temporizador_avance = window.setTimeout(() => {
    if (generacion !== generacion_voz || !reproduciendo) return;
    indice_unidad_rsvp = indice_inicial + paso.indice;
    actualizar_visor_rsvp();
    programar_plan_rsvp_kokoro(plan, posicion + 1, indice_inicial, generacion);
  }, Math.max(0, paso.inicio_ms - anterior.inicio_ms));
}

async function reproducir_fragmento_rsvp_kokoro(generacion: number): Promise<void> {
  const fragmento = fragmentos[indice_fragmento];
  const unidades = obtener_unidades_rsvp();
  if (!fragmento?.locucion || !unidades.length || generacion !== generacion_voz || !reproduciendo) return;
  const indice_inicial = indice_unidad_rsvp;
  const restantes = unidades.slice(indice_inicial);
  const texto = indice_inicial === 0 ? fragmento.locucion : restantes.join(" ");
  const clave = `rsvp:${indice_fragmento}:${indice_inicial}`;
  const solicitud = solicitar_audio_kokoro(clave, texto, generacion);
  preparando_voz = !solicitud.lista;
  actualizar_controles();
  try {
    await desbloqueo_audio_kokoro;
    if (generacion !== generacion_voz || !reproduciendo) return;
    const datos = await solicitud.promesa;
    audios_kokoro.delete(clave);
    if (generacion !== generacion_voz || !reproduciendo) return;
    await reproductor_kokoro.reproducir_buffer(datos, () => {
      if (generacion !== generacion_voz || !reproduciendo) return;
      if (temporizador_avance !== null) window.clearTimeout(temporizador_avance);
      temporizador_avance = null;
      indice_unidad_rsvp = Math.max(0, unidades.length - 1);
      actualizar_visor_rsvp();
      if (indice_fragmento >= fragmentos.length - 1) { detener_voz(); return; }
      indice_fragmento += 1;
      indice_unidad_rsvp = 0;
      guardar_posicion_actual();
      reproducir_rsvp();
    }, (duracion_segundos) => {
      if (generacion !== generacion_voz || !reproduciendo) return;
      actualizar_visor_rsvp();
      const plan = calcular_plan_rsvp(restantes, duracion_segundos * 1_000);
      programar_plan_rsvp_kokoro(plan, 1, indice_inicial, generacion);
      preparar_audio_adelantado_kokoro(indice_fragmento + 1, "rsvp", generacion);
    });
  } catch (error) { detener_voz(); informar_error("Reproducción RSVP con Kokoro", error); }
  finally { if (generacion === generacion_voz) { preparando_voz = false; actualizar_controles(); } }
}

function reproducir_sin_voz(): void {
  if (!reproduciendo || indice_fragmento >= fragmentos.length) { reproduciendo = false; actualizar_controles(); return; }
  actualizar_resaltado();
  const texto = fragmentos[indice_fragmento]?.visible ?? "";
  const palabras = Math.max(1, texto.trim().split(/\s+/u).filter(Boolean).length);
  const pausa_puntuacion = /[.!?…][”’"')\]]*$/u.test(texto.trim()) ? 1.65 : /[,;:]$/u.test(texto.trim()) ? 1.25 : 1;
  const duracion = Math.max(80, (palabras / perfil_actual.palabras_por_minuto) * 60_000 * pausa_puntuacion);
  programar_seguimiento_pdf(duracion, generacion_voz);
  temporizador_avance = window.setTimeout(() => {
    if (!reproduciendo) return;
    if (indice_fragmento >= fragmentos.length - 1) { detener_voz(); return; }
    indice_fragmento += 1;
    guardar_posicion_actual();
    reproducir_sin_voz();
  }, duracion);
}

function encolar_ventana_tts(generacion: number): void {
  if (!window.speechSynthesis || generacion !== generacion_voz || !reproduciendo) return;
  if (locuciones_pendientes > 0) return;
  const grupo = agrupar_locuciones(fragmentos, siguiente_indice_cola, 900, TAMANO_VENTANA_TTS);
  if (!grupo.tramos.length) {
    if (locuciones_pendientes === 0) { reproduciendo = false; actualizar_controles(); }
    return;
  }
  siguiente_indice_cola = (grupo.tramos.at(-1)?.indice ?? siguiente_indice_cola) + 1;
  const locucion = new SpeechSynthesisUtterance(grupo.texto);
  locuciones_pendientes = 1;
  locucion.lang = perfil_actual.idioma_voz;
  locucion.rate = perfil_actual.velocidad;
  const activar_indice = (indice: number, posicion = 0): void => {
    if (indice_fragmento !== indice) {
      indice_fragmento = indice;
      guardar_posicion_actual();
      actualizar_resaltado();
    }
    const tramo = grupo.tramos.find((actual) => actual.indice === indice);
    if (tramo) actualizar_seguimiento_pdf_por_progreso((posicion - tramo.inicio) / Math.max(1, tramo.fin - tramo.inicio));
  };
  locucion.onstart = () => {
    const primero = grupo.tramos[0];
    if (generacion === generacion_voz && primero) activar_indice(primero.indice, primero.inicio);
  };
  locucion.onboundary = (evento) => {
    if (generacion !== generacion_voz) return;
    const indice = indice_locucion_en_posicion(grupo.tramos, evento.charIndex);
    if (indice !== null) activar_indice(indice, evento.charIndex);
  };
  locucion.onend = () => {
    if (generacion !== generacion_voz) return;
    locuciones_pendientes = 0;
    encolar_ventana_tts(generacion);
  };
  locucion.onerror = () => { if (generacion === generacion_voz) detener_voz(); };
  window.speechSynthesis.speak(locucion);
}

function alternar_reproduccion(): void {
  if (reproduciendo) { detener_voz(); return; }
  reproducir_fragmento();
}

function guardar_posicion_actual(forzar = false): void {
  const ahora = performance.now();
  if (!debe_guardar_progreso(ultimo_guardado_progreso, ahora, forzar)) return;
  ultimo_guardado_progreso = ahora;
  if (documento_actual && fragmentos.length > 0) {
    const progreso = Math.round(((indice_fragmento + 1) / fragmentos.length) * 100);
    const estado_lectura = crear_estado_lectura_actual();
    documentos = documentos.map((documento) => documento.id === documento_actual?.id ? { ...documento, progreso, ultima_lectura: new Date().toISOString(), estado_lectura } : documento);
    documento_actual = documentos.find((documento) => documento.id === documento_actual?.id) ?? documento_actual;
    persistencia.guardarDocumentos(documentos);
    if (isTauri()) void invoke("guardar_progreso", { idDocumento: documento_actual.id, progreso, estadoLectura: estado_lectura });
  }
}

function crear_estado_lectura_actual(): EstadoLecturaDocumento {
  const contenedor = es_vista_pdf_original()
    ? document.querySelector<HTMLElement>("#contenedor-paginas-pdf")
    : document.querySelector<HTMLElement>("#panel-documento-activo") ?? document.querySelector<HTMLElement>("#vista-principal");
  return {
    indice_fragmento: Math.max(0, indice_fragmento),
    pagina: Math.max(1, pagina_pdf_actual),
    indice_unidad: Math.max(0, perfil_actual.modo_lectura === "rsvp" ? indice_unidad_rsvp : indice_unidad_pdf),
    desplazamiento: Math.max(0, contenedor?.scrollTop ?? 0),
    modo_visual_pdf,
    componentes: { ...perfil_actual.componentes },
  };
}

function restaurar_desplazamiento_guardado(): void {
  if (desplazamiento_pendiente === null) return;
  const contenedor = es_vista_pdf_original()
    ? document.querySelector<HTMLElement>("#contenedor-paginas-pdf")
    : document.querySelector<HTMLElement>("#panel-documento-activo") ?? document.querySelector<HTMLElement>("#vista-principal");
  if (!contenedor) return;
  const desplazamiento = desplazamiento_pendiente;
  desplazamiento_pendiente = null;
  requestAnimationFrame(() => { contenedor.scrollTop = desplazamiento; });
}

function aplicar_estado_lectura(documento: DocumentoBiblioteca): void {
  const estado = documento.estado_lectura;
  indice_fragmento = estado ? Math.max(0, Math.trunc(estado.indice_fragmento)) : -1;
  pagina_pdf_actual = estado ? Math.max(1, Math.trunc(estado.pagina)) : 1;
  indice_unidad_rsvp = estado ? Math.max(0, Math.trunc(estado.indice_unidad)) : 0;
  indice_unidad_pdf = indice_unidad_rsvp;
  modo_visual_pdf = documento.formato === "PDF" && (estado?.modo_visual_pdf === "original" || estado?.modo_visual_pdf === "doble") ? estado.modo_visual_pdf : "texto";
  desplazamiento_pendiente = estado ? Math.max(0, estado.desplazamiento) : 0;
  if (estado?.componentes) {
    perfil_actual = normalizar_perfil({ ...perfil_actual, componentes: estado.componentes });
    aplicar_perfil();
  }
}

function mover_lector_a_fragmento(indice: number): void {
  detener_voz(false);
  autoscroll_suspendido = false;
  indice_fragmento = indice;
  indice_unidad_rsvp = 0;
  indice_fragmento_seguimiento_pdf = -1;
  indice_unidad_pdf = 0;
  unidades_seguimiento_pdf = [];
  guardar_posicion_actual(true);
  actualizar_resaltado();
}

function avanzar_fragmento(desplazamiento: number, continuar = false): void {
  const nuevo_indice = Math.min(fragmentos.length - 1, Math.max(0, indice_fragmento + desplazamiento));
  mover_lector_a_fragmento(nuevo_indice);
  if (continuar && indice_fragmento < fragmentos.length - 1) reproducir_fragmento();
}

async function procesar_documento_nativo(documento: DocumentoBiblioteca, notificar?: (progreso: number, etapa: string) => void): Promise<void> {
  if (!isTauri() || documentos_procesados.has(documento.id) || documento.id === "demostracion") return;
  notificar?.(5, "Buscando contenido preparado");
  try {
    const cache = await invoke<string | null>("leer_cache_documento", { documentoId: documento.id });
    if (cache) {
      const procesado_cache = JSON.parse(cache) as DocumentoProcesado;
      if (procesado_cache?.version_cache === VERSION_CACHE_DOCUMENTO && Array.isArray(procesado_cache.bloques) && Array.isArray(procesado_cache.indice)) {
        documentos_procesados.set(documento.id, procesado_cache);
        notificar?.(100, "Contenido preparado encontrado");
        return;
      }
    }
  } catch {
    // Caché ausente o antiguo: se regenera desde archivo original.
  }
  let extractores: typeof import("./infra/extractores.ts");
  try { extractores = await import("./infra/extractores.ts"); }
  catch (error) { throw new Error(`Carga del extractor: ${error instanceof Error ? error.message : String(error)}`); }
  let datos: ArrayBuffer;
  notificar?.(10, "Leyendo archivo local");
  try { datos = normalizar_binario(await invoke<unknown>("leer_documento", { idDocumento: documento.id })); }
  catch (error) { throw new Error(`Lectura nativa: ${error instanceof Error ? error.message : String(error)}`); }
  let procesado: DocumentoProcesado;
  try {
    const informar_extraccion = (completados: number, total: number, etapa: string): void => notificar?.(15 + Math.round((completados / Math.max(1, total)) * 75), etapa);
    if (documento.formato === "PDF") procesado = await extractores.extraer_pdf(datos, documento.titulo, informar_extraccion);
    else if (documento.formato === "EPUB") procesado = await extractores.extraer_epub(datos, documento.titulo, informar_extraccion);
    else {
      const texto = new TextDecoder("utf-8", { fatal: true }).decode(datos);
      procesado = await invoke<DocumentoProcesado>("extraer_markdown", { texto, nombreArchivo: documento.titulo });
      informar_extraccion(1, 1, "Analizando Markdown");
    }
  } catch (error) {
    const tipo_datos = Object.prototype.toString.call(datos);
    const tamano_datos = typeof datos?.byteLength === "number" ? datos.byteLength : -1;
    throw new Error(`Extracción ${documento.formato} (${tipo_datos}, ${tamano_datos} bytes): ${error instanceof Error ? error.message : String(error)}`);
  }
  documentos_procesados.set(documento.id, procesado);
  notificar?.(92, "Guardando preparación local");
  await invoke("guardar_cache_documento", { documentoId: documento.id, contenido: JSON.stringify(procesado) });
  notificar?.(100, "Extracción completa");
}

async function abrir_documento(id_documento: string): Promise<void> {
  const nuevo_documento = documentos.find((documento) => documento.id === id_documento) ?? null;
  if (documento_actual?.id !== nuevo_documento?.id) {
    if (documento_actual) guardar_posicion_actual(true);
    await cerrar_visor_pdf();
    fragmentos = [];
    zoom_pdf = 1;
  }
  documento_actual = nuevo_documento;
  if (!documento_actual) return;
  sesion_pestanas = abrir_pestana(sesion_pestanas, documento_actual.id);
  persistencia.guardarPestanas(sesion_pestanas);
  renderizar_pestanas_documentos();
  aplicar_estado_lectura(documento_actual);
  const principal = document.querySelector<HTMLElement>("#vista-principal");
  if (principal && isTauri() && documento_actual.id !== "demostracion" && !documentos_procesados.has(documento_actual.id)) {
    principal.innerHTML = `<section id="preparacion-documento" class="preparacion-documento preparacion-inicial" aria-live="polite"><div><strong>Preparando documento completo</strong><span data-etapa-preparacion>Abriendo archivo local…</span><progress max="100" value="2"></progress><small data-porcentaje-preparacion>2%</small></div></section>`;
    try { await procesar_documento_nativo(documento_actual, (progreso, etapa) => actualizar_preparacion_documento(etapa, progreso)); }
    catch (error) {
      principal.innerHTML = `<section class="estado-vacio"><strong>No fue posible abrir</strong>${escapar_html(error instanceof Error ? error.message : String(error))}</section>`;
      return;
    }
  }
  const secundarios_pendientes = normalizar_documentos_divididos(sesion_division.documentos, documento_actual.id, new Set(sesion_pestanas.abiertas));
  for (const id_secundario of secundarios_pendientes) {
    const documento_secundario = documentos.find(({ id }) => id === id_secundario);
    if (!documento_secundario || documentos_procesados.has(id_secundario)) continue;
    try { await procesar_documento_nativo(documento_secundario); }
    catch (error) { informar_error(`Preparación de ${documento_secundario.titulo}`, error); }
  }
  await cargar_fragmentos_documento(documento_actual.id);
  cambiar_vista("lector");
  renderizar_panel_izquierdo();
  renderizar_panel_fragmentos();
}

function cerrar_menus_contextuales(): void {
  document.querySelector<HTMLElement>("#menu-contextual")?.setAttribute("hidden", "");
}

function posicionar_superposicion(menu: HTMLElement, ancla: { izquierda: number; superior: number; derecha: number; inferior: number }): void {
  const rectangulo = menu.getBoundingClientRect();
  const posicion = calcular_posicion_superpuesta(ancla, { ancho: rectangulo.width, alto: rectangulo.height }, { ancho: window.innerWidth, alto: window.innerHeight });
  menu.style.left = `${posicion.izquierda}px`;
  menu.style.top = `${posicion.superior}px`;
}

function mostrar_menu_contextual(contenido: string, x: number, y: number): HTMLElement | null {
  const menu = document.querySelector<HTMLElement>("#menu-contextual");
  if (!menu) return null;
  menu.innerHTML = contenido;
  menu.hidden = false;
  posicionar_superposicion(menu, { izquierda: x, superior: y, derecha: x, inferior: y });
  return menu;
}

function abrir_menu_documento(id: string, x: number, y: number): void {
  const documento = documentos.find((actual) => actual.id === id);
  if (!documento) return;
  const opciones_carpetas = carpetas.map((carpeta) => `<button data-mover-carpeta="${escapar_html(carpeta.id)}">Mover a ${escapar_html(carpeta.nombre)}</button>`).join("");
  const menu = mostrar_menu_contextual(`<strong>${escapar_html(documento.titulo)}</strong><button data-accion="editar">Editar metadata</button>${opciones_carpetas}<button data-mover-carpeta="">Sacar de carpeta</button><button class="accion-peligrosa" data-accion="eliminar">Eliminar de biblioteca</button>`, x, y);
  menu?.querySelector("[data-accion='editar']")?.addEventListener("click", () => void editar_metadata_documento(id));
  menu?.querySelector("[data-accion='eliminar']")?.addEventListener("click", () => void eliminar_documento_biblioteca(id));
  menu?.querySelectorAll<HTMLElement>("[data-mover-carpeta]").forEach((boton) => boton.addEventListener("click", () => void mover_documento_a_carpeta(id, boton.dataset.moverCarpeta || null)));
}

function abrir_menu_seleccion(texto: string, indice: number, x: number, y: number): void {
  const menu = mostrar_menu_contextual(`<strong>${escapar_html(texto.slice(0, 70))}</strong><button id="leer-seleccion">Leer desde aquí</button><button id="guardar-seleccion">Guardar fragmento</button>`, x, y);
  menu?.querySelector("#leer-seleccion")?.addEventListener("click", () => { mover_lector_a_fragmento(indice); cerrar_menus_contextuales(); reproducir_fragmento(); });
  menu?.querySelector("#guardar-seleccion")?.addEventListener("click", () => void guardar_fragmento_seleccionado(texto, indice));
}

async function guardar_fragmento_seleccionado(texto: string, indice_fragmento_guardado: number): Promise<void> {
  if (!documento_actual) return;
  const guardado: FragmentoGuardado = {
    id: crypto.randomUUID(), documento_id: documento_actual.id, texto: texto.trim(),
    indice_fragmento: indice_fragmento_guardado, creado: new Date().toISOString(), destacado: true,
    ancla: fragmentos[indice_fragmento_guardado]?.ancla,
  };
  fragmentos_guardados = [...fragmentos_guardados, guardado];
  persistencia.guardarFragmentos(fragmentos_guardados);
  if (isTauri() && documento_actual.id !== "demostracion") await invoke("guardar_fragmento", { fragmento: guardado });
  cerrar_menus_contextuales(); renderizar_panel_fragmentos(); actualizar_destacados_visibles(); actualizar_resaltado();
}

async function cargar_fragmentos_documento(id_documento: string): Promise<void> {
  if (!isTauri() || id_documento === "demostracion") return;
  const [nativos, notas_nativas] = await Promise.all([
    invoke<FragmentoGuardado[]>("listar_fragmentos", { documentoId: id_documento }),
    invoke<NotaDocumento[]>("listar_notas", { documentoId: id_documento }),
  ]);
  fragmentos_guardados = [...fragmentos_guardados.filter(({ documento_id }) => documento_id !== id_documento), ...nativos];
  notas_documento = [...notas_documento.filter(({ documento_id }) => documento_id !== id_documento), ...notas_nativas];
  persistencia.guardarFragmentos(fragmentos_guardados);
  persistencia.guardarNotas(notas_documento);
}

async function guardar_nota_manual(): Promise<void> {
  if (!documento_actual) return;
  const control = document.querySelector<HTMLTextAreaElement>("#texto-nota");
  const texto = control?.value.trim() ?? "";
  if (!texto) { control?.focus(); return; }
  const nota: NotaDocumento = { id: crypto.randomUUID(), documento_id: documento_actual.id, texto, creado: new Date().toISOString() };
  notas_documento = [...notas_documento, nota];
  persistencia.guardarNotas(notas_documento);
  if (isTauri() && documento_actual.id !== "demostracion") await invoke("guardar_nota", { nota });
  renderizar_panel_fragmentos();
}

async function eliminar_nota_manual(id: string): Promise<void> {
  const nota = notas_documento.find((actual) => actual.id === id);
  if (!nota) return;
  if (isTauri() && nota.documento_id !== "demostracion") await invoke("eliminar_nota", { id });
  notas_documento = notas_documento.filter((actual) => actual.id !== id);
  persistencia.guardarNotas(notas_documento);
  renderizar_panel_fragmentos();
}

async function eliminar_fragmento_guardado(id: string): Promise<void> {
  const guardado = fragmentos_guardados.find((actual) => actual.id === id);
  if (!guardado) return;
  if (isTauri() && guardado.documento_id !== "demostracion") await invoke("eliminar_fragmento", { id });
  fragmentos_guardados = fragmentos_guardados.filter((actual) => actual.id !== id);
  persistencia.guardarFragmentos(fragmentos_guardados); renderizar_panel_fragmentos(); actualizar_destacados_visibles(); actualizar_resaltado();
}

async function alternar_destacado_fragmento(id: string): Promise<void> {
  const guardado = fragmentos_guardados.find((actual) => actual.id === id);
  if (!guardado) return;
  const destacado = !fragmento_esta_destacado(guardado);
  fragmentos_guardados = fragmentos_guardados.map((actual) => actual.id === id ? { ...actual, destacado } : actual);
  persistencia.guardarFragmentos(fragmentos_guardados);
  if (isTauri() && guardado.documento_id !== "demostracion") await invoke("cambiar_destacado_fragmento", { id, destacado });
  renderizar_panel_fragmentos(); actualizar_destacados_visibles(); actualizar_resaltado();
}

function abrir_menu_carpeta(id: string, x: number, y: number): void {
  const carpeta = carpetas.find((actual) => actual.id === id);
  if (!carpeta) return;
  const menu = mostrar_menu_contextual(`<strong>${escapar_html(carpeta.nombre)}</strong><button data-accion="renombrar">Renombrar</button><button class="accion-peligrosa" data-accion="eliminar">Eliminar carpeta</button>`, x, y);
  menu?.querySelector("[data-accion='renombrar']")?.addEventListener("click", () => void renombrar_carpeta_biblioteca(id));
  menu?.querySelector("[data-accion='eliminar']")?.addEventListener("click", () => void eliminar_carpeta_biblioteca(id));
}

async function crear_carpeta_biblioteca(nombre_sugerido = "Nueva carpeta", solicitar_nombre = true): Promise<CarpetaBiblioteca | null> {
  const nombre = (solicitar_nombre ? window.prompt("Nombre de carpeta", nombre_sugerido) : nombre_sugerido)?.trim();
  if (!nombre) return null;
  const carpeta = isTauri() ? await invoke<CarpetaBiblioteca>("crear_carpeta", { nombre }) : { id: crypto.randomUUID(), nombre, orden: carpetas.length };
  carpetas = [...carpetas, carpeta];
  persistencia.guardarCarpetas(carpetas);
  renderizar_panel_biblioteca();
  return carpeta;
}

async function renombrar_carpeta_biblioteca(id: string): Promise<void> {
  const carpeta = carpetas.find((actual) => actual.id === id);
  const nombre = window.prompt("Nuevo nombre", carpeta?.nombre ?? "")?.trim();
  if (!carpeta || !nombre) return;
  if (isTauri()) await invoke("renombrar_carpeta", { id, nombre });
  carpetas = carpetas.map((actual) => actual.id === id ? { ...actual, nombre } : actual);
  persistencia.guardarCarpetas(carpetas); cerrar_menus_contextuales(); renderizar_panel_biblioteca();
}

async function eliminar_carpeta_biblioteca(id: string): Promise<void> {
  if (!window.confirm("Eliminar carpeta virtual? Los libros seguirán en biblioteca y archivos originales no se borrarán.")) return;
  if (isTauri()) await invoke("eliminar_carpeta", { id });
  carpetas = carpetas.filter((carpeta) => carpeta.id !== id);
  documentos = documentos.map((documento) => documento.carpeta_id === id ? { ...documento, carpeta_id: null } : documento);
  if (filtro_biblioteca.tipo === "carpeta" && filtro_biblioteca.carpeta_id === id) filtro_biblioteca = { tipo: "raiz" };
  persistencia.guardarCarpetas(carpetas); persistencia.guardarDocumentos(documentos); cerrar_menus_contextuales(); renderizar_panel_biblioteca(); renderizar_biblioteca();
}

async function mover_documento_a_carpeta(id: string, carpeta_id: string | null): Promise<void> {
  if (!id) return;
  if (isTauri()) await invoke("mover_documento", { idDocumento: id, carpetaId: carpeta_id });
  documentos = documentos.map((documento) => documento.id === id ? { ...documento, carpeta_id } : documento);
  persistencia.guardarDocumentos(documentos); cerrar_menus_contextuales(); renderizar_panel_biblioteca(); renderizar_biblioteca();
}

async function editar_metadata_documento(id: string): Promise<void> {
  const documento = documentos.find((actual) => actual.id === id);
  if (!documento) return;
  const titulo = window.prompt("Título", documento.titulo)?.trim();
  if (!titulo) return;
  const autor = window.prompt("Autor", documento.autor)?.trim() ?? documento.autor;
  if (isTauri() && id !== "demostracion") await invoke("editar_documento", { id, titulo, autor });
  documentos = documentos.map((actual) => actual.id === id ? { ...actual, titulo, autor } : actual);
  persistencia.guardarDocumentos(documentos); cerrar_menus_contextuales(); renderizar_biblioteca();
}

async function eliminar_documento_biblioteca(id: string): Promise<void> {
  if (id === "demostracion" || !window.confirm("Eliminar de biblioteca? Archivo original permanecerá intacto.")) return;
  if (isTauri()) await invoke("eliminar_documento", { id });
  documentos = documentos.filter((documento) => documento.id !== id);
  sesion_pestanas = cerrar_pestana(sesion_pestanas, id);
  persistencia.guardarPestanas(sesion_pestanas);
  documentos_procesados.delete(id); binarios_pdf_web.delete(id);
  if (documento_visor_pdf === id) await cerrar_visor_pdf();
  persistencia.guardarDocumentos(documentos); cerrar_menus_contextuales(); renderizar_panel_biblioteca(); renderizar_biblioteca();
}

async function ordenar_documento(id_movido: string, id_destino: string): Promise<void> {
  documentos = reordenar_documentos(documentos, id_movido, id_destino);
  persistencia.guardarDocumentos(documentos);
  if (isTauri()) await invoke("reordenar_documentos", { ids: documentos.filter(({ id }) => id !== "demostracion").map(({ id }) => id) });
  renderizar_biblioteca();
}

function cambiar_vista(vista: "biblioteca" | "lector"): void {
  vista_actual = vista;
  if (vista === "biblioteca") { generacion_renderizado += 1; documento_renderizando = false; void cerrar_visor_pdf(); }
  detener_voz();
  document.querySelectorAll<HTMLElement>("[data-vista]").forEach((elemento) => elemento.classList.toggle("activa", elemento.dataset.vista === vista));
  const buscador = document.querySelector<HTMLInputElement>("#busqueda-global");
  if (buscador) {
    buscador.placeholder = vista === "biblioteca" ? "Buscar en la biblioteca" : "Buscar en el documento";
    buscador.value = "";
  }
  consulta_global = ""; resultados_busqueda_lector = []; posicion_resultado_busqueda = -1;
  if (vista === "biblioteca") renderizar_biblioteca(""); else void renderizar_lector();
  actualizar_indicador_busqueda();
  actualizar_controles();
  renderizar_pestanas_documentos();
}

function carpeta_destino_actual(): string | null {
  return filtro_biblioteca.tipo === "carpeta" ? filtro_biblioteca.carpeta_id : null;
}

async function importar_documentos(lista_archivos: FileList | null): Promise<void> {
  if (!lista_archivos) return;
  const extractores = await import("./infra/extractores.ts");
  const archivos = [...lista_archivos].filter((archivo) => /\.(?:pdf|epub|md|markdown)$/i.test(archivo.name));
  const raiz_sistema = archivos.find(({ webkitRelativePath }) => webkitRelativePath)?.webkitRelativePath.split("/")[0];
  const carpeta_importada = raiz_sistema ? await crear_carpeta_biblioteca(raiz_sistema, false) : null;
  const carpeta_id = carpeta_importada?.id ?? carpeta_destino_actual();
  for (const [indice, archivo] of archivos.entries()) {
    mostrar_carga(archivo.name, indice, archivos.length, "Extrayendo contenido local");
    const extension = archivo.name.split(".").pop()?.toUpperCase();
    const formato = extension === "MD" || extension === "MARKDOWN" ? "MARKDOWN" : extension;
    if (formato !== "PDF" && formato !== "EPUB" && formato !== "MARKDOWN") continue;
    const id_documento = crypto.randomUUID();
    const datos = await archivo.arrayBuffer();
    if (formato === "MARKDOWN") throw new Error("La importación Markdown requiere la aplicación de escritorio.");
    const procesado = formato === "PDF"
      ? await extractores.extraer_pdf(datos.slice(0), archivo.name)
      : await extractores.extraer_epub(datos, archivo.name);
    if (formato === "PDF") binarios_pdf_web.set(id_documento, datos);
    documentos_procesados.set(id_documento, procesado);
    documentos = agregar_documento(documentos, {
      id: id_documento, titulo: procesado.titulo, autor: procesado.autor,
      formato, ruta: `${archivo.name}:${archivo.size}:${archivo.lastModified}`,
      progreso: 0, etiquetas: [procesado.idioma || "Sin clasificar"], ultima_lectura: null, carpeta_id,
    });
  }
  persistencia.guardarDocumentos(documentos);
  if (carpeta_importada) filtro_biblioteca = { tipo: "carpeta", carpeta_id: carpeta_importada.id };
  renderizar_panel_biblioteca();
  renderizar_biblioteca();
  finalizar_carga(archivos.length);
}

function convertir_documento_nativo(documento: Omit<DocumentoBiblioteca, "etiquetas">): DocumentoBiblioteca {
  return { ...documento, etiquetas: [] };
}

async function cargar_biblioteca_nativa(): Promise<void> {
  if (!isTauri()) return;
  const [documentos_nativos, carpetas_nativas] = await Promise.all([
    invoke<Array<Omit<DocumentoBiblioteca, "etiquetas">>>("listar_documentos"),
    invoke<CarpetaBiblioteca[]>("listar_carpetas"),
  ]);
  documentos = [DOCUMENTO_DEMOSTRACION, ...documentos_nativos.map(convertir_documento_nativo)];
  carpetas = carpetas_nativas;
  persistencia.guardarDocumentos(documentos);
  persistencia.guardarCarpetas(carpetas);
  renderizar_panel_biblioteca();
  sesion_pestanas = normalizar_sesion_pestanas(sesion_pestanas, new Set(documentos.map(({ id }) => id)));
  persistencia.guardarPestanas(sesion_pestanas);
  renderizar_pestanas_documentos();
  if (vista_actual === "biblioteca") renderizar_biblioteca();
  if (sesion_pestanas.activa) void abrir_documento(sesion_pestanas.activa);
}

async function importar_con_dialogo_nativo(): Promise<void> {
  const seleccion = await open({ multiple: true, filters: [{ name: "Documentos", extensions: ["pdf", "epub", "md", "markdown"] }] });
  const rutas = seleccion === null ? [] : Array.isArray(seleccion) ? seleccion : [seleccion];
  await importar_rutas_nativas(rutas, carpeta_destino_actual());
}

async function importar_rutas_nativas(rutas: string[], carpeta_id: string | null = null): Promise<void> {
  for (const [indice, ruta] of rutas.entries()) {
    mostrar_carga(ruta.split(/[\\/]/).pop() ?? ruta, indice, rutas.length, "Extrayendo contenido local");
    const documento_nativo = await invoke<Omit<DocumentoBiblioteca, "etiquetas">>("importar_documento", { ruta });
    const documento = convertir_documento_nativo(documento_nativo);
    const documento_organizado = { ...documento, carpeta_id };
    documentos = agregar_documento(documentos, documento_organizado);
    if (carpeta_id) await invoke("mover_documento", { idDocumento: documento.id, carpetaId: carpeta_id });
    await procesar_documento_nativo(documento_organizado);
  }
  persistencia.guardarDocumentos(documentos);
  renderizar_panel_biblioteca();
  renderizar_biblioteca();
  finalizar_carga(rutas.length);
}

function encolar_archivos_abiertos(rutas: string[]): void {
  const unicas = [...new Set(rutas.filter((ruta) => /\.(?:pdf|epub|md|markdown)$/i.test(ruta)))];
  if (!unicas.length) return;
  cola_apertura_archivos = cola_apertura_archivos
    .then(() => ejecutar_importacion(() => importar_rutas_nativas(unicas), "Apertura desde Finder"));
}

async function inicializar_apertura_archivos_nativa(): Promise<void> {
  if (!isTauri()) return;
  const carga_biblioteca = cargar_biblioteca_nativa();
  cola_apertura_archivos = carga_biblioteca;
  await listen<string[]>("abrir-documentos", ({ payload }) => encolar_archivos_abiertos(payload));
  await carga_biblioteca;
  const iniciales = await invoke<string[]>("tomar_archivos_abiertos");
  encolar_archivos_abiertos(iniciales);
}

async function importar_carpeta_nativa(): Promise<void> {
  const seleccion = await open({ directory: true, multiple: false, title: "Añadir carpeta a biblioteca" });
  if (!seleccion) return;
  mostrar_carga(seleccion.split(/[\\/]/).pop() ?? seleccion, 0, 0, "Buscando PDF, EPUB y Markdown");
  const rutas = await invoke<string[]>("listar_documentos_directorio", { ruta: seleccion });
  if (!rutas.length) { finalizar_carga(0); return; }
  const nombre = seleccion.split(/[\\/]/).pop() ?? "Carpeta importada";
  const carpeta = await crear_carpeta_biblioteca(nombre, false);
  if (!carpeta) return;
  filtro_biblioteca = { tipo: "carpeta", carpeta_id: carpeta.id };
  await importar_rutas_nativas(rutas, carpeta.id);
}

function mostrar_carga(nombre: string, indice: number, total: number, etapa: string): void {
  const interfaz = document.querySelector<HTMLElement>("#carga-importacion");
  const nombre_elemento = document.querySelector<HTMLElement>("#carga-nombre");
  const estado = document.querySelector<HTMLElement>("#carga-estado");
  const progreso = document.querySelector<HTMLProgressElement>("#carga-progreso");
  if (!interfaz || !nombre_elemento || !estado || !progreso) return;
  interfaz.hidden = false;
  nombre_elemento.textContent = nombre;
  estado.textContent = total > 0 ? `${etapa} · ${indice + 1} de ${total}` : etapa;
  if (total > 0) progreso.value = Math.round((indice / total) * 100);
  else progreso.removeAttribute("value");
}

function finalizar_carga(total: number): void {
  const interfaz = document.querySelector<HTMLElement>("#carga-importacion");
  const estado = document.querySelector<HTMLElement>("#carga-estado");
  const progreso = document.querySelector<HTMLProgressElement>("#carga-progreso");
  if (!interfaz || !estado || !progreso) return;
  progreso.value = 100;
  estado.textContent = total > 0 ? `${total} elemento${total === 1 ? "" : "s"} añadido${total === 1 ? "" : "s"}` : "No se encontraron PDF, EPUB o Markdown";
  window.setTimeout(() => { interfaz.hidden = true; }, 1200);
}

function ocultar_carga(): void {
  const interfaz = document.querySelector<HTMLElement>("#carga-importacion");
  if (interfaz) interfaz.hidden = true;
}

async function ejecutar_importacion(tarea: () => Promise<void>, mensaje_error: string): Promise<void> {
  try { await tarea(); }
  catch (error) {
    ocultar_carga();
    informar_error(mensaje_error, error);
  }
}

function actualizar_perfil(cambios: Parameters<typeof normalizar_perfil>[0]): void {
  perfil_actual = normalizar_perfil({
    ...perfil_actual,
    ...cambios,
    componentes: cambios.componentes ? { ...perfil_actual.componentes, ...cambios.componentes } : perfil_actual.componentes,
    atajos: cambios.atajos ? { ...perfil_actual.atajos, ...cambios.atajos } : perfil_actual.atajos,
    colores: cambios.colores ? { ...perfil_actual.colores, ...cambios.colores } : perfil_actual.colores,
  });
  persistencia.guardarPerfil(perfil_actual);
  aplicar_perfil();
  if (cambios.componentes && documento_actual) guardar_posicion_actual(true);
  if (vista_actual === "lector" && (cambios.politica_matematica !== undefined || cambios.saltar_citas !== undefined || cambios.modo_lectura !== undefined || cambios.unidad_rsvp !== undefined)) {
    detener_voz();
    void renderizar_lector();
  }
  actualizar_panel_perfil();
}

function actualizar_panel_perfil(): void {
  const tamano = document.querySelector<HTMLElement>("#valor-tamano");
  const velocidad = document.querySelector<HTMLElement>("#valor-velocidad");
  if (tamano) tamano.textContent = `${perfil_actual.tamano_fuente}px`;
  if (velocidad) velocidad.textContent = `${perfil_actual.velocidad.toFixed(1)}×`;
  document.querySelectorAll<HTMLInputElement>("[data-atajo]").forEach((control) => {
    const accion = control.dataset.atajo as AccionAtajo;
    control.value = describir_atajo(perfil_actual.atajos[accion]);
  });
  const palabras = document.querySelector<HTMLElement>("#valor-palabras-minuto");
  if (palabras) palabras.textContent = `${perfil_actual.palabras_por_minuto}`;
  document.querySelectorAll<HTMLElement>("[data-solo-rsvp]").forEach((elemento) => { elemento.hidden = perfil_actual.modo_lectura !== "rsvp"; });
  const motor = document.querySelector<HTMLSelectElement>("#motor-voz");
  const opcion_kokoro = motor?.querySelector<HTMLOptionElement>("option[value='kokoro_onnx']");
  if (opcion_kokoro) { opcion_kokoro.disabled = !kokoro_instalado; opcion_kokoro.textContent = `Kokoro ONNX · ${kokoro_instalado ? "verificado" : "no instalado"}`; }
  if (motor) motor.value = perfil_actual.motor_voz;
  document.querySelectorAll<HTMLElement>("[data-solo-kokoro]").forEach((elemento) => { elemento.hidden = !mostrar_configuracion_kokoro(perfil_actual.motor_voz); });
  document.querySelectorAll<HTMLElement>("[data-solo-sin-voz]").forEach((elemento) => { elemento.hidden = perfil_actual.voz_habilitada; });
  document.querySelectorAll<HTMLElement>("[data-solo-con-voz]").forEach((elemento) => { elemento.hidden = !perfil_actual.voz_habilitada; });
  const idioma = document.querySelector<HTMLSelectElement>("#idioma-voz");
  const voz = document.querySelector<HTMLSelectElement>("#voz-base");
  if (idioma) idioma.value = perfil_actual.idioma_voz;
  if (voz) {
    const configuracion = normalizar_configuracion_kokoro(perfil_actual.idioma_voz, perfil_actual.voz_base);
    if (voz.dataset.idioma !== configuracion.idioma) {
      voz.innerHTML = VOCES_KOKORO[configuracion.idioma]!.map((opcion) => `<option value="${opcion.id}">${opcion.nombre} · ${opcion.id}</option>`).join("");
      voz.dataset.idioma = configuracion.idioma;
    }
    voz.value = configuracion.voz;
  }
}

function actualizar_idioma_kokoro(idioma: string): void {
  const configuracion = normalizar_configuracion_kokoro(idioma, perfil_actual.voz_base);
  detener_voz();
  actualizar_perfil({ idioma_voz: configuracion.idioma, voz_base: configuracion.voz });
}

function sincronizar_controles_colores(): void {
  document.querySelectorAll<HTMLInputElement>("[data-color-interfaz]").forEach((control) => {
    const nombre = control.dataset.colorInterfaz as keyof PerfilLectura["colores"];
    control.value = perfil_actual.colores[nombre];
  });
}

function renderizar_biblioteca_temas(): void {
  const lista = document.querySelector<HTMLElement>("#lista-biblioteca-temas");
  if (!lista) return;
  const temas = [...BIBLIOTECA_TEMAS, ...temas_personalizados];
  const categorias = [...new Set(temas.map(({ categoria }) => categoria))];
  lista.innerHTML = categorias.map((categoria) => `<section class="grupo-temas"><h3>${escapar_html(categoria)}</h3><div class="cuadricula-temas">${temas.filter((tema) => tema.categoria === categoria).map((tema) => `<article class="tarjeta-tema"><button data-aplicar-tema="${escapar_html(tema.id)}"><span class="muestra-tema" style="--muestra-fondo:${tema.colores.fondo};--muestra-superficie:${tema.colores.superficie};--muestra-panel:${tema.colores.panel};--muestra-acento:${tema.colores.acento};--muestra-texto:${tema.colores.texto}"><i></i><b></b><em></em></span><strong>${escapar_html(tema.nombre)}</strong></button>${tema.personalizado ? `<button class="eliminar-tema" data-eliminar-tema="${escapar_html(tema.id)}" aria-label="Eliminar tema">×</button>` : ""}</article>`).join("")}</div></section>`).join("");
  lista.querySelectorAll<HTMLElement>("[data-aplicar-tema]").forEach((boton) => boton.addEventListener("click", () => {
    const tema = temas.find(({ id }) => id === boton.dataset.aplicarTema);
    if (!tema) return;
    actualizar_perfil({ tema: tema.tema, colores: tema.colores }); sincronizar_controles_colores();
    document.querySelector<HTMLElement>("#biblioteca-temas")?.setAttribute("hidden", "");
  }));
  lista.querySelectorAll<HTMLElement>("[data-eliminar-tema]").forEach((boton) => boton.addEventListener("click", () => {
    temas_personalizados = temas_personalizados.filter(({ id }) => id !== boton.dataset.eliminarTema);
    persistencia.guardarTemasPersonalizados(temas_personalizados); renderizar_biblioteca_temas();
  }));
}

function guardar_tema_actual(): void {
  const nombre = window.prompt("Nombre del tema personalizado")?.trim();
  if (!nombre) return;
  temas_personalizados = [...temas_personalizados, { id: crypto.randomUUID(), nombre, categoria: "Mis temas", tema: perfil_actual.tema, colores: { ...perfil_actual.colores }, personalizado: true }];
  persistencia.guardarTemasPersonalizados(temas_personalizados); renderizar_biblioteca_temas();
}

function formatear_tamano_bytes(bytes: number): string {
  if (bytes <= 0) return "Incluido";
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function crear_tarjeta_repositorio(repositorio: RepositorioVoz): string {
  const paquetes = repositorio.paquetes.map((paquete) => {
    const control = resolver_control_paquete_voz(repositorio, paquete, kokoro_instalado);
    const descargas = (paquete.descargas ?? []).map((descarga) => `<button class="descarga-paquete" data-descargar-voz="${escapar_html(descarga.url)}" title="SHA-256: ${descarga.sha256}">${escapar_html(descarga.nombre)} · ${escapar_html(formatear_tamano_bytes(descarga.tamano_bytes))}</button>`).join("");
    return `<section><div><strong>${escapar_html(paquete.nombre)}</strong>${descargas ? `<div class="descargas-paquete">${descargas}</div>` : ""}</div><button ${control.habilitado ? "" : "disabled"} ${control.accion === "vincular_kokoro" ? "data-instalar-kokoro" : ""}>${escapar_html(control.etiqueta)}</button></section>`;
  }).join("");
  return `<article class="tarjeta-repositorio"><header><strong>${escapar_html(repositorio.nombre)}</strong><label class="interruptor-repositorio"><input type="checkbox" data-alternar-repositorio="${escapar_html(repositorio.id)}" ${repositorio.activo ? "checked" : ""}> Activo</label></header>${paquetes ? `<div class="lista-paquetes-voz">${paquetes}</div>` : ""}</article>`;
}

async function instalar_paquete_kokoro(): Promise<void> {
  if (!isTauri()) { informar_error("Instalación Kokoro", "La instalación requiere la aplicación de escritorio."); return; }
  const modelo = await open({ multiple: false, filters: [{ name: "Modelo Kokoro ONNX", extensions: ["onnx"] }] });
  if (typeof modelo !== "string") return;
  const voces = await open({ multiple: false, filters: [{ name: "Voces Kokoro", extensions: ["bin"] }] });
  if (typeof voces !== "string") return;
  try {
    const estado = await invoke<{ instalado: boolean; directorio: string }>("instalar_kokoro", { rutaModelo: modelo, rutaVoces: voces });
    kokoro_instalado = estado.instalado;
    const configuracion = normalizar_configuracion_kokoro(perfil_actual.idioma_voz, perfil_actual.voz_base);
    actualizar_perfil({ motor_voz: "kokoro_onnx", idioma_voz: configuracion.idioma, voz_base: configuracion.voz });
    renderizar_repositorios_voz();
    window.alert("Kokoro ONNX quedó vinculado y verificado para Carlector.");
  } catch (error) { informar_error("Instalación Kokoro", error); }
}

function usar_motor_voz(motor: string): void {
  if (motor === "sistema") actualizar_perfil({ motor_voz: "sistema" });
  if (motor === "kokoro_onnx" && kokoro_instalado) {
    const configuracion = normalizar_configuracion_kokoro(perfil_actual.idioma_voz, perfil_actual.voz_base);
    actualizar_perfil({ motor_voz: "kokoro_onnx", idioma_voz: configuracion.idioma, voz_base: configuracion.voz });
  }
}

function alternar_repositorio_voz(control: HTMLInputElement): void {
  const id = control.dataset.alternarRepositorio;
  if (!id) return;
  estados_repositorios_voz = { ...estados_repositorios_voz, [id]: control.checked };
  persistencia.guardarRepositoriosVoz(estados_repositorios_voz);
  renderizar_repositorios_voz();
}

function renderizar_repositorios_voz(): void {
  const lista = document.querySelector<HTMLElement>("#lista-repositorios-voz");
  if (!lista) return;
  repositorios_voz = combinar_estado_repositorios(estados_repositorios_voz);
  lista.innerHTML = repositorios_voz.map(crear_tarjeta_repositorio).join("");
}

async function actualizar_estado_kokoro(): Promise<void> {
  if (!isTauri()) return;
  try {
    const estado = await invoke<{ instalado: boolean; directorio: string }>("estado_kokoro");
    kokoro_instalado = estado.instalado;
  } catch { kokoro_instalado = false; }
  actualizar_panel_perfil();
}

function establecer_velocidad(velocidad: number): void {
  const continuar = reproduciendo;
  detener_voz();
  actualizar_perfil({ velocidad });
  const control = document.querySelector<HTMLInputElement>("#velocidad");
  if (control) control.value = String(perfil_actual.velocidad);
  if (continuar) reproducir_fragmento();
}

function establecer_palabras_por_minuto(palabras: number): void {
  actualizar_perfil({ palabras_por_minuto: palabras });
  const control = document.querySelector<HTMLInputElement>("#palabras-minuto");
  if (control) control.value = String(perfil_actual.palabras_por_minuto);
}

function actualizar_controles(): void {
  const titulo = document.querySelector<HTMLElement>("#documento-actual");
  const boton = document.querySelector<HTMLElement>("#reproducir");
  if (titulo) titulo.textContent = documento_actual?.titulo ?? "Ningún documento abierto";
  if (boton) { boton.textContent = reproduciendo ? "Ⅱ" : "▶"; boton.setAttribute("aria-label", preparando_voz ? "Cancelar preparación de voz" : reproduciendo ? "Pausar" : "Reproducir"); }
  actualizar_herramientas_pdf();
}

function configurar_atajo(control: HTMLInputElement, evento: KeyboardEvent): void {
  evento.preventDefault();
  evento.stopPropagation();
  const accion = control.dataset.atajo as AccionAtajo;
  const estado = document.querySelector<HTMLElement>("#estado-atajos");
  if (evento.key === "Escape") { control.value = describir_atajo(perfil_actual.atajos[accion]); control.blur(); return; }
  const candidato = atajo_desde_evento(evento);
  if (!candidato) { if (estado) estado.textContent = "Pulsa una tecla junto con los modificadores deseados."; return; }
  const conflicto = atajo_en_conflicto(perfil_actual.atajos, accion, candidato);
  if (conflicto) { if (estado) estado.textContent = `Ese atajo ya ejecuta «${ETIQUETAS_ATAJOS[conflicto]}».`; return; }
  actualizar_perfil({ atajos: { [accion]: candidato } });
  if (estado) estado.textContent = `${ETIQUETAS_ATAJOS[accion]}: ${describir_atajo(candidato)}.`;
  control.blur();
}

function ejecutar_atajo(accion: AccionAtajo): void {
  if (accion === "buscar") abrir_busqueda_global();
  if (accion === "reproducir") alternar_reproduccion();
  if (accion === "anterior") avanzar_fragmento(-1);
  if (accion === "siguiente") avanzar_fragmento(1);
  if (accion === "modo_enfoque") actualizar_perfil({ modo_enfoque: !perfil_actual.modo_enfoque });
  if (accion === "alternar_pdf" && documento_actual?.formato === "PDF") {
    const siguiente: ModoVisualPdf = modo_visual_pdf === "texto" ? "original" : modo_visual_pdf === "original" ? "doble" : "texto";
    void establecer_vista_pdf(siguiente);
  }
}

function montar_aplicacion(): void {
  const aplicacion = document.querySelector<HTMLElement>("#app");
  if (!aplicacion) return;
  aplicacion.innerHTML = `<div class="aplicacion"><header class="barra-superior">
    <nav class="pestanas" aria-label="Documentos abiertos"><button class="pestana activa" data-vista="biblioteca">Biblioteca</button><span id="pestanas-documentos" class="pestanas-documentos" role="tablist"></span></nav>
    <div class="acciones-superiores"><button id="modo-enfoque" class="boton">Modo lectura</button><input id="archivo" class="oculto" type="file" accept=".pdf,.epub,.md,.markdown" multiple><input id="carpeta" class="oculto" type="file" accept=".pdf,.epub,.md,.markdown" webkitdirectory multiple></div><div class="busqueda-global" role="search" aria-label="Buscar en la vista actual" hidden><input id="busqueda-global" type="search" placeholder="Buscar" aria-label="Texto que buscar"><span id="estado-busqueda-global" aria-live="polite"></span><button id="busqueda-anterior" aria-label="Resultado anterior">↑</button><button id="busqueda-siguiente" aria-label="Resultado siguiente">↓</button><button id="cerrar-busqueda-global" aria-label="Cerrar búsqueda">×</button></div></header>
    <div class="contenido"><aside id="panel-biblioteca" class="panel"><button id="alternar-panel-biblioteca" class="flecha-panel flecha-panel-izquierda" aria-label="Ocultar biblioteca">‹</button><div class="panel-contenido"><div class="pestanas-panel"><button class="activo" data-pestana-izquierda="biblioteca">Biblioteca</button><button data-pestana-izquierda="indice">Índice</button></div><div id="contenido-biblioteca"><section class="panel-seccion"><div class="encabezado-panel"><h2 class="panel-titulo">Organización</h2><button id="abrir-menu-agregar" class="agregar-biblioteca" aria-label="Añadir a biblioteca" title="Añadir a biblioteca">+</button></div><nav id="navegacion-biblioteca" class="navegacion"></nav></section>
    <section class="panel-seccion"><h2 class="panel-titulo">Carpetas</h2><nav id="carpetas-biblioteca" class="navegacion"></nav></section></div><section id="contenido-indice" class="panel-seccion" hidden></section>
    </div></aside><section id="vista-principal" class="vista-principal"></section><aside id="panel-inspector" class="panel panel-derecho"><button id="alternar-panel-inspector" class="flecha-panel flecha-panel-derecha" aria-label="Ocultar panel lateral">›</button><div class="panel-contenido"><div class="pestanas-panel"><button class="activo" data-pestana-derecha="fragmentos">Libreta</button><button data-pestana-derecha="perfil">Configuración</button></div><div id="contenido-perfil" hidden><details class="panel-seccion grupo-configuracion"><summary>Apariencia</summary><div class="contenido-grupo-configuracion">
    <div class="campo"><div class="encabezado-campo"><label>Temas</label><button id="abrir-biblioteca-temas" class="boton-biblioteca-temas" aria-label="Abrir biblioteca de temas" title="Biblioteca de temas">▦</button></div><div class="temas-predefinidos"><button data-tema-preset="diurno">Diurno</button><button data-tema-preset="nocturno">Nocturno</button><button data-tema-preset="sepia">Sepia</button><button data-tema-preset="contraste">Contraste</button></div></div>
    <div class="campo"><label>Colores personalizados</label><div class="colores-personalizados">${Object.entries(perfil_actual.colores).map(([nombre, valor]) => `<label>${nombre}<input type="color" data-color-interfaz="${nombre}" value="${valor}"></label>`).join("")}</div></div>
    <div class="campo"><div class="campo-linea"><label for="tamano">Tamaño</label><span id="valor-tamano"></span></div><input id="tamano" type="range" min="12" max="40" value="${perfil_actual.tamano_fuente}"></div></div></details>
    <details class="panel-seccion grupo-configuracion" open><summary>Lectura</summary><div class="contenido-grupo-configuracion">
    <div class="campo"><label for="modo-lectura-selector">Presentación</label><select id="modo-lectura-selector"><option value="continua">Lectura continua</option><option value="rsvp">RSVP centrado</option></select></div>
    <div class="campo" data-solo-rsvp><label for="unidad-rsvp">Unidad RSVP</label><select id="unidad-rsvp"><option value="palabra">Una palabra</option><option value="frase">Frase</option></select></div>
    <details class="menu-omisiones-voz"><summary>Contenido en voz</summary><div class="contenido-menu-omisiones"><div class="campo"><label for="matematica">Matemática en voz</label><select id="matematica"><option value="leer">Leer</option><option value="omitir">Omitir</option><option value="indicar">Decir «ecuación»</option></select></div><fieldset class="lista-omisiones-voz"><legend>Omitir al leer</legend><label><input id="saltar-citas" type="checkbox"> Citas bibliográficas</label><label><input type="checkbox" checked disabled> Símbolos ilegibles</label></fieldset></div></details>
    <div class="campo campo-linea"><label for="auto-scroll">Auto-scroll</label><input id="auto-scroll" class="interruptor" type="checkbox"></div></div></details>
    <details class="panel-seccion grupo-configuracion" open><summary><span>Voz</span><button id="abrir-repositorios-voz" class="boton-biblioteca-temas" aria-label="Administrar repositorios de voz" title="Repositorios de voz">⬡</button></summary><div class="contenido-grupo-configuracion"><div class="campo campo-linea campo-voz-habilitada"><label for="voz-habilitada">Voz habilitada</label><input id="voz-habilitada" class="interruptor" type="checkbox"></div><div class="campo"><label for="motor-voz">Motor</label><select id="motor-voz"><option value="sistema">TTS del sistema · experimental</option><option value="kokoro_onnx" ${kokoro_instalado ? "" : "disabled"}>Kokoro ONNX${kokoro_instalado ? " · verificado" : " · no instalado"}</option></select></div><div class="campo" data-solo-kokoro><label for="idioma-voz">Paquete de idioma</label><select id="idioma-voz"><option value="es">Español genérico</option><option value="en-us">Inglés · Estados Unidos</option><option value="en-gb">Inglés · Reino Unido</option></select></div><div class="campo" data-solo-kokoro><label for="voz-base">Voz compatible</label><select id="voz-base"></select></div><div class="control-velocidad-voz" data-solo-con-voz><label>Velocidad de reproducción</label><div class="velocidad-linea"><button id="velocidad-menos" class="velocidad-ajuste" aria-label="Reducir velocidad en 0.1">−</button><input id="velocidad" type="range" min="0.5" max="3" step="0.1" value="${perfil_actual.velocidad}"><button id="velocidad-mas" class="velocidad-ajuste" aria-label="Aumentar velocidad en 0.1">+</button><span id="valor-velocidad"></span></div><div class="velocidades-rapidas"><button data-velocidad="1">1×</button><button data-velocidad="1.5">1.5×</button><button data-velocidad="2">2×</button></div></div><p class="ayuda-campo" data-solo-kokoro>Idioma y voz se sincronizan automáticamente para evitar combinaciones incompatibles.</p></div></details><details class="panel-seccion grupo-configuracion"><summary>Sistema</summary><div class="contenido-grupo-configuracion"><div class="campo campo-linea"><label for="mostrar-informes-error">Mostrar informes de error</label><input id="mostrar-informes-error" class="interruptor" type="checkbox" ${informes_error_habilitados ? "checked" : ""}></div><fieldset class="atajos-configurables"><legend>Atajos de teclado</legend>${Object.entries(ETIQUETAS_ATAJOS).map(([accion, etiqueta]) => `<label for="atajo-${accion}">${etiqueta}</label><input id="atajo-${accion}" data-atajo="${accion}" value="${describir_atajo(perfil_actual.atajos[accion as AccionAtajo])}" readonly aria-describedby="ayuda-atajos estado-atajos">`).join("")}<p id="ayuda-atajos">Selecciona un campo y pulsa la combinación nueva. Escape cancela.</p><p id="estado-atajos" role="status"></p><button id="restaurar-atajos" class="boton" type="button">Restaurar atajos</button></fieldset></div></details></div><section id="contenido-fragmentos" class="panel-seccion"></section></div></aside></div>
    <div id="menu-agregar" class="menu-agregar" hidden><button id="anadir-archivo">Añadir archivo</button><button id="anadir-carpeta">Añadir carpeta del sistema</button><button id="crear-carpeta">Crear carpeta virtual</button></div><div id="menu-contextual" class="menu-agregar menu-contextual" hidden></div><section id="biblioteca-temas" class="modal-temas" hidden><div class="dialogo-temas"><header><div><h2>Biblioteca de temas</h2><p>Paletas locales para lectura e interfaz</p></div><button id="cerrar-biblioteca-temas" aria-label="Cerrar">×</button></header><div id="lista-biblioteca-temas" class="lista-biblioteca-temas"></div><footer><button id="guardar-tema-actual" class="boton primario">Guardar tema actual</button></footer></div></section><section id="repositorios-voz" class="modal-temas" hidden><div class="dialogo-temas dialogo-repositorios"><header><h2>Repositorios de voz</h2><button id="cerrar-repositorios-voz" aria-label="Cerrar">×</button></header><div id="lista-repositorios-voz" class="lista-repositorios-voz"></div><footer><button id="actualizar-estado-voz" class="boton">Comprobar estado</button></footer></div></section>
    <section id="informador-error" class="informador-error" role="alertdialog" aria-labelledby="error-contexto" aria-describedby="error-detalle" hidden><div><header><strong id="error-contexto">Error de Carlector</strong><button id="cerrar-informador-error" aria-label="Cerrar">×</button></header><p id="error-detalle"></p><small id="error-fecha"></small><footer><label><input id="no-mostrar-errores" type="checkbox"> No volver a mostrar</label><button id="aceptar-informador-error" class="boton primario">Cerrar</button></footer></div></section><section id="carga-importacion" class="carga-importacion" role="status" aria-live="polite" hidden><strong>Cargando biblioteca</strong><span id="carga-nombre"></span><progress id="carga-progreso" max="100"></progress><small id="carga-estado"></small></section><button id="salir-modo-enfoque" type="button" aria-label="Salir del modo lectura">×</button>
    <footer class="control-inferior"><div class="control-documento"><strong id="documento-actual"></strong></div><div class="reproductor"><button id="anterior" class="boton-icono" aria-label="Fragmento anterior">←</button><button id="reproducir" class="reproducir" aria-label="Reproducir" title="Reproducir o pausar · Space">▶</button><button id="siguiente" class="boton-icono" aria-label="Fragmento siguiente">→</button></div><div class="control-velocidad" data-solo-sin-voz><div class="velocidad-linea"><button id="palabras-menos" class="velocidad-ajuste" aria-label="Reducir palabras por minuto">−</button><input id="palabras-minuto" type="range" min="60" max="1200" step="10" value="${perfil_actual.palabras_por_minuto}"><button id="palabras-mas" class="velocidad-ajuste" aria-label="Aumentar palabras por minuto">+</button><span id="valor-palabras-minuto"></span></div><div class="velocidades-rapidas"><button data-palabras-minuto="200">200</button><button data-palabras-minuto="300">300</button><button data-palabras-minuto="450">450</button></div></div></footer></div>`;

  ([["#biblioteca-temas", "Biblioteca de temas"], ["#repositorios-voz", "Repositorios de voz"]] as Array<[string, string]>).forEach(([selector, etiqueta]) => {
    const modal = document.querySelector<HTMLElement>(selector);
    if (!modal) return;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", etiqueta);
  });
  document.querySelector<HTMLElement>("#informador-error")?.setAttribute("aria-modal", "true");
  document.querySelectorAll<HTMLElement>("[data-vista]").forEach((boton) => boton.addEventListener("click", () => cambiar_vista(boton.dataset.vista as "biblioteca" | "lector")));
  document.querySelector("#pestanas-documentos")?.addEventListener("click", (evento) => {
    const objetivo = evento.target instanceof Element ? evento.target : null;
    const dividir = objetivo?.closest<HTMLElement>("[data-dividir-pestana]")?.dataset.dividirPestana;
    if (dividir) { alternar_pestana_dividida(dividir); return; }
    const cerrar = objetivo?.closest<HTMLElement>("[data-cerrar-pestana]")?.dataset.cerrarPestana;
    if (cerrar) { void cerrar_pestana_documento(cerrar); return; }
    const id = objetivo?.closest<HTMLElement>("[data-pestana-documento]")?.dataset.pestanaDocumento;
    if (id) void abrir_documento(id);
  });
  document.querySelector("#pestanas-documentos")?.addEventListener("keydown", (evento) => {
    const teclado = evento as KeyboardEvent;
    if (teclado.key !== "ArrowLeft" && teclado.key !== "ArrowRight") return;
    const pestanas = [...document.querySelectorAll<HTMLButtonElement>("[data-pestana-documento]")];
    const actual = pestanas.indexOf(document.activeElement as HTMLButtonElement);
    if (actual < 0) return;
    const siguiente = pestanas[(actual + (teclado.key === "ArrowRight" ? 1 : -1) + pestanas.length) % pestanas.length];
    if (siguiente) { teclado.preventDefault(); siguiente.focus(); void abrir_documento(siguiente.dataset.pestanaDocumento ?? ""); }
  });
  document.querySelector<HTMLElement>("#vista-principal")?.addEventListener("scroll", () => guardar_posicion_actual(), { passive: true });
  document.querySelector<HTMLElement>("#vista-principal")?.addEventListener("wheel", suspender_autoscroll_manual, { passive: true });
  document.querySelector<HTMLElement>("#vista-principal")?.addEventListener("touchmove", suspender_autoscroll_manual, { passive: true });
  window.addEventListener("beforeunload", () => guardar_posicion_actual(true));
  document.querySelector<HTMLInputElement>("#busqueda-global")?.addEventListener("input", (evento) => actualizar_busqueda_diferida((evento.currentTarget as HTMLInputElement).value));
  document.querySelector<HTMLInputElement>("#busqueda-global")?.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
      actualizar_busqueda_diferida.cancelar();
      actualizar_busqueda_global((evento.currentTarget as HTMLInputElement).value);
      mover_resultado_busqueda(evento.shiftKey ? -1 : 1);
    }
    if (evento.key === "Escape") {
      cerrar_busqueda_global();
    }
  });
  document.querySelector("#busqueda-anterior")?.addEventListener("click", () => mover_resultado_busqueda(-1));
  document.querySelector("#busqueda-siguiente")?.addEventListener("click", () => mover_resultado_busqueda(1));
  document.querySelector("#cerrar-busqueda-global")?.addEventListener("click", () => cerrar_busqueda_global());
  document.querySelectorAll<HTMLElement>("[data-pestana-izquierda]").forEach((boton) => boton.addEventListener("click", () => {
    pestana_izquierda = boton.dataset.pestanaIzquierda as "biblioteca" | "indice"; renderizar_panel_izquierdo();
  }));
  document.querySelectorAll<HTMLElement>("[data-pestana-derecha]").forEach((boton) => boton.addEventListener("click", () => {
    pestana_derecha = boton.dataset.pestanaDerecha as "perfil" | "fragmentos"; renderizar_panel_fragmentos();
  }));
  document.querySelector("#abrir-menu-agregar")?.addEventListener("click", (evento) => {
    const boton = evento.currentTarget as HTMLButtonElement;
    const menu = document.querySelector<HTMLElement>("#menu-agregar");
    if (!menu) return;
    const abrir = menu.hidden;
    menu.hidden = !abrir;
    if (abrir) {
      const rectangulo = boton.getBoundingClientRect();
      posicionar_superposicion(menu, { izquierda: rectangulo.left, superior: rectangulo.top, derecha: rectangulo.right, inferior: rectangulo.bottom });
    }
  });
  document.querySelector("#anadir-archivo")?.addEventListener("click", () => {
    const menu = document.querySelector<HTMLElement>("#menu-agregar");
    if (menu) menu.hidden = true;
    if (isTauri()) void ejecutar_importacion(importar_con_dialogo_nativo, "No fue posible importar el archivo");
    else document.querySelector<HTMLInputElement>("#archivo")?.click();
  });
  document.querySelector("#anadir-carpeta")?.addEventListener("click", () => {
    const menu = document.querySelector<HTMLElement>("#menu-agregar");
    if (menu) menu.hidden = true;
    if (isTauri()) void ejecutar_importacion(importar_carpeta_nativa, "No fue posible importar la carpeta");
    else document.querySelector<HTMLInputElement>("#carpeta")?.click();
  });
  document.querySelector("#crear-carpeta")?.addEventListener("click", () => { document.querySelector<HTMLElement>("#menu-agregar")?.setAttribute("hidden", ""); void crear_carpeta_biblioteca(); });
  document.querySelector("#alternar-panel-biblioteca")?.addEventListener("click", () => actualizar_perfil({ componentes: { biblioteca: !perfil_actual.componentes.biblioteca, ...(es_interfaz_movil() ? { inspector: false } : {}) } }));
  document.querySelector("#alternar-panel-inspector")?.addEventListener("click", () => actualizar_perfil({ componentes: { inspector: !perfil_actual.componentes.inspector, ...(es_interfaz_movil() ? { biblioteca: false } : {}) } }));
  document.querySelector("#salir-modo-enfoque")?.addEventListener("click", () => actualizar_perfil({ modo_enfoque: false }));
  document.querySelector<HTMLInputElement>("#archivo")?.addEventListener("change", async (evento) => {
    const entrada = evento.currentTarget as HTMLInputElement;
    try { await importar_documentos(entrada.files); }
    catch (error) { informar_error("Importación de documento", error); }
    finally { entrada.value = ""; }
  });
  document.querySelector<HTMLInputElement>("#carpeta")?.addEventListener("change", async (evento) => {
    const entrada = evento.currentTarget as HTMLInputElement;
    try { await importar_documentos(entrada.files); }
    catch (error) { informar_error("Importación de carpeta", error); }
    finally { entrada.value = ""; }
  });
  document.querySelector("#reproducir")?.addEventListener("click", alternar_reproduccion);
  document.querySelector("#anterior")?.addEventListener("click", () => avanzar_fragmento(-1));
  document.querySelector("#siguiente")?.addEventListener("click", () => avanzar_fragmento(1));
  document.querySelector("#modo-enfoque")?.addEventListener("click", () => actualizar_perfil({ modo_enfoque: !perfil_actual.modo_enfoque }));
  document.querySelectorAll<HTMLButtonElement>("[data-tema-preset]").forEach((boton) => boton.addEventListener("click", () => {
    const tema = TEMAS_PREDEFINIDOS[boton.dataset.temaPreset ?? ""];
    if (tema) { actualizar_perfil({ tema: tema.tema, colores: tema.colores }); sincronizar_controles_colores(); }
  }));
  document.querySelector("#abrir-biblioteca-temas")?.addEventListener("click", () => { renderizar_biblioteca_temas(); abrir_modal("#biblioteca-temas"); });
  document.querySelector("#cerrar-biblioteca-temas")?.addEventListener("click", () => cerrar_modal("#biblioteca-temas"));
  document.querySelector("#guardar-tema-actual")?.addEventListener("click", guardar_tema_actual);
  document.querySelector("#abrir-repositorios-voz")?.addEventListener("click", () => {
    renderizar_repositorios_voz();
    abrir_modal("#repositorios-voz");
    void actualizar_estado_kokoro().then(renderizar_repositorios_voz);
  });
  document.querySelector("#cerrar-repositorios-voz")?.addEventListener("click", () => cerrar_modal("#repositorios-voz"));
  document.querySelector("#repositorios-voz")?.addEventListener("click", (evento) => {
    if (evento.target === evento.currentTarget) { cerrar_modal("#repositorios-voz"); return; }
    const objetivo = evento.target instanceof Element ? evento.target : null;
    const descarga = objetivo?.closest<HTMLElement>("[data-descargar-voz]")?.dataset.descargarVoz;
    if (descarga) { void openUrl(descarga).catch((error) => informar_error("Apertura de descarga", error)); return; }
    if (objetivo?.closest("[data-instalar-kokoro]")) { void instalar_paquete_kokoro(); return; }
  });
  document.querySelector("#repositorios-voz")?.addEventListener("change", (evento) => {
    const control = evento.target instanceof HTMLInputElement ? evento.target.closest<HTMLInputElement>("[data-alternar-repositorio]") : null;
    if (control) alternar_repositorio_voz(control);
  });
  document.querySelector("#actualizar-estado-voz")?.addEventListener("click", () => void actualizar_estado_kokoro().then(renderizar_repositorios_voz));
  document.querySelector("#cerrar-informador-error")?.addEventListener("click", cerrar_informador_error);
  document.querySelector("#aceptar-informador-error")?.addEventListener("click", cerrar_informador_error);
  document.querySelector<HTMLInputElement>("#mostrar-informes-error")?.addEventListener("change", (evento) => {
    informes_error_habilitados = (evento.currentTarget as HTMLInputElement).checked;
    persistencia.guardarInformesError(informes_error_habilitados);
  });
  document.querySelectorAll<HTMLInputElement>("[data-atajo]").forEach((control) => control.addEventListener("keydown", (evento) => configurar_atajo(control, evento)));
  document.querySelector("#restaurar-atajos")?.addEventListener("click", () => { actualizar_perfil({ atajos: ATAJOS_PREDETERMINADOS }); const estado = document.querySelector<HTMLElement>("#estado-atajos"); if (estado) estado.textContent = "Atajos restaurados."; });
  document.querySelector("#biblioteca-temas")?.addEventListener("click", (evento) => { if (evento.target === evento.currentTarget) cerrar_modal("#biblioteca-temas"); });
  document.querySelectorAll<HTMLInputElement>("[data-color-interfaz]").forEach((control) => control.addEventListener("input", () => {
    const nombre = control.dataset.colorInterfaz as keyof PerfilLectura["colores"];
    actualizar_perfil({ colores: { [nombre]: control.value } });
  }));
  document.querySelector<HTMLInputElement>("#tamano")?.addEventListener("input", (evento) => actualizar_perfil({ tamano_fuente: Number((evento.currentTarget as HTMLInputElement).value) }));
  document.querySelector<HTMLSelectElement>("#matematica")?.addEventListener("change", (evento) => actualizar_perfil({ politica_matematica: (evento.currentTarget as HTMLSelectElement).value as PoliticaMatematica }));
  document.querySelector<HTMLInputElement>("#saltar-citas")?.addEventListener("change", (evento) => actualizar_perfil({ saltar_citas: (evento.currentTarget as HTMLInputElement).checked }));
  document.querySelector<HTMLInputElement>("#auto-scroll")?.addEventListener("change", (evento) => actualizar_perfil({ auto_scroll: (evento.currentTarget as HTMLInputElement).checked }));
  document.querySelector<HTMLSelectElement>("#modo-lectura-selector")?.addEventListener("change", (evento) => actualizar_perfil({ modo_lectura: (evento.currentTarget as HTMLSelectElement).value as PerfilLectura["modo_lectura"] }));
  document.querySelector<HTMLSelectElement>("#unidad-rsvp")?.addEventListener("change", (evento) => actualizar_perfil({ unidad_rsvp: (evento.currentTarget as HTMLSelectElement).value as PerfilLectura["unidad_rsvp"] }));
  document.querySelector<HTMLInputElement>("#voz-habilitada")?.addEventListener("change", (evento) => { const continuar = reproduciendo; detener_voz(); actualizar_perfil({ voz_habilitada: (evento.currentTarget as HTMLInputElement).checked }); if (continuar) reproducir_fragmento(); });
  document.querySelector<HTMLSelectElement>("#motor-voz")?.addEventListener("change", (evento) => usar_motor_voz((evento.currentTarget as HTMLSelectElement).value));
  document.querySelector<HTMLSelectElement>("#idioma-voz")?.addEventListener("change", (evento) => actualizar_idioma_kokoro((evento.currentTarget as HTMLSelectElement).value));
  document.querySelector<HTMLSelectElement>("#voz-base")?.addEventListener("change", (evento) => { detener_voz(); actualizar_perfil({ voz_base: (evento.currentTarget as HTMLSelectElement).value }); });
  document.querySelector<HTMLInputElement>("#palabras-minuto")?.addEventListener("input", (evento) => establecer_palabras_por_minuto(Number((evento.currentTarget as HTMLInputElement).value)));
  document.querySelector("#palabras-menos")?.addEventListener("click", () => establecer_palabras_por_minuto(ajustar_palabras_por_minuto(perfil_actual.palabras_por_minuto, -10)));
  document.querySelector("#palabras-mas")?.addEventListener("click", () => establecer_palabras_por_minuto(ajustar_palabras_por_minuto(perfil_actual.palabras_por_minuto, 10)));
  document.querySelectorAll<HTMLButtonElement>("[data-palabras-minuto]").forEach((boton) => boton.addEventListener("click", () => establecer_palabras_por_minuto(Number(boton.dataset.palabrasMinuto))));
  document.querySelector<HTMLInputElement>("#velocidad")?.addEventListener("input", (evento) => establecer_velocidad(Number((evento.currentTarget as HTMLInputElement).value)));
  document.querySelector("#velocidad-menos")?.addEventListener("click", () => establecer_velocidad(ajustar_velocidad(perfil_actual.velocidad, -0.1)));
  document.querySelector("#velocidad-mas")?.addEventListener("click", () => establecer_velocidad(ajustar_velocidad(perfil_actual.velocidad, 0.1)));
  document.querySelectorAll<HTMLButtonElement>("[data-velocidad]").forEach((boton) => boton.addEventListener("click", () => establecer_velocidad(Number(boton.dataset.velocidad))));
  const matematica = document.querySelector<HTMLSelectElement>("#matematica");
  const saltar_citas = document.querySelector<HTMLInputElement>("#saltar-citas");
  const auto_scroll = document.querySelector<HTMLInputElement>("#auto-scroll");
  const voz_habilitada = document.querySelector<HTMLInputElement>("#voz-habilitada");
  const modo_lectura = document.querySelector<HTMLSelectElement>("#modo-lectura-selector");
  const unidad_rsvp = document.querySelector<HTMLSelectElement>("#unidad-rsvp");
  if (matematica) matematica.value = perfil_actual.politica_matematica;
  if (saltar_citas) saltar_citas.checked = perfil_actual.saltar_citas;
  if (auto_scroll) auto_scroll.checked = perfil_actual.auto_scroll;
  if (voz_habilitada) voz_habilitada.checked = perfil_actual.voz_habilitada;
  if (modo_lectura) modo_lectura.value = perfil_actual.modo_lectura;
  if (unidad_rsvp) unidad_rsvp.value = perfil_actual.unidad_rsvp;
  document.addEventListener("click", (evento) => {
    const dentro_contextual = evento.target instanceof Element && evento.target.closest("#menu-contextual");
    const dentro_agregar = evento.target instanceof Element && evento.target.closest("#menu-agregar, #abrir-menu-agregar");
    if (!dentro_contextual) cerrar_menus_contextuales();
    if (!dentro_agregar) document.querySelector<HTMLElement>("#menu-agregar")?.setAttribute("hidden", "");
  });
  document.addEventListener("scroll", () => { cerrar_menus_contextuales(); document.querySelector<HTMLElement>("#menu-agregar")?.setAttribute("hidden", ""); }, true);
  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") {
      if (!document.querySelector<HTMLElement>(".busqueda-global")?.hidden) { cerrar_busqueda_global(); return; }
      if (!document.querySelector<HTMLElement>("#informador-error")?.hidden) { cerrar_informador_error(); return; }
      if (!document.querySelector<HTMLElement>("#biblioteca-temas")?.hidden) { cerrar_modal("#biblioteca-temas"); return; }
      if (!document.querySelector<HTMLElement>("#repositorios-voz")?.hidden) { cerrar_modal("#repositorios-voz"); return; }
    }
    if (evento.key === "Escape" && perfil_actual.modo_enfoque) { actualizar_perfil({ modo_enfoque: false }); return; }
    if (evento.key === "Escape") { cerrar_menus_contextuales(); document.querySelector<HTMLElement>("#menu-agregar")?.setAttribute("hidden", ""); }
    const objetivo = evento.target instanceof HTMLElement ? evento.target : null;
    const accion = accion_de_atajo(perfil_actual.atajos, evento);
    if (!accion || objetivo?.isContentEditable || objetivo?.matches("input,textarea,select")) return;
    evento.preventDefault();
    ejecutar_atajo(accion);
  });
  const redibujar_pdf = crear_ejecutor_diferido(() => { if (es_vista_pdf_original()) void renderizar_pagina_pdf(pagina_pdf_actual); }, 160);
  window.addEventListener("resize", redibujar_pdf);
  enlazar_eventos_biblioteca();
  if (es_interfaz_movil()) perfil_actual = normalizar_perfil({ ...perfil_actual, componentes: { ...perfil_actual.componentes, biblioteca: false, inspector: false } });
  aplicar_perfil(); renderizar_panel_izquierdo(); renderizar_panel_fragmentos(); renderizar_biblioteca(); actualizar_panel_perfil(); actualizar_controles(); renderizar_pestanas_documentos();
  void actualizar_estado_kokoro();
  void inicializar_apertura_archivos_nativa().catch((error) => informar_error("Apertura de documentos", error));
  if (!isTauri() && sesion_pestanas.activa) void abrir_documento(sesion_pestanas.activa);
}

function restablecer_origen_interfaz(): void {
  document.scrollingElement?.scrollTo(0, 0);
}

restablecer_origen_interfaz();
montar_aplicacion();
requestAnimationFrame(restablecer_origen_interfaz);
window.addEventListener("pageshow", restablecer_origen_interfaz);
