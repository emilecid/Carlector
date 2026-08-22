import type { PaqueteVozRepositorio, RepositorioVoz } from "./repositorios_voz.ts";

export interface ControlPaqueteVoz {
  accion: "ninguna" | "vincular_kokoro";
  etiqueta: string;
  habilitado: boolean;
  estado: string;
}

export function resolver_control_paquete_voz(
  repositorio: RepositorioVoz,
  paquete: PaqueteVozRepositorio,
  kokoro_instalado: boolean,
): ControlPaqueteVoz {
  if (repositorio.motor === "sistema") {
    return { accion: "ninguna", etiqueta: "", habilitado: false, estado: "" };
  }
  if (repositorio.motor === "kokoro_onnx") {
    return {
      accion: "vincular_kokoro",
      etiqueta: kokoro_instalado ? "Reparar o revincular" : "Vincular modelo y voces",
      habilitado: repositorio.activo && paquete.instalable,
      estado: kokoro_instalado ? "" : "Faltan archivos del modelo",
    };
  }
  return { accion: "ninguna", etiqueta: "Próximamente", habilitado: false, estado: "Integración pendiente" };
}
