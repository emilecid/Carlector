export type TipoMotorVoz = "sistema" | "kokoro_onnx";

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
  descargas?: DescargaPaqueteVoz[];
}

export interface DescargaPaqueteVoz {
  id: "modelo" | "voces";
  nombre: string;
  url: string;
  tamano_bytes: number;
  sha256: string;
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
    id: "sistema-local", nombre: "Voces del sistema", motor: "sistema", descripcion: "",
    url_indice: null, url_proyecto: null, licencia: "Provista por el sistema operativo", activo: true, oficial: true,
    paquetes: [],
  },
  {
    id: "kokoro-onnx-oficial", nombre: "Kokoro ONNX", motor: "kokoro_onnx", descripcion: "",
    url_indice: "https://api.github.com/repos/thewh1teagle/kokoro-onnx/releases/tags/model-files-v1.0", url_proyecto: "https://github.com/thewh1teagle/kokoro-onnx", licencia: "MIT (adaptador) · Apache-2.0 (modelo)", activo: true, oficial: true,
    paquetes: [{
      id: "kokoro-v1", nombre: "Kokoro 1.0 ONNX + voces multilingües", version: "1.0", tamano_bytes: 353_746_785,
      idiomas: ["español", "inglés estadounidense", "inglés británico"], variante: "CPU · descarga oficial", licencia: "Apache-2.0",
      instalable: true, origen_instalacion: "archivos_locales",
      descargas: [
        { id: "modelo", nombre: "Descargar modelo ONNX", url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx", tamano_bytes: 325_532_387, sha256: "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5" },
        { id: "voces", nombre: "Descargar voces (incluye español)", url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin", tamano_bytes: 28_214_398, sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d" },
      ],
    }],
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
    for (const descarga of paquete.descargas ?? []) {
      if (!descarga.url.startsWith("https://") || !/^[a-f0-9]{64}$/u.test(descarga.sha256)) errores.push("Descarga remota insegura o sin SHA-256.");
    }
    if (paquete.instalable && paquete.origen_instalacion !== "archivos_locales" && repositorio.motor !== "sistema" && paquete.hash?.algoritmo !== "sha256") errores.push("Paquete remoto instalable sin SHA-256.");
  }
  return { valido: errores.length === 0, errores };
}

export function combinar_estado_repositorios(estados: Record<string, boolean>): RepositorioVoz[] {
  return REPOSITORIOS_VOZ_INTEGRADOS.map((repositorio) => ({ ...repositorio, activo: estados[repositorio.id] ?? repositorio.activo }));
}
