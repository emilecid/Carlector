import type { EstructuraDocumento } from "../core/modelos.ts";

export function clasificar_estructura_epub(etiqueta: string, tipo_epub: string): EstructuraDocumento {
  const nombre = etiqueta.toLocaleLowerCase("es");
  const semantica = tipo_epub.toLocaleLowerCase("es").split(/\s+/);
  if (semantica.some((tipo) => tipo === "footnote" || tipo === "endnote" || tipo === "rearnote")) return "referencia";
  if (nombre === "blockquote" || nombre === "cite" || nombre === "q") return "cita";
  if (nombre === "li") return "lista";
  if (nombre === "pre") return "preformateado";
  if (nombre === "table") return "tabla";
  if (/^h[1-6]$/.test(nombre)) return "titulo";
  return "parrafo";
}
