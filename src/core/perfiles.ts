import type { ColoresInterfaz, ComponentesInterfaz, DisposicionInterfaz, PerfilLectura } from "./modelos";
import { ATAJOS_PREDETERMINADOS, normalizar_atajos } from "./atajos.ts";

export const TEMAS_PREDEFINIDOS: Record<string, { tema: PerfilLectura["tema"]; colores: ColoresInterfaz }> = {
  diurno: { tema: "claro", colores: { fondo: "#efeee9", superficie: "#f9f8f4", panel: "#e8e6df", borde: "#d3d0c6", texto: "#25241f", atenuado: "#716e65", acento: "#bc5c39", resaltado: "#f4c58e" } },
  nocturno: { tema: "oscuro", colores: { fondo: "#171816", superficie: "#20211e", panel: "#292a26", borde: "#3a3b36", texto: "#eceae3", atenuado: "#aaa79d", acento: "#db7a55", resaltado: "#d69a57" } },
  sepia: { tema: "claro", colores: { fondo: "#e9dfc9", superficie: "#f5ecd9", panel: "#ded0b5", borde: "#c9b995", texto: "#3b3024", atenuado: "#756450", acento: "#9a5437", resaltado: "#e7bd78" } },
  contraste: { tema: "oscuro", colores: { fondo: "#000000", superficie: "#080808", panel: "#141414", borde: "#ffffff", texto: "#ffffff", atenuado: "#dddddd", acento: "#00d9ff", resaltado: "#ffe600" } },
};

export const PERFIL_PREDETERMINADO: PerfilLectura = {
  id: "predeterminado",
  nombre: "Lectura diurna",
  tema: "claro",
  fuente: "Literata, Charter, Georgia, serif",
  tamano_fuente: 20,
  interlineado: 1.72,
  ancho_lectura: 760,
  velocidad: 1,
  auto_scroll: true,
  modo_enfoque: false,
  politica_matematica: "indicar",
  saltar_citas: false,
  modo_lectura: "continua",
  unidad_rsvp: "frase",
  palabras_por_minuto: 300,
  voz_habilitada: true,
  motor_voz: "sistema",
  idioma_voz: "es",
  voz_base: "af_heart",
  componentes: {
    biblioteca: true,
    inspector: true,
    controles: true,
    barra_superior: true,
    pestanas: true,
    herramientas_pdf: true,
    acceso_libreta: true,
  },
  disposicion: {
    ancho_biblioteca: 236,
    ancho_inspector: 286,
    alto_barra_superior: 58,
    alto_controles: 76,
    escala_controles: 1,
  },
  atajos: ATAJOS_PREDETERMINADOS,
  colores: TEMAS_PREDEFINIDOS.diurno!.colores,
};

export type PerfilLecturaParcial = Omit<Partial<PerfilLectura>, "componentes" | "disposicion" | "colores" | "atajos" | "unidad_rsvp"> & {
  componentes?: Partial<PerfilLectura["componentes"]>;
  disposicion?: Partial<PerfilLectura["disposicion"]>;
  colores?: Partial<PerfilLectura["colores"]>;
  atajos?: Partial<PerfilLectura["atajos"]>;
  estrategia_segmentacion?: unknown;
  maximo_palabras_segmento?: unknown;
  palabras_rsvp?: unknown;
  unidad_rsvp?: unknown;
};

function limitar(numero: unknown, minimo: number, maximo: number, alternativa: number): number {
  const valor = Number(numero);
  return Number.isFinite(valor) ? Math.min(maximo, Math.max(minimo, valor)) : alternativa;
}

export function normalizar_disposicion(valor: Partial<DisposicionInterfaz> | undefined): DisposicionInterfaz {
  return {
    ancho_biblioteca: limitar(valor?.ancho_biblioteca, 180, 420, PERFIL_PREDETERMINADO.disposicion.ancho_biblioteca),
    ancho_inspector: limitar(valor?.ancho_inspector, 220, 480, PERFIL_PREDETERMINADO.disposicion.ancho_inspector),
    alto_barra_superior: limitar(valor?.alto_barra_superior, 48, 88, PERFIL_PREDETERMINADO.disposicion.alto_barra_superior),
    alto_controles: limitar(valor?.alto_controles, 56, 120, PERFIL_PREDETERMINADO.disposicion.alto_controles),
    escala_controles: limitar(valor?.escala_controles, 0.8, 1.35, PERFIL_PREDETERMINADO.disposicion.escala_controles),
  };
}

