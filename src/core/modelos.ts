export type PoliticaMatematica = "leer" | "omitir" | "indicar";
export type TipoFragmento = "texto" | "matematica" | "tabla";
export type EstructuraDocumento = "parrafo" | "titulo" | "lista" | "cita" | "referencia" | "preformateado" | "tabla" | "matematica";

export interface FragmentoLectura {
  id: string;
  visible: string;
  locucion: string | null;
  tipo: TipoFragmento;
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
  formato: "PDF" | "EPUB";
  ruta: string;
  progreso: number;
  etiquetas: string[];
  ultima_lectura: string | null;
  carpeta_id?: string | null;
  orden?: number;
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
  modo_lectura: "continua" | "rsvp";
  unidad_rsvp: "palabra" | "frase_corta";
  palabras_rsvp: number;
  palabras_por_minuto: number;
  estrategia_segmentacion: "cinco_palabras" | "puntuacion";
  maximo_palabras_segmento: number;
  voz_habilitada: boolean;
  motor_voz: "sistema" | "kokoro_onnx";
  idioma_voz: string;
  voz_base: string;
  componentes: { biblioteca: boolean; inspector: boolean; controles: boolean };
  colores: ColoresInterfaz;
}
