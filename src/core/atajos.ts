import type { AtajosLectura, AtajoTeclado } from "./modelos.ts";

export type AccionAtajo = keyof AtajosLectura;

export const ATAJOS_PREDETERMINADOS: AtajosLectura = {
  buscar: { code: "KeyF", meta: true, alt: false, shift: false },
  reproducir: { code: "Space", meta: false, alt: false, shift: false },
  anterior: { code: "ArrowLeft", meta: false, alt: false, shift: false },
  siguiente: { code: "ArrowRight", meta: false, alt: false, shift: false },
  modo_enfoque: { code: "KeyM", meta: false, alt: false, shift: false },
  alternar_pdf: { code: "KeyO", meta: false, alt: false, shift: false },
};

const ACCIONES = Object.keys(ATAJOS_PREDETERMINADOS) as AccionAtajo[];
const MODIFICADORES = new Set(["MetaLeft", "MetaRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight"]);

function es_atajo_valido(valor: unknown): valor is AtajoTeclado {
  if (!valor || typeof valor !== "object") return false;
  const atajo = valor as Partial<AtajoTeclado>;
  return typeof atajo.code === "string" && Boolean(atajo.code) && !MODIFICADORES.has(atajo.code)
    && typeof atajo.meta === "boolean" && typeof atajo.alt === "boolean" && typeof atajo.shift === "boolean";
}

function clave_atajo(atajo: AtajoTeclado): string {
  return `${atajo.meta ? 1 : 0}:${atajo.alt ? 1 : 0}:${atajo.shift ? 1 : 0}:${atajo.code}`;
}

export function normalizar_atajos(valor: Partial<AtajosLectura> | undefined): AtajosLectura {
  const resultado = {} as AtajosLectura;
  const ocupados = new Set<string>();
  for (const accion of ACCIONES) {
    const candidato = es_atajo_valido(valor?.[accion]) ? valor[accion] : ATAJOS_PREDETERMINADOS[accion];
    const definitivo = ocupados.has(clave_atajo(candidato)) ? ATAJOS_PREDETERMINADOS[accion] : candidato;
    resultado[accion] = { ...definitivo };
    ocupados.add(clave_atajo(definitivo));
  }
  return resultado;
}

export interface EventoAtajo {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

export function atajo_desde_evento(evento: EventoAtajo): AtajoTeclado | null {
  if (MODIFICADORES.has(evento.code)) return null;
  return { code: evento.code, meta: evento.metaKey || evento.ctrlKey, alt: evento.altKey, shift: evento.shiftKey };
}

export function accion_de_atajo(atajos: AtajosLectura, evento: EventoAtajo): AccionAtajo | null {
  if (evento.repeat) return null;
  const pulsado = atajo_desde_evento(evento);
  if (!pulsado) return null;
  return ACCIONES.find((accion) => clave_atajo(atajos[accion]) === clave_atajo(pulsado)) ?? null;
}

export function atajo_en_conflicto(atajos: AtajosLectura, accion: AccionAtajo, candidato: AtajoTeclado): AccionAtajo | null {
  return ACCIONES.find((actual) => actual !== accion && clave_atajo(atajos[actual]) === clave_atajo(candidato)) ?? null;
}

export function describir_atajo(atajo: AtajoTeclado): string {
  const teclas = [atajo.meta ? "⌘" : "", atajo.alt ? "⌥" : "", atajo.shift ? "⇧" : "", atajo.code.replace(/^Key/u, "").replace(/^Digit/u, "").replace("Space", "Espacio")];
  return teclas.filter(Boolean).join(" ");
}
