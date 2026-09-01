#[cfg(target_os = "macos")]
mod asociaciones;
#[cfg(not(target_os = "macos"))]
#[path = "asociaciones_no_disponibles.rs"]
mod asociaciones;
mod biblioteca;
#[cfg(target_os = "macos")]
mod kokoro;
#[cfg(not(target_os = "macos"))]
#[path = "kokoro_no_disponible.rs"]
mod kokoro;
pub mod markdown;
mod preferencias;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use biblioteca::{abrir_base_datos, descubrir_documentos_directorio, Carpeta, Documento, ErrorBiblioteca, EstadoLecturaDocumento, FragmentoGuardado, NotaDocumento, RepositorioBiblioteca};
use kokoro::{EstadoKokoro, MotorKokoro};
use markdown::DocumentoMarkdown;
#[cfg(target_os = "macos")]
use tauri::Emitter;
use tauri::{Manager, State};

struct EstadoAplicacion {
    biblioteca: Mutex<RepositorioBiblioteca>,
    directorio_biblioteca: PathBuf,
    kokoro: Arc<Mutex<MotorKokoro>>,
}

#[derive(Default)]
struct EstadoArchivosAbiertos {
    pendientes: Vec<String>,
    receptor_listo: bool,
}

struct ArchivosAbiertos(Mutex<EstadoArchivosAbiertos>);

#[tauri::command]
async fn estado_kokoro(estado: State<'_, EstadoAplicacion>) -> Result<EstadoKokoro, String> {
    estado.kokoro.lock().map_err(|_| "No fue posible bloquear Kokoro".to_string())?.estado()
}

#[tauri::command]
async fn instalar_kokoro(ruta_modelo: String, ruta_voces: String, estado: State<'_, EstadoAplicacion>) -> Result<EstadoKokoro, String> {
    let kokoro = Arc::clone(&estado.kokoro);
    tauri::async_runtime::spawn_blocking(move || {
        let mut motor = kokoro.lock().map_err(|_| "No fue posible bloquear Kokoro".to_string())?;
        tauri::async_runtime::block_on(motor.instalar(std::path::Path::new(&ruta_modelo), std::path::Path::new(&ruta_voces)))
    }).await.map_err(|error| format!("Falló la tarea de instalación Kokoro: {error}"))?
}

#[tauri::command]
async fn sintetizar_kokoro(texto: String, voz: Option<String>, velocidad: f32, idioma: Option<String>, estado: State<'_, EstadoAplicacion>) -> Result<Vec<u8>, String> {
    let kokoro = Arc::clone(&estado.kokoro);
    tauri::async_runtime::spawn_blocking(move || {
        let mut motor = kokoro.lock().map_err(|_| "No fue posible bloquear Kokoro".to_string())?;
        tauri::async_runtime::block_on(motor.sintetizar(&texto, voz.as_deref(), velocidad, idioma.as_deref()))
    }).await.map_err(|error| format!("Falló la tarea de síntesis Kokoro: {error}"))?
}

#[tauri::command]
fn listar_documentos(estado: State<'_, EstadoAplicacion>) -> Result<Vec<Documento>, String> {
    let biblioteca = estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?;
    biblioteca.listar_documentos().map_err(|error| error.to_string())
}

#[tauri::command]
fn importar_documento(ruta: String, estado: State<'_, EstadoAplicacion>) -> Result<Documento, String> {
    let biblioteca = estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?;
    biblioteca.importar_documento(&ruta).map_err(|error| error.to_string())
}

#[tauri::command]
fn guardar_progreso(id_documento: String, progreso: f64, estado_lectura: EstadoLecturaDocumento, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    let biblioteca = estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?;
    biblioteca.guardar_progreso(&id_documento, progreso, &estado_lectura).map_err(|error| error.to_string())
}

#[tauri::command]
fn leer_documento(id_documento: String, estado: State<'_, EstadoAplicacion>) -> Result<Vec<u8>, String> {
    let biblioteca = estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?;
    biblioteca.leer_documento(&id_documento).map_err(|error| error.to_string())
}

