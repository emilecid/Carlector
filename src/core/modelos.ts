export type PoliticaMatematica = "leer" | "omitir" | "indicar";
export type TipoFragmento = "texto" | "matematica" | "tabla";
export type EstructuraDocumento = "parrafo" | "titulo" | "lista" | "cita" | "referencia" | "nota_pie" | "encabezado" | "pie_pagina" | "preformateado" | "tabla" | "matematica";

export interface FragmentoLectura {
  id: string;
  visible: string;
  locucion: string | null;
  tipo: TipoFragmento;
  pagina?: number;
  bloque_id?: string;
  estructura?: EstructuraDocumento;
  nivel?: number;
  tamano_relativo?: number;
  alineacion?: "left" | "center" | "right" | "justify";
  inicio_bloque?: boolean;
  fin_bloque?: boolean;
  salto_linea_antes?: boolean;
  ancla?: { bloque_id: string; inicio: number; fin: number };
}

export interface DocumentoBiblioteca {
  id: string;
  titulo: string;
  autor: string;
  formato: "PDF" | "EPUB" | "MARKDOWN";
  ruta: string;
  progreso: number;
  etiquetas: string[];
  ultima_lectura: string | null;
  carpeta_id?: string | null;
  orden?: number;
  estado_lectura?: EstadoLecturaDocumento | null;
}

export interface EstadoLecturaDocumento {
  indice_fragmento: number;
  pagina: number;
  indice_unidad: number;
  desplazamiento: number;
  modo_visual_pdf: "texto" | "original" | "doble";
  componentes: { biblioteca: boolean; inspector: boolean; controles: boolean };
}

export interface CarpetaBiblioteca {
  id: string;
  nombre: string;
  orden: number;
}

export interface EntradaIndice {
  titulo: string;
  nivel: number;
  texto_objetivo: string;
}

export interface FragmentoGuardado {
  id: string;
  documento_id: string;
  texto: string;
  indice_fragmento: number;
  creado: string;
  destacado?: boolean;
  ancla?: { bloque_id: string; inicio: number; fin: number };
}

export interface NotaDocumento {
  id: string;
  documento_id: string;
  texto: string;
  creado: string;
  fragmento_id?: string | null;
  pagina?: number | null;
  ancla?: { bloque_id: string; inicio: number; fin: number } | null;
}

export interface ColoresInterfaz {
  fondo: string;
  superficie: string;
  panel: string;
  borde: string;
  texto: string;
  atenuado: string;
  acento: string;
  resaltado: string;
}

export interface TemaInterfaz {
  id: string;
  nombre: string;
  categoria: string;
  tema: "claro" | "oscuro";
  colores: ColoresInterfaz;
  personalizado?: boolean;
}

export interface PerfilLectura {
  id: string;
  nombre: string;
  tema: "claro" | "oscuro";
  fuente: string;
  tamano_fuente: number;
  interlineado: number;
  ancho_lectura: number;
  velocidad: number;
  auto_scroll: boolean;
  modo_enfoque: boolean;
  politica_matematica: PoliticaMatematica;
  saltar_citas: boolean;
  modo_lectura: "continua" | "rsvp";
  unidad_rsvp: "palabra" | "frase";
  palabras_por_minuto: number;
  voz_habilitada: boolean;
  motor_voz: "sistema" | "kokoro_onnx";
  idioma_voz: string;
  voz_base: string;
  componentes: { biblioteca: boolean; inspector: boolean; controles: boolean };
  atajos: AtajosLectura;
  colores: ColoresInterfaz;
}

export interface AtajoTeclado {
  code: string;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface AtajosLectura {
  buscar: AtajoTeclado;
  reproducir: AtajoTeclado;
  anterior: AtajoTeclado;
  siguiente: AtajoTeclado;
  modo_enfoque: AtajoTeclado;
  alternar_pdf: AtajoTeclado;
}
