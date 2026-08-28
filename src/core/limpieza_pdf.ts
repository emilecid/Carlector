export interface LineaMarginalPdf {
  id: string;
  pagina: number;
  texto: string;
  posicion_y: number;
  alto_pagina: number;
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
