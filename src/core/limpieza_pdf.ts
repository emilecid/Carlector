export interface LineaMarginalPdf {
  id: string;
  pagina: number;
  texto: string;
  posicion_y: number;
  alto_pagina: number;
}

export interface CambioNormalizacionPdf {
  original: string;
  normalizado: string;
  inicio_original: number;
  fin_original: number;
  inicio_normalizado: number;
  fin_normalizado: number;
}

export interface TextoNormalizadoPdf {
  original: string;
  texto: string;
  cambios: CambioNormalizacionPdf[];
}

const VOCALES_AGUDAS: Record<string, string> = {
  a: "á", e: "é", i: "í", o: "ó", u: "ú", ı: "í",
  A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", İ: "Í",
};
const VOCALES_DIERESIS: Record<string, string> = {
  a: "ä", e: "ë", i: "ï", o: "ö", u: "ü",
  A: "Ä", E: "Ë", I: "Ï", O: "Ö", U: "Ü",
};
const PATRON_ARTEFACTO_TEX = /´\s+([aeiouAEIOUıİ])|˜\s+([nN])|¨\s+([aeiouAEIOU])|([\p{L}]\p{M}+)/gu;

export function normalizar_texto_pdf(original: string): TextoNormalizadoPdf {
  let cursor_original = 0;
  let texto = "";
  const cambios: CambioNormalizacionPdf[] = [];
  for (const coincidencia of original.matchAll(PATRON_ARTEFACTO_TEX)) {
    const inicio_original = coincidencia.index ?? 0;
    texto += original.slice(cursor_original, inicio_original).normalize("NFC");
    const antes = coincidencia[0];
    const despues = coincidencia[1]
      ? VOCALES_AGUDAS[coincidencia[1]] ?? coincidencia[1]
      : coincidencia[2]
        ? coincidencia[2] === "N" ? "Ñ" : "ñ"
        : coincidencia[3]
          ? VOCALES_DIERESIS[coincidencia[3]] ?? coincidencia[3]
          : antes.normalize("NFC");
    const inicio_normalizado = texto.length;
    texto += despues;
    cambios.push({
      original: antes,
      normalizado: despues,
      inicio_original,
      fin_original: inicio_original + antes.length,
      inicio_normalizado,
      fin_normalizado: inicio_normalizado + despues.length,
    });
    cursor_original = inicio_original + antes.length;
  }
  texto += original.slice(cursor_original).normalize("NFC");
  return { original, texto, cambios };
}

function clave_linea_marginal(texto: string): string {
  return texto.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/\d+/gu, "#").replace(/\s+/gu, " ").trim();
}

export function detectar_lineas_marginales_repetidas(lineas: LineaMarginalPdf[]): Set<string> {
  const paginas = new Set(lineas.map(({ pagina }) => pagina));
  if (paginas.size < 2) return new Set();
  const grupos = new Map<string, LineaMarginalPdf[]>();
  for (const linea of lineas) {
    if (!Number.isFinite(linea.posicion_y) || !Number.isFinite(linea.alto_pagina) || linea.alto_pagina <= 0) continue;
    const proporcion = linea.posicion_y / linea.alto_pagina;
    if (proporcion > .12 && proporcion < .88 || linea.texto.length > 160) continue;
    const clave = clave_linea_marginal(linea.texto);
    if (!clave) continue;
    grupos.set(clave, [...(grupos.get(clave) ?? []), linea]);
  }
  const minimo_paginas = Math.min(3, Math.max(2, Math.ceil(paginas.size * .35)));
  const omitidas = new Set<string>();
  grupos.forEach((grupo) => {
    if (new Set(grupo.map(({ pagina }) => pagina)).size < minimo_paginas) return;
    grupo.forEach(({ id }) => omitidas.add(id));
  });
  return omitidas;
}
