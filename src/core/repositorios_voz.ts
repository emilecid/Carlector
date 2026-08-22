export type TipoMotorVoz = "sistema" | "kokoro_onnx" | "piper";

export interface PaqueteVozRepositorio {
  id: string;
  nombre: string;
  version: string;
  tamano_bytes: number;
  idiomas: string[];
  variante?: string;
  licencia?: string;
  hash?: { algoritmo: "sha256" | "md5"; valor: string };
  instalable: boolean;
  origen_instalacion?: "remoto" | "archivos_locales";
}

export interface RepositorioVoz {
  id: string;
  nombre: string;
  motor: TipoMotorVoz;
  descripcion: string;
  url_indice: string | null;
  url_proyecto: string | null;
  licencia: string;
  activo: boolean;
  oficial: boolean;
  paquetes: PaqueteVozRepositorio[];
}

export interface ResultadoValidacionRepositorio {
  valido: boolean;
  errores: string[];
}

export const REPOSITORIOS_VOZ_INTEGRADOS: RepositorioVoz[] = [
  {
    id: "sistema-local", nombre: "Voces del sistema", motor: "sistema", descripcion: "Voces ya instaladas en macOS o Linux; no requiere descarga.",
    url_indice: null, url_proyecto: null, licencia: "Provista por el sistema operativo", activo: true, oficial: true,
    paquetes: [{ id: "sistema", nombre: "Motor del sistema", version: "local", tamano_bytes: 0, idiomas: ["según sistema"], instalable: true }],
  },
  {
    id: "kokoro-onnx-oficial", nombre: "Kokoro ONNX", motor: "kokoro_onnx", descripcion: "Modelo Kokoro 1.0 optimizado para ONNX Runtime. Fuente principal prevista para Carlector.",
    url_indice: "https://api.github.com/repos/thewh1teagle/kokoro-onnx/releases/tags/model-files-v1.0", url_proyecto: "https://github.com/thewh1teagle/kokoro-onnx", licencia: "MIT (adaptador) · Apache-2.0 (modelo)", activo: true, oficial: true,
    paquetes: [{ id: "kokoro-v1-int8", nombre: "Kokoro 1.0 ONNX + voces", version: "1.0", tamano_bytes: 120_575_669, idiomas: ["inglés verificado"], variante: "CPU · archivos locales", licencia: "Apache-2.0", instalable: true, origen_instalacion: "archivos_locales" }],
  },
  {
    id: "piper-voces", nombre: "Piper Voices", motor: "piper", descripcion: "Catálogo comunitario de voces ONNX. El motor se integrará detrás del mismo contrato modular.",
    url_indice: "https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json", url_proyecto: "https://github.com/rhasspy/piper", licencia: "MIT en catálogo histórico; revisar MODEL_CARD por voz", activo: false, oficial: false,
    paquetes: [
      { id: "es_AR-daniela-high", nombre: "Daniela", version: "1.0.0", tamano_bytes: 114_206_259, idiomas: ["es-AR"], variante: "alta", licencia: "Consultar MODEL_CARD", hash: { algoritmo: "md5", valor: "e373fb657c93877dbc438badeadff4cb" }, instalable: false },
      { id: "es_ES-davefx-medium", nombre: "DaveFX", version: "1.0.0", tamano_bytes: 63_206_111, idiomas: ["es-ES"], variante: "media", licencia: "Consultar MODEL_CARD", hash: { algoritmo: "md5", valor: "dc515cd4ecc5f6f72fe14a941188fc9c" }, instalable: false },
    ],
  },
];

export function validar_repositorio_voz(repositorio: RepositorioVoz): ResultadoValidacionRepositorio {
  const errores: string[] = [];
  if (!repositorio.id.trim() || !repositorio.nombre.trim()) errores.push("Repositorio sin identidad.");
  if (repositorio.url_indice && !repositorio.url_indice.startsWith("https://")) errores.push("El índice remoto debe usar HTTPS.");
  for (const paquete of repositorio.paquetes) {
    if (!paquete.id.trim() || !paquete.nombre.trim() || !paquete.version.trim()) errores.push("Paquete sin identidad o versión.");
    if (!Number.isFinite(paquete.tamano_bytes) || paquete.tamano_bytes < 0) errores.push("Tamaño de paquete inválido.");
    if (!paquete.idiomas.length) errores.push("Paquete sin idioma declarado.");
    if (paquete.instalable && paquete.origen_instalacion !== "archivos_locales" && repositorio.motor !== "sistema" && paquete.hash?.algoritmo !== "sha256") errores.push("Paquete remoto instalable sin SHA-256.");
  }
  return { valido: errores.length === 0, errores };
}

export function combinar_estado_repositorios(estados: Record<string, boolean>): RepositorioVoz[] {
  return REPOSITORIOS_VOZ_INTEGRADOS.map((repositorio) => ({ ...repositorio, activo: estados[repositorio.id] ?? repositorio.activo }));
}
