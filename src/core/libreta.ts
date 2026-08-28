import type { DocumentoBiblioteca, FragmentoGuardado, NotaDocumento } from "./modelos.ts";

export interface EntradaExportacionLibreta {
  fragmento: FragmentoGuardado;
  pagina: number | null;
  notas: NotaDocumento[];
}

export interface ExportacionLibreta {
  titulo: string;
  autor: string;
  fecha: string;
  entradas: EntradaExportacionLibreta[];
  notas_generales: NotaDocumento[];
}

function escapar_html(valor: string): string {
  const reemplazos: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  };
  return valor.replace(/[&<>'"]/g, (caracter) => reemplazos[caracter] ?? caracter);
}

function texto_con_saltos(valor: string): string {
  return escapar_html(valor).replace(/\r?\n/g, "<br>");
}

export function crear_exportacion_libreta(
  documento: DocumentoBiblioteca,
  fragmentos: readonly FragmentoGuardado[],
  notas: readonly NotaDocumento[],
  fecha: string,
): ExportacionLibreta {
  const fragmentos_documento = [...fragmentos
    .filter(({ documento_id }) => documento_id === documento.id)]
    .sort((primero, segundo) => primero.indice_fragmento - segundo.indice_fragmento || primero.creado.localeCompare(segundo.creado));
  const ids_fragmentos = new Set(fragmentos_documento.map(({ id }) => id));
  const notas_documento = [...notas
    .filter(({ documento_id }) => documento_id === documento.id)]
    .sort((primera, segunda) => primera.creado.localeCompare(segunda.creado));

  return {
    titulo: documento.titulo,
    autor: documento.autor,
    fecha,
    entradas: fragmentos_documento.map((fragmento) => {
      const notas_fragmento = notas_documento.filter(({ fragmento_id }) => fragmento_id === fragmento.id);
      return {
        fragmento,
        pagina: notas_fragmento.find(({ pagina }) => typeof pagina === "number")?.pagina ?? null,
        notas: notas_fragmento,
      };
    }),
    notas_generales: notas_documento.filter(({ fragmento_id }) => !fragmento_id || !ids_fragmentos.has(fragmento_id)),
  };
}

export function crear_html_exportacion_libreta(exportacion: ExportacionLibreta): string {
  const fecha = Number.isNaN(Date.parse(exportacion.fecha))
    ? exportacion.fecha
    : new Intl.DateTimeFormat("es-CL", { dateStyle: "long" }).format(new Date(exportacion.fecha));
  const entradas = exportacion.entradas.map(({ fragmento, pagina, notas }, indice) => `
    <section class="entrada-exportacion-libreta">
      <header class="cabecera-entrada-exportacion">
        <h2>Fragmento ${indice + 1}</h2>
        ${pagina === null ? "" : `<span>Página ${pagina}</span>`}
      </header>
      <blockquote>${texto_con_saltos(fragmento.texto)}</blockquote>
      <div class="notas-exportacion-libreta">
        <h3>Notas</h3>
        ${notas.length
          ? notas.map(({ texto }) => `<p>${texto_con_saltos(texto)}</p>`).join("")
          : '<p class="sin-notas-exportacion">Sin notas asociadas.</p>'}
      </div>
    </section>`).join("");
  const notas_generales = exportacion.notas_generales.length
    ? `<section class="notas-generales-exportacion"><h2>Notas generales</h2>${exportacion.notas_generales.map(({ texto }) => `<p>${texto_con_saltos(texto)}</p>`).join("")}</section>`
    : "";

  return `<article class="documento-exportacion-libreta" lang="es">
    <header class="portada-exportacion-libreta">
      <span>Carlector · Libreta</span>
      <h1>${escapar_html(exportacion.titulo)}</h1>
      <p>${escapar_html(exportacion.autor || "Autor desconocido")}</p>
      <time>${escapar_html(fecha)}</time>
    </header>
    ${entradas || '<p class="sin-contenido-exportacion">No hay fragmentos guardados.</p>'}
    ${notas_generales}
  </article>`;
}
