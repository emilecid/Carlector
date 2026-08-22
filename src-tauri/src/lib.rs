mod biblioteca;
mod kokoro;

use std::fs;
use std::sync::{Arc, Mutex};

use biblioteca::{abrir_base_datos, descubrir_documentos_directorio, Carpeta, Documento, ErrorBiblioteca, FragmentoGuardado, RepositorioBiblioteca};
use kokoro::{EstadoKokoro, MotorKokoro};
use tauri::{Manager, State};

struct EstadoAplicacion {
    biblioteca: Mutex<RepositorioBiblioteca>,
    kokoro: Arc<Mutex<MotorKokoro>>,
}

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
fn guardar_progreso(id_documento: String, progreso: f64, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    let biblioteca = estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?;
    biblioteca.guardar_progreso(&id_documento, progreso).map_err(|error| error.to_string())
}

#[tauri::command]
fn leer_documento(id_documento: String, estado: State<'_, EstadoAplicacion>) -> Result<Vec<u8>, String> {
    let biblioteca = estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?;
    biblioteca.leer_documento(&id_documento).map_err(|error| error.to_string())
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
fn renombrar_carpeta(id: String, nombre: String, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.renombrar_carpeta(&id, &nombre).map_err(|error| error.to_string())
}

#[tauri::command]
fn eliminar_carpeta(id: String, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.eliminar_carpeta(&id).map_err(|error| error.to_string())
}

#[tauri::command]
fn mover_documento(id_documento: String, carpeta_id: Option<String>, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.mover_documento(&id_documento, carpeta_id.as_deref()).map_err(|error| error.to_string())
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
fn guardar_cache_documento(documento_id: String, contenido: String, estado: State<'_, EstadoAplicacion>) -> Result<(), String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.guardar_cache_documento(&documento_id, &contenido).map_err(|error| error.to_string())
}

#[tauri::command]
fn leer_cache_documento(documento_id: String, estado: State<'_, EstadoAplicacion>) -> Result<Option<String>, String> {
    estado.biblioteca.lock().map_err(|_| "No fue posible bloquear la biblioteca".to_string())?.leer_cache_documento(&documento_id).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn ejecutar() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|aplicacion| {
            let directorio_datos = aplicacion.path().app_data_dir()?;
            fs::create_dir_all(&directorio_datos)?;
            let ruta_anterior = directorio_datos.join("lector.db");
            let ruta_actual = directorio_datos.join("carlector.db");
            if ruta_anterior.is_file() && !ruta_actual.exists() {
                fs::rename(&ruta_anterior, &ruta_actual)?;
            }
            let conexion = abrir_base_datos(&ruta_actual)
                .map_err(|error: ErrorBiblioteca| error.to_string())?;
            aplicacion.manage(EstadoAplicacion { biblioteca: Mutex::new(conexion), kokoro: Arc::new(Mutex::new(MotorKokoro::nuevo(&directorio_datos))) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![estado_kokoro, instalar_kokoro, sintetizar_kokoro, listar_documentos, importar_documento, guardar_progreso, leer_documento, listar_documentos_directorio, listar_carpetas, crear_carpeta, renombrar_carpeta, eliminar_carpeta, mover_documento, editar_documento, reordenar_documentos, eliminar_documento, guardar_fragmento, listar_fragmentos, eliminar_fragmento, cambiar_destacado_fragmento, guardar_cache_documento, leer_cache_documento])
        .run(tauri::generate_context!())
        .expect("No fue posible ejecutar Carlector");
}
