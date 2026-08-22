import type { FragmentoLectura } from "./modelos";

export interface CapacidadesMotorTts {
  velocidad: boolean;
  volumen: boolean;
  tono: boolean;
  pausas: boolean;
  expresividad: boolean;
  mezcla_voces: boolean;
}

export interface ConfiguracionVoz {
  velocidad?: number;
  volumen?: number;
  tono?: number;
  pausas?: number;
  expresividad?: number;
}

export interface MotorTts {
  readonly id: string;
  readonly capacidades: CapacidadesMotorTts;
  preparar(texto: string, configuracion: ConfiguracionVoz): Promise<ArrayBuffer>;
  detener(): Promise<void>;
}

const limites: Record<keyof ConfiguracionVoz, readonly [number, number]> = {
  velocidad: [0.5, 2],
  volumen: [0, 1],
  tono: [0.5, 2],
  pausas: [0, 3],
  expresividad: [0, 1],
};

export interface LocucionPlanificada {
  indice: number;
  texto: string;
}

export function planificar_locuciones(fragmentos: FragmentoLectura[], indice_inicial: number, limite = Number.POSITIVE_INFINITY): LocucionPlanificada[] {
  const resultado: LocucionPlanificada[] = [];
  for (let indice = Math.max(0, indice_inicial); indice < fragmentos.length && resultado.length < limite; indice += 1) {
    const texto = fragmentos[indice]?.locucion;
    if (texto) resultado.push({ indice, texto });
  }
  return resultado;
}

export function normalizar_configuracion_voz(
  configuracion: ConfiguracionVoz,
  capacidades: CapacidadesMotorTts,
): ConfiguracionVoz {
  const resultado: ConfiguracionVoz = {};
  for (const clave of Object.keys(limites) as Array<keyof ConfiguracionVoz>) {
    if (!capacidades[clave] || configuracion[clave] === undefined) continue;
    const [minimo, maximo] = limites[clave];
    resultado[clave] = Math.min(maximo, Math.max(minimo, configuracion[clave]));
  }
  return resultado;
}

export class ColaTts {
  private fragmentos: FragmentoLectura[] = [];
  private readonly anticipacion: number;

  constructor(anticipacion = 3) {
    if (!Number.isInteger(anticipacion) || anticipacion < 1) {
      throw new RangeError("La anticipación debe ser un entero positivo.");
    }
    this.anticipacion = anticipacion;
  }

  cargar(fragmentos: FragmentoLectura[]): void {
    this.fragmentos = [...fragmentos];
  }

  preparar_desde(indice: number): FragmentoLectura[] {
    return this.fragmentos.slice(Math.max(0, indice)).filter((fragmento) => fragmento.locucion).slice(0, this.anticipacion);
  }

  siguiente(indice: number): FragmentoLectura | null {
    return this.fragmentos.slice(indice + 1).find((fragmento) => fragmento.locucion) ?? null;
  }

  anterior(indice: number): FragmentoLectura | null {
    return this.fragmentos.slice(0, Math.max(0, indice)).reverse().find((fragmento) => fragmento.locucion) ?? null;
  }
}
