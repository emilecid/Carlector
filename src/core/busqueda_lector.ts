function normalizar_texto_busqueda(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

export function buscar_indices_texto(textos: readonly string[], consulta: string): number[] {
  const termino = normalizar_texto_busqueda(consulta.trim());
  if (!termino) return [];
  return textos.flatMap((texto, indice) => normalizar_texto_busqueda(texto).includes(termino) ? [indice] : []);
}
