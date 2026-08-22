export interface RectanguloAncla { izquierda: number; superior: number; derecha: number; inferior: number }
export interface Tamano { ancho: number; alto: number }
export type EjecutorDiferido<Argumentos extends unknown[]> = ((...argumentos: Argumentos) => void) & { cancelar: () => void };

export function calcular_posicion_superpuesta(
  ancla: RectanguloAncla,
  superposicion: Tamano,
  ventana: Tamano,
  separacion = 8,
): { izquierda: number; superior: number } {
  const izquierda_maxima = Math.max(separacion, ventana.ancho - superposicion.ancho - separacion);
  const izquierda = Math.min(Math.max(separacion, ancla.izquierda), izquierda_maxima);
  const cabe_abajo = ancla.inferior + separacion + superposicion.alto <= ventana.alto - separacion;
  const superior_propuesta = cabe_abajo ? ancla.inferior + separacion : ancla.superior - separacion - superposicion.alto;
  const superior_maxima = Math.max(separacion, ventana.alto - superposicion.alto - separacion);
  return { izquierda, superior: Math.min(Math.max(separacion, superior_propuesta), superior_maxima) };
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