function normalizar_color(valor: unknown, alternativa: string): string {
  return typeof valor === "string" && /^#[0-9a-f]{6}$/i.test(valor) ? valor.toLowerCase() : alternativa;
}

export function clases_visibilidad_paneles(
  componentes: Pick<PerfilLectura["componentes"], "biblioteca" | "inspector">,
): string[] {
  return [
    componentes.biblioteca ? null : "sin-panel-biblioteca",
    componentes.inspector ? null : "sin-panel-inspector",
  ].filter((clase): clase is string => clase !== null);
}

export function combinar_componentes_documento(
  actuales: ComponentesInterfaz,
  estado: Pick<ComponentesInterfaz, "biblioteca" | "inspector" | "controles">,
): ComponentesInterfaz {
  return { ...actuales, ...estado };
}

export function ajustar_velocidad(velocidad: number, cambio: number): number {
  return Math.min(3, Math.max(0.5, Math.round((velocidad + cambio) * 10) / 10));
}

export function ajustar_palabras_por_minuto(palabras: number, cambio: number): number {
  return Math.min(1200, Math.max(60, Math.round((palabras + cambio) / 10) * 10));
}

export function normalizar_perfil(valor: PerfilLecturaParcial): PerfilLectura {
  const { estrategia_segmentacion: estrategia_legacy, maximo_palabras_segmento: maximo_legacy, palabras_rsvp: palabras_rsvp_legacy, ...vigente } = valor;
  void estrategia_legacy;
  void maximo_legacy;
  void palabras_rsvp_legacy;
  const colores_base = vigente.tema === "oscuro" ? TEMAS_PREDEFINIDOS.nocturno!.colores : PERFIL_PREDETERMINADO.colores;
  return {
    ...PERFIL_PREDETERMINADO,
    ...vigente,
    tamano_fuente: Math.min(40, Math.max(12, Number(vigente.tamano_fuente ?? 20))),
    interlineado: Math.min(2.5, Math.max(1.1, Number(vigente.interlineado ?? 1.72))),
    ancho_lectura: Math.min(1200, Math.max(420, Number(vigente.ancho_lectura ?? 760))),
    velocidad: Math.min(3, Math.max(0.5, Number(vigente.velocidad ?? 1))),
    modo_lectura: vigente.modo_lectura === "rsvp" ? "rsvp" : "continua",
    unidad_rsvp: vigente.unidad_rsvp === "palabra" ? "palabra" : "frase",
    palabras_por_minuto: Math.min(1200, Math.max(60, Math.round(Number(vigente.palabras_por_minuto ?? 300)))),
    saltar_citas: vigente.saltar_citas === true,
    voz_habilitada: vigente.voz_habilitada !== false,
    motor_voz: vigente.motor_voz === "kokoro_onnx" ? "kokoro_onnx" : "sistema",
    idioma_voz: typeof vigente.idioma_voz === "string" && vigente.idioma_voz.trim() ? vigente.idioma_voz.trim() : PERFIL_PREDETERMINADO.idioma_voz,
    voz_base: typeof vigente.voz_base === "string" && vigente.voz_base.trim() ? vigente.voz_base.trim() : PERFIL_PREDETERMINADO.voz_base,
    componentes: { ...PERFIL_PREDETERMINADO.componentes, ...vigente.componentes },
    disposicion: normalizar_disposicion(vigente.disposicion),
    atajos: normalizar_atajos(vigente.atajos),
    colores: Object.fromEntries(Object.entries(colores_base).map(([clave, alternativa]) => [clave, normalizar_color(vigente.colores?.[clave as keyof ColoresInterfaz], alternativa)])) as unknown as ColoresInterfaz,
  };
}
