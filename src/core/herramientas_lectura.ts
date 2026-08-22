import type { FragmentoGuardado, FragmentoLectura } from "./modelos.ts";

export interface ContextoAtajoReproduccion {
  code: string;
  etiqueta_objetivo: string;
  editable?: boolean;
  repeticion?: boolean;
}

export function es_atajo_reproduccion(contexto: ContextoAtajoReproduccion): boolean {
  return contexto.code === "Space" && contexto.repeticion !== true;
}

export function resolver_destino_indice(fragmentos: FragmentoLectura[], texto_objetivo: string): number | null {
  const normalizado = texto_objetivo.trim().toLocaleLowerCase("es");
  if (!normalizado) return null;
  const palabras = normalizado.split(/\s+/u).slice(0, 5).join(" ");
  const indice = fragmentos.findIndex(({ visible }) => visible.toLocaleLowerCase("es").includes(palabras));
  return indice >= 0 ? indice : null;
}

export function fragmento_esta_destacado(fragmento: FragmentoGuardado): boolean {
  return fragmento.destacado !== false;
}

export function debe_guardar_progreso(ultimo_guardado: number, ahora: number, forzar: boolean, intervalo = 2_000): boolean {
  return forzar || ahora - ultimo_guardado >= intervalo;
}
