use tauri::AppHandle;

const ERROR_NO_DISPONIBLE: &str = "Asociaciones de archivo disponibles solo en macOS";

#[tauri::command]
pub(crate) async fn estado_asociaciones_archivo(_aplicacion: AppHandle) -> Result<(), String> {
    Err(ERROR_NO_DISPONIBLE.to_string())
}

#[tauri::command]
pub(crate) async fn establecer_asociacion_archivo(
    _aplicacion: AppHandle,
    _formato: String,
) -> Result<(), String> {
    Err(ERROR_NO_DISPONIBLE.to_string())
}
