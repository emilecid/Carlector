import type { CarpetaBiblioteca, DocumentoBiblioteca, FragmentoGuardado, NotaDocumento, PerfilLectura, TemaInterfaz } from "../core/modelos";
import { PERFIL_PREDETERMINADO, normalizar_perfil } from "../core/perfiles";
import type { SesionDivision, SesionPestanas } from "../core/pestanas.ts";

const CLAVE_DOCUMENTOS = "lector.documentos.v1";
const CLAVE_PERFIL = "lector.perfil.v1";
const CLAVE_CARPETAS = "carlector.carpetas.v1";
const CLAVE_FRAGMENTOS = "carlector.fragmentos.v1";
const CLAVE_NOTAS = "carlector.notas.v1";
const CLAVE_DESTACADOS = "carlector.fragmentos_destacados.v1";
const CLAVE_TEMAS_PERSONALIZADOS = "carlector.temas_personalizados.v1";
const CLAVE_REPOSITORIOS_VOZ = "carlector.repositorios_voz.v1";
const CLAVE_INFORMES_ERROR = "carlector.informes_error.v1";
const CLAVE_PESTANAS = "carlector.pestanas.v1";
const CLAVE_DIVISION = "carlector.division.v1";
const CLAVE_MINIATURAS_PDF = "carlector.miniaturas_pdf.v1";

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
  notas(): NotaDocumento[] {
    return leerJson<NotaDocumento[]>(CLAVE_NOTAS, []);
  },
  guardarNotas(notas: NotaDocumento[]): void {
    localStorage.setItem(CLAVE_NOTAS, JSON.stringify(notas));
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
  informesError(): boolean {
    return leerJson<boolean>(CLAVE_INFORMES_ERROR, true);
  },
  guardarInformesError(habilitados: boolean): void {
    localStorage.setItem(CLAVE_INFORMES_ERROR, JSON.stringify(habilitados));
  },
  pestanas(): SesionPestanas {
    return leerJson<SesionPestanas>(CLAVE_PESTANAS, { abiertas: [], activa: null });
  },
  guardarPestanas(sesion: SesionPestanas): void {
    localStorage.setItem(CLAVE_PESTANAS, JSON.stringify(sesion));
  },
  division(): SesionDivision {
    return leerJson<SesionDivision>(CLAVE_DIVISION, { documentos: [], proporciones: [100], orientacion: "horizontal" });
  },
  guardarDivision(sesion: SesionDivision): void {
    localStorage.setItem(CLAVE_DIVISION, JSON.stringify(sesion));
  },
  miniaturasPdf(): boolean {
    return leerJson<boolean>(CLAVE_MINIATURAS_PDF, true);
  },
  guardarMiniaturasPdf(visibles: boolean): void {
    localStorage.setItem(CLAVE_MINIATURAS_PDF, JSON.stringify(visibles));
  },
  perfil(): PerfilLectura {
    return normalizar_perfil(leerJson<Partial<PerfilLectura>>(CLAVE_PERFIL, PERFIL_PREDETERMINADO));
  },
  guardarPerfil(perfil: PerfilLectura): void {
    localStorage.setItem(CLAVE_PERFIL, JSON.stringify(normalizar_perfil(perfil)));
  },
};
