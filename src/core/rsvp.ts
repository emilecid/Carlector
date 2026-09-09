import { segmentar_palabras_lectura } from "./segmentacion.ts";

export interface VentanaRsvpVisual {
  texto: string;
  inicio: number;
  fin: number;
}

export function crear_ventanas_rsvp_visual(texto: string, maximo_palabras: number): VentanaRsvpVisual[] {
  if (!Number.isInteger(maximo_palabras) || maximo_palabras < 1) {
    throw new RangeError("El máximo de palabras RSVP visibles debe ser un entero positivo.");
  }
  const palabras = segmentar_palabras_lectura(texto);
  const ventanas: VentanaRsvpVisual[] = [];
  for (let inicio = 0; inicio < palabras.length; inicio += maximo_palabras) {
    const grupo = palabras.slice(inicio, inicio + maximo_palabras);
    const primera = grupo[0];
    const ultima = grupo.at(-1);
    if (!primera || !ultima) continue;
    ventanas.push({ texto: grupo.map(({ texto: palabra }) => palabra).join(" "), inicio: primera.inicio, fin: ultima.fin });
  }
  return ventanas;
}

export function indice_ventana_rsvp_por_caracter(ventanas: VentanaRsvpVisual[], posicion: number): number {
  let indice = 0;
  for (let actual = 0; actual < ventanas.length; actual += 1) {
    if (posicion < (ventanas[actual]?.inicio ?? 0)) break;
    indice = actual;
  }
  return indice;
}