#[tauri::command]
fn extraer_markdown(texto: String, nombre_archivo: String) -> DocumentoMarkdown {
    markdown::extraer_markdown(&texto, &nombre_archivo)
}

#[tauri::command]
fn tomar_archivos_abiertos(estado: State<'_, ArchivosAbiertos>) -> Result<Vec<String>, String> {
    let mut archivos = estado.0.lock().map_err(|_| "No fue posible acceder a los archivos abiertos".to_string())?;
    archivos.receptor_listo = true;
    Ok(std::mem::take(&mut archivos.pendientes))
}

#[tauri::command]
fn listar_documentos_directorio(ruta: String) -> Result<Vec<String>, String> {
    descubrir_documentos_directorio(std::path::Path::new(&ruta)).map_err(|error| error.to_string())
}

#[tauri::command]
fn listar_carpetas(estado: State<'_, EstadoAplicacion>) -> Result<Vec<Carpeta>, String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.listar_carpetas().map_err(|error| error.to_string())
}

#[tauri::command]
fn crear_carpeta(nombre: String, estado: State<'_, EstadoAplicacion>) -> Result<Carpeta, String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.crear_carpeta(&nombre).map_err(|error| error.to_string())
}

#[tauri::command]
fn sincronizar_biblioteca(estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.sincronizar_biblioteca().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn abrir_directorio_en_finder(ruta: &Path) -> Result<(), String> {
    if !ruta.is_dir() {
        return Err(format!("La carpeta no existe: {}", ruta.display()));
    }
    let estado_apertura = std::process::Command::new("/usr/bin/open").arg(ruta).status();
    estado_apertura.map_err(|error| format!("No fue posible abrir la carpeta: {error}"))?.success().then_some(()).ok_or_else(|| "Finder no pudo abrir la carpeta".to_string())
}

#[cfg(not(target_os = "macos"))]
fn abrir_directorio_en_finder(_ruta: &Path) -> Result<(), String> {
    Err("Abrir Finder solo está disponible en macOS".to_string())
}

#[tauri::command]
fn abrir_biblioteca_en_finder(estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    abrir_directorio_en_finder(&estado.directorio_biblioteca)
}

#[tauri::command]
fn abrir_carpeta_en_finder(id: String, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    let ruta = estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.ruta_carpeta(&id).map_err(|error| error.to_string())?;
    abrir_directorio_en_finder(Path::new(&ruta))
}

#[tauri::command]
fn renombrar_carpeta(id: String, nombre: String, estado: State<'_, EstadoAplicacion>) -> Result<Carpeta, String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.renombrar_carpeta(&id, &nombre).map_err(|error| error.to_string())
}

#[tauri::command]
fn eliminar_carpeta(id: String, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.eliminar_carpeta(&id).map_err(|error| error.to_string())
}

#[tauri::command]
fn mover_documento(id_documento: String, carpeta_id: Option<String>, estado: State<'_, EstadoAplicacion>) -> Result<Documento, String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.mover_documento(&id_documento, carpeta_id.as_deref()).map_err(|error| error.to_string())
}

#[tauri::command]
fn renombrar_documento(id: String, nombre: String, estado: State<'_, EstadoAplicacion>) -> Result<Documento, String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.renombrar_documento(&id, &nombre).map_err(|error| error.to_string())
}

#[tauri::command]
fn editar_documento(id: String, titulo: String, autor: String, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.editar_documento(&id, &titulo, &autor).map_err(|error| error.to_string())
}

#[tauri::command]
fn reordenar_documentos(ids: Vec<String>, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.reordenar_documentos(&ids).map_err(|error| error.to_string())
}

#[tauri::command]
fn eliminar_documento(id: String, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.eliminar_documento(&id).map_err(|error| error.to_string())
}

#[tauri::command]
fn guardar_fragmento(fragmento: FragmentoGuardado, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.guardar_fragmento(&fragmento).map_err(|error| error.to_string())
}

#[tauri::command]
fn listar_fragmentos(documento_id: String, estado: State<'_, EstadoAplicacion>) -> Result<Vec<FragmentoGuardado>, String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.listar_fragmentos(&documento_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn eliminar_fragmento(id: String, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.eliminar_fragmento(&id).map_err(|error| error.to_string())
}

#[tauri::command]
fn cambiar_destacado_fragmento(id: String, destacado: bool, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.cambiar_destacado_fragmento(&id, destacado).map_err(|error| error.to_string())
}

#[tauri::command]
fn guardar_nota(nota: NotaDocumento, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.guardar_nota(&nota).map_err(|error| error.to_string())
}

#[tauri::command]
fn listar_notas(documento_id: String, estado: State<'_, EstadoAplicacion>) -> Result<Vec<NotaDocumento>, String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.listar_notas(&documento_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn eliminar_nota(id: String, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.eliminar_nota(&id).map_err(|error| error.to_string())
}

#[tauri::command]
fn guardar_cache_documento(documento_id: String, contenido: String, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.guardar_cache_documento(&documento_id, &contenido).map_err(|error| error.to_string())
}

#[tauri::command]
fn leer_cache_documento(documento_id: String, estado: State<'_, EstadoAplicacion>) -> Result<Option<String>, String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.leer_cache_documento(&documento_id).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn ejecutar() {
    let aplicacion = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ArchivosAbiertos(Mutex::new(EstadoArchivosAbiertos::default())))
        .setup(|aplicacion| {
            preferencias::instalar_menu(aplicacion)?;
            let directorio_datos = aplicacion.path().app_data_dir()?;
            fs::create_dir_all(&directorio_datos)?;
            let directorio_biblioteca = directorio_datos.join("Biblioteca");
            fs::create_dir_all(&directorio_biblioteca)?;
            let directorio_biblioteca = directorio_biblioteca.canonicalize()?;
            let ruta_anterior = directorio_datos.join("lector.db");
            let ruta_actual = directorio_datos.join("carlector.db");
            if ruta_anterior.is_file() && !ruta_actual.exists() {
                fs::rename(&ruta_anterior, &ruta_actual)?;
            }
            let conexion = abrir_base_datos(&ruta_actual)
                .map_err(|error: ErrorBiblioteca| error.to_string())?;
            aplicacion.manage(EstadoAplicacion { biblioteca: Mutex::new(conexion), directorio_biblioteca, kokoro: Arc::new(Mutex::new(MotorKokoro::nuevo(&directorio_datos))) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![asociaciones::estado_asociaciones_archivo, asociaciones::establecer_asociacion_archivo, estado_kokoro, instalar_kokoro, sintetizar_kokoro, listar_documentos, importar_documento, guardar_progreso, leer_documento, extraer_markdown, tomar_archivos_abiertos, listar_documentos_directorio, listar_carpetas, crear_carpeta, sincronizar_biblioteca, abrir_biblioteca_en_finder, abrir_carpeta_en_finder, renombrar_carpeta, eliminar_carpeta, mover_documento, renombrar_documento, editar_documento, reordenar_documentos, eliminar_documento, guardar_fragmento, listar_fragmentos, eliminar_fragmento, cambiar_destacado_fragmento, guardar_nota, listar_notas, eliminar_nota, guardar_cache_documento, leer_cache_documento])
        .build(tauri::generate_context!())
        .expect("No fue posible construir Carlector");
    aplicacion.run(|_manejador, _evento| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _evento {
            let rutas = urls.iter().filter_map(|url| url.to_file_path().ok()).map(|ruta| ruta.to_string_lossy().to_string()).collect::<Vec<_>>();
            if rutas.is_empty() { return; }
            if let Ok(mut archivos) = _manejador.state::<ArchivosAbiertos>().0.lock() {
                if !archivos.receptor_listo { archivos.pendientes.extend(rutas.clone()); }
            }
            let _ = _manejador.emit("abrir-documentos", rutas);
        }
    });
}
