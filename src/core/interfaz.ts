export interface RectanguloAncla { izquierda: number; superior: number; derecha: number; inferior: number }
export interface Tamano { ancho: number; alto: number }
export type AreaVisible = RectanguloAncla;
export type EjecutorDiferido<Argumentos extends unknown[]> = ((...argumentos: Argumentos) => void) & { cancelar: () => void };
export type VistaAplicacion = "biblioteca" | "lector";
export type PanelIzquierdo = "biblioteca" | "indice";

export function resolver_panel_izquierdo(vista: VistaAplicacion, documento_id: string | null): PanelIzquierdo {
  return vista === "lector" && documento_id ? "indice" : "biblioteca";
}

export function calcular_posicion_superpuesta(
  ancla: RectanguloAncla,
  superposicion: Tamano,
  area_visible: AreaVisible,
  separacion = 8,
): { izquierda: number; superior: number } {
  const izquierda_minima = area_visible.izquierda + separacion;
  const superior_minima = area_visible.superior + separacion;
  const izquierda_maxima = Math.max(izquierda_minima, area_visible.derecha - superposicion.ancho - separacion);
  const izquierda = Math.min(Math.max(izquierda_minima, ancla.izquierda), izquierda_maxima);
  const cabe_abajo = ancla.inferior + separacion + superposicion.alto <= area_visible.inferior - separacion;
  const superior_propuesta = cabe_abajo ? ancla.inferior + separacion : ancla.superior - separacion - superposicion.alto;
  const superior_maxima = Math.max(superior_minima, area_visible.inferior - superposicion.alto - separacion);
  return { izquierda, superior: Math.min(Math.max(superior_minima, superior_propuesta), superior_maxima) };
}

export function crear_ejecutor_diferido<Argumentos extends unknown[]>(
  tarea: (...argumentos: Argumentos) => void,
  espera_ms: number,
): EjecutorDiferido<Argumentos> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const ejecutar = (...argumentos: Argumentos): void => {
    if (temporizador !== undefined) clearTimeout(temporizador);
    temporizador = setTimeout(() => { temporizador = undefined; tarea(...argumentos); }, espera_ms);
  };
  ejecutar.cancelar = (): void => {
    if (temporizador !== undefined) clearTimeout(temporizador);
    temporizador = undefined;
  };
  return ejecutar;
}
