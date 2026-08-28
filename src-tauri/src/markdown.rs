use std::path::Path;

use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::Serialize;

const VERSION_CACHE_DOCUMENTO: u32 = 6;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BloqueMarkdown {
    pub id: String,
    pub contenido: String,
    pub tipo: String,
    pub estructura: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nivel: Option<u8>,
    pub inicio_fuente: usize,
    pub fin_fuente: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EntradaIndiceMarkdown {
    pub titulo: String,
    pub nivel: u8,
    pub texto_objetivo: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DocumentoMarkdown {
    pub titulo: String,
    pub autor: String,
    pub idioma: String,
    pub formato: String,
    pub bloques: Vec<BloqueMarkdown>,
    pub indice: Vec<EntradaIndiceMarkdown>,
    pub version_cache: u32,
}

struct BloqueEnConstruccion {
    contenido: String,
    tipo: &'static str,
    estructura: &'static str,
    nivel: Option<u8>,
    fin_esperado: TagEnd,
    inicio_fuente: usize,
    fin_fuente: usize,
}

fn nivel_encabezado(nivel: HeadingLevel) -> u8 {
    match nivel {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn terminar_bloque(
    actual: &mut Option<BloqueEnConstruccion>,
    bloques: &mut Vec<BloqueMarkdown>,
    indice: &mut Vec<EntradaIndiceMarkdown>,
) {
    let Some(construido) = actual.take() else { return };
    let contenido = construido.contenido.trim().to_string();
    if contenido.is_empty() || construido.inicio_fuente >= construido.fin_fuente { return; }
    let id = format!("markdown-bloque-{}", bloques.len());
    if construido.estructura == "titulo" {
        let nivel = construido.nivel.unwrap_or(1);
        indice.push(EntradaIndiceMarkdown { titulo: contenido.clone(), nivel, texto_objetivo: contenido.clone() });
    }
    bloques.push(BloqueMarkdown {
        id,
        contenido,
        tipo: construido.tipo.to_string(),
        estructura: construido.estructura.to_string(),
        nivel: construido.nivel,
        inicio_fuente: construido.inicio_fuente,
        fin_fuente: construido.fin_fuente,
    });
}

pub fn extraer_markdown(fuente: &str, nombre_archivo: &str) -> DocumentoMarkdown {
    let mut opciones = Options::empty();
    opciones.insert(Options::ENABLE_TABLES);
    opciones.insert(Options::ENABLE_FOOTNOTES);
    opciones.insert(Options::ENABLE_STRIKETHROUGH);
    opciones.insert(Options::ENABLE_TASKLISTS);
    opciones.insert(Options::ENABLE_MATH);
    let eventos = Parser::new_ext(fuente, opciones).into_offset_iter();
    let mut bloques = Vec::new();
    let mut indice = Vec::new();
    let mut actual: Option<BloqueEnConstruccion> = None;
    let mut profundidad_lista = 0_u32;
    let mut profundidad_cita = 0_u32;
    let mut profundidad_nota = 0_u32;

    for (evento, rango) in eventos {
        match evento {
            Event::Start(etiqueta) => {
                match &etiqueta {
                    Tag::BlockQuote(_) => profundidad_cita += 1,
                    Tag::List(_) => profundidad_lista += 1,
                    Tag::FootnoteDefinition(_) => profundidad_nota += 1,
                    Tag::Heading { level, .. } if actual.is_none() => {
                        actual = Some(BloqueEnConstruccion { contenido: String::new(), tipo: "texto", estructura: "titulo", nivel: Some(nivel_encabezado(*level)), fin_esperado: etiqueta.to_end(), inicio_fuente: rango.start, fin_fuente: rango.end });
                    }
                    Tag::Paragraph if actual.is_none() => {
                        let estructura = if profundidad_nota > 0 { "nota_pie" } else if profundidad_cita > 0 { "cita" } else if profundidad_lista > 0 { "lista" } else { "parrafo" };
                        actual = Some(BloqueEnConstruccion { contenido: String::new(), tipo: "texto", estructura, nivel: None, fin_esperado: etiqueta.to_end(), inicio_fuente: rango.start, fin_fuente: rango.end });
                    }
                    Tag::CodeBlock(_) if actual.is_none() => {
                        actual = Some(BloqueEnConstruccion { contenido: String::new(), tipo: "texto", estructura: "preformateado", nivel: None, fin_esperado: etiqueta.to_end(), inicio_fuente: rango.start, fin_fuente: rango.end });
                    }
                    Tag::Table(_) if actual.is_none() => {
                        actual = Some(BloqueEnConstruccion { contenido: String::new(), tipo: "tabla", estructura: "tabla", nivel: None, fin_esperado: etiqueta.to_end(), inicio_fuente: rango.start, fin_fuente: rango.end });
                    }
                    _ => {}
                }
                if let Some(bloque) = actual.as_mut() { bloque.fin_fuente = rango.end; }
            }
            Event::End(fin) => {
                if let Some(bloque) = actual.as_mut() {
                    bloque.fin_fuente = rango.end;
                    if fin == TagEnd::TableCell && !bloque.contenido.ends_with(" · ") { bloque.contenido.push_str(" · "); }
                    if fin == TagEnd::TableRow { bloque.contenido.push('\n'); }
                }
                let termina_actual = actual.as_ref().is_some_and(|bloque| bloque.fin_esperado == fin);
                if termina_actual { terminar_bloque(&mut actual, &mut bloques, &mut indice); }
                match fin {
                    TagEnd::BlockQuote(_) => profundidad_cita = profundidad_cita.saturating_sub(1),
                    TagEnd::List(_) => profundidad_lista = profundidad_lista.saturating_sub(1),
                    TagEnd::FootnoteDefinition => profundidad_nota = profundidad_nota.saturating_sub(1),
                    _ => {}
                }
            }
            Event::Text(texto) | Event::Code(texto) => {
                if let Some(bloque) = actual.as_mut() {
                    bloque.contenido.push_str(&texto);
                    bloque.fin_fuente = rango.end;
                }
            }
            Event::InlineMath(matematica) => {
                if let Some(bloque) = actual.as_mut() {
                    bloque.contenido.push('$');
                    bloque.contenido.push_str(&matematica);
                    bloque.contenido.push('$');
                    bloque.fin_fuente = rango.end;
                }
            }
            Event::DisplayMath(matematica) => {
                if actual.as_ref().is_some_and(|bloque| bloque.contenido.trim().is_empty()) {
                    if let Some(bloque) = actual.as_mut() {
                        bloque.tipo = "matematica";
                        bloque.estructura = "matematica";
                        bloque.contenido.push_str(&matematica);
                        bloque.fin_fuente = rango.end;
                    }
                } else if actual.is_none() {
                    bloques.push(BloqueMarkdown { id: format!("markdown-bloque-{}", bloques.len()), contenido: matematica.into_string(), tipo: "matematica".to_string(), estructura: "matematica".to_string(), nivel: None, inicio_fuente: rango.start, fin_fuente: rango.end });
                }
            }
            Event::SoftBreak => {
                if let Some(bloque) = actual.as_mut() { bloque.contenido.push(' '); bloque.fin_fuente = rango.end; }
            }
            Event::HardBreak => {
                if let Some(bloque) = actual.as_mut() { bloque.contenido.push('\n'); bloque.fin_fuente = rango.end; }
            }
            Event::FootnoteReference(nombre) => {
                if let Some(bloque) = actual.as_mut() { bloque.contenido.push_str(&format!("[{nombre}]")); bloque.fin_fuente = rango.end; }
            }
            Event::TaskListMarker(marcada) => {
                if let Some(bloque) = actual.as_mut() { bloque.contenido.push_str(if marcada { "[x] " } else { "[ ] " }); bloque.fin_fuente = rango.end; }
            }
            Event::Html(_) | Event::InlineHtml(_) => {}
            _ => {}
        }
    }
    terminar_bloque(&mut actual, &mut bloques, &mut indice);
    let titulo = indice.first().map(|entrada| entrada.titulo.clone()).unwrap_or_else(|| {
        Path::new(nombre_archivo).file_stem().and_then(|nombre| nombre.to_str()).filter(|nombre| !nombre.trim().is_empty()).unwrap_or("Documento Markdown").to_string()
    });
    DocumentoMarkdown { titulo, autor: "Autor desconocido".to_string(), idioma: String::new(), formato: "MARKDOWN".to_string(), bloques, indice, version_cache: VERSION_CACHE_DOCUMENTO }
}
