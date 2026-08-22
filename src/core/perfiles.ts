import type { ColoresInterfaz, PerfilLectura } from "./modelos";

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
  modo_lectura: "continua",
  unidad_rsvp: "frase_corta",
  palabras_rsvp: 3,
  palabras_por_minuto: 300,
  estrategia_segmentacion: "puntuacion",
  maximo_palabras_segmento: 12,
  voz_habilitada: true,
  motor_voz: "sistema",
  idioma_voz: "es",
  voz_base: "af_heart",
  componentes: { biblioteca: true, inspector: true, controles: true },
  colores: TEMAS_PREDEFINIDOS.diurno!.colores,
};

export type PerfilLecturaParcial = Omit<Partial<PerfilLectura>, "componentes" | "colores"> & {
  componentes?: Partial<PerfilLectura["componentes"]>;
  colores?: Partial<PerfilLectura["colores"]>;
};

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

export function ajustar_velocidad(velocidad: number, cambio: number): number {
  return Math.min(3, Math.max(0.5, Math.round((velocidad + cambio) * 10) / 10));
}

export function normalizar_perfil(valor: PerfilLecturaParcial): PerfilLectura {
  const colores_base = valor.tema === "oscuro" ? TEMAS_PREDEFINIDOS.nocturno!.colores : PERFIL_PREDETERMINADO.colores;
  return {
    ...PERFIL_PREDETERMINADO,
    ...valor,
    tamano_fuente: Math.min(40, Math.max(12, Number(valor.tamano_fuente ?? 20))),
    interlineado: Math.min(2.5, Math.max(1.1, Number(valor.interlineado ?? 1.72))),
    ancho_lectura: Math.min(1200, Math.max(420, Number(valor.ancho_lectura ?? 760))),
    velocidad: Math.min(3, Math.max(0.5, Number(valor.velocidad ?? 1))),
    modo_lectura: valor.modo_lectura === "rsvp" ? "rsvp" : "continua",
    unidad_rsvp: valor.unidad_rsvp === "palabra" ? "palabra" : "frase_corta",
    palabras_rsvp: Math.min(8, Math.max(1, Math.round(Number(valor.palabras_rsvp ?? 3)))),
    palabras_por_minuto: Math.min(1200, Math.max(60, Math.round(Number(valor.palabras_por_minuto ?? 300)))),
    estrategia_segmentacion: valor.estrategia_segmentacion === "cinco_palabras" ? "cinco_palabras" : "puntuacion",
    maximo_palabras_segmento: Math.min(24, Math.max(2, Math.round(Number(valor.maximo_palabras_segmento ?? 12)))),
    voz_habilitada: valor.voz_habilitada !== false,
    motor_voz: valor.motor_voz === "kokoro_onnx" ? "kokoro_onnx" : "sistema",
    idioma_voz: typeof valor.idioma_voz === "string" && valor.idioma_voz.trim() ? valor.idioma_voz.trim() : PERFIL_PREDETERMINADO.idioma_voz,
    voz_base: typeof valor.voz_base === "string" && valor.voz_base.trim() ? valor.voz_base.trim() : PERFIL_PREDETERMINADO.voz_base,
    componentes: { ...PERFIL_PREDETERMINADO.componentes, ...valor.componentes },
    colores: Object.fromEntries(Object.entries(colores_base).map(([clave, alternativa]) => [clave, normalizar_color(valor.colores?.[clave as keyof ColoresInterfaz], alternativa)])) as unknown as ColoresInterfaz,
  };
}
