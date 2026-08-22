export interface OpcionVoz { id: string; nombre: string }

export const VOCES_KOKORO: Record<string, OpcionVoz[]> = {
  "es": [{ id: "ef_dora", nombre: "Dora" }, { id: "em_alex", nombre: "Alex" }, { id: "em_santa", nombre: "Santa" }],
  "en-us": [{ id: "af_heart", nombre: "Heart" }, { id: "af_bella", nombre: "Bella" }, { id: "am_michael", nombre: "Michael" }],
  "en-gb": [{ id: "bf_emma", nombre: "Emma" }, { id: "bm_george", nombre: "George" }],
};

export function normalizar_configuracion_kokoro(idioma: string, voz: string): { idioma: string; voz: string } {
  const codigo = idioma.toLocaleLowerCase("es").startsWith("es") ? "es" : idioma.toLocaleLowerCase("es") === "en-gb" ? "en-gb" : "en-us";
  const voces = VOCES_KOKORO[codigo]!;
  return { idioma: codigo, voz: voces.some(({ id }) => id === voz) ? voz : voces[0]!.id };
}

export function mostrar_configuracion_kokoro(motor: string): boolean {
  return motor === "kokoro_onnx";
}
