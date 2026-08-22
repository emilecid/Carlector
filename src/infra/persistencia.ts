import type { CarpetaBiblioteca, DocumentoBiblioteca, FragmentoGuardado, PerfilLectura, TemaInterfaz } from "../core/modelos";
import { PERFIL_PREDETERMINADO, normalizar_perfil } from "../core/perfiles";

const CLAVE_DOCUMENTOS = "lector.documentos.v1";
const CLAVE_PERFIL = "lector.perfil.v1";
const CLAVE_CARPETAS = "carlector.carpetas.v1";
const CLAVE_FRAGMENTOS = "carlector.fragmentos.v1";
const CLAVE_DESTACADOS = "carlector.fragmentos_destacados.v1";
const CLAVE_TEMAS_PERSONALIZADOS = "carlector.temas_personalizados.v1";
const CLAVE_REPOSITORIOS_VOZ = "carlector.repositorios_voz.v1";

function leerJson<T>(clave: string, alternativa: T): T {
  try {
    const valor = localStorage.getItem(clave);
    return valor ? JSON.parse(valor) as T : alternativa;
  } catch {
    return alternativa;
  }
}

export const persistencia = {
  documentos(): DocumentoBiblioteca[] {
    return leerJson<DocumentoBiblioteca[]>(CLAVE_DOCUMENTOS, []);
  },
  guardarDocumentos(documentos: DocumentoBiblioteca[]): void {
    localStorage.setItem(CLAVE_DOCUMENTOS, JSON.stringify(documentos));
  },
  carpetas(): CarpetaBiblioteca[] {
    return leerJson<CarpetaBiblioteca[]>(CLAVE_CARPETAS, []);
  },
  guardarCarpetas(carpetas: CarpetaBiblioteca[]): void {
    localStorage.setItem(CLAVE_CARPETAS, JSON.stringify(carpetas));
  },
  fragmentos(): FragmentoGuardado[] {
    return leerJson<FragmentoGuardado[]>(CLAVE_FRAGMENTOS, []);
  },
  guardarFragmentos(fragmentos: FragmentoGuardado[]): void {
    localStorage.setItem(CLAVE_FRAGMENTOS, JSON.stringify(fragmentos));
  },
  fragmentosDestacados(): boolean {
    return leerJson<boolean>(CLAVE_DESTACADOS, true);
  },
  guardarFragmentosDestacados(destacados: boolean): void {
    localStorage.setItem(CLAVE_DESTACADOS, JSON.stringify(destacados));
  },
  temasPersonalizados(): TemaInterfaz[] {
    return leerJson<TemaInterfaz[]>(CLAVE_TEMAS_PERSONALIZADOS, []);
  },
  guardarTemasPersonalizados(temas: TemaInterfaz[]): void {
    localStorage.setItem(CLAVE_TEMAS_PERSONALIZADOS, JSON.stringify(temas));
  },
  repositoriosVoz(): Record<string, boolean> {
    return leerJson<Record<string, boolean>>(CLAVE_REPOSITORIOS_VOZ, {});
  },
  guardarRepositoriosVoz(estados: Record<string, boolean>): void {
    localStorage.setItem(CLAVE_REPOSITORIOS_VOZ, JSON.stringify(estados));
  },
  perfil(): PerfilLectura {
    return normalizar_perfil(leerJson<Partial<PerfilLectura>>(CLAVE_PERFIL, PERFIL_PREDETERMINADO));
  },
  guardarPerfil(perfil: PerfilLectura): void {
    localStorage.setItem(CLAVE_PERFIL, JSON.stringify(normalizar_perfil(perfil)));
  },
};
