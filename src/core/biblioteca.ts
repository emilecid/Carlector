import type { DocumentoBiblioteca } from "./modelos.ts";

export type FiltroBiblioteca =
  | { tipo: "todos" }
  | { tipo: "en_progreso" }
  | { tipo: "carpeta"; carpeta_id: string };

export function agregar_documento(
  documentos: DocumentoBiblioteca[],
  documento_nuevo: DocumentoBiblioteca,
): DocumentoBiblioteca[] {
  const ruta_normalizada = documento_nuevo.ruta.trim();
  if (!ruta_normalizada || documentos.some((documento) => documento.ruta === ruta_normalizada)) {
    return documentos;
  }
  return [...documentos, { ...documento_nuevo, ruta: ruta_normalizada }];
}

export function filtrar_documentos(
  documentos: DocumentoBiblioteca[],
  filtro: FiltroBiblioteca,
): DocumentoBiblioteca[] {
  const ordenados = [...documentos].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  if (filtro.tipo === "en_progreso") {
    return ordenados.filter(({ progreso }) => progreso > 0 && progreso < 100);
  }
  if (filtro.tipo === "carpeta") {
    return ordenados.filter(({ carpeta_id }) => carpeta_id === filtro.carpeta_id);
  }
  return ordenados;
}

export function reordenar_documentos(
  documentos: DocumentoBiblioteca[],
  id_movido: string,
  id_destino: string,
): DocumentoBiblioteca[] {
  const ordenados = [...documentos].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const indice_movido = ordenados.findIndex(({ id }) => id === id_movido);
  const indice_destino = ordenados.findIndex(({ id }) => id === id_destino);
  if (indice_movido < 0 || indice_destino < 0 || indice_movido === indice_destino) return ordenados;
  const [movido] = ordenados.splice(indice_movido, 1);
  if (!movido) return ordenados;
  ordenados.splice(indice_destino, 0, movido);
  return ordenados.map((documento, orden) => ({ ...documento, orden }));
}

export function buscar_documentos(
  documentos: DocumentoBiblioteca[],
  consulta: string,
): DocumentoBiblioteca[] {
  const termino = consulta.trim().toLocaleLowerCase("es");
  if (!termino) return documentos;
  return documentos.filter((documento) =>
    [documento.titulo, documento.autor, documento.formato, ...documento.etiquetas]
      .join(" ")
      .toLocaleLowerCase("es")
      .includes(termino),
  );
}
