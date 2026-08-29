use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FormatoAsociacion {
    Pdf,
    Epub,
    Markdown,
}

impl FormatoAsociacion {
    const TODOS: [Self; 3] = [Self::Pdf, Self::Epub, Self::Markdown];

    fn desde_id(id: &str) -> Result<Self, String> {
        match id {
            "pdf" => Ok(Self::Pdf),
            "epub" => Ok(Self::Epub),
            "markdown" => Ok(Self::Markdown),
            _ => Err(format!("Formato de asociación no válido: {id}")),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Epub => "epub",
            Self::Markdown => "markdown",
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Pdf => ".pdf",
            Self::Epub => ".epub",
            Self::Markdown => ".md · .markdown",
        }
    }

    fn identificador_tipo(self) -> &'static str {
        match self {
            Self::Pdf => "com.adobe.pdf",
            Self::Epub => "org.idpf.epub-container",
            Self::Markdown => "net.daringfireball.markdown",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct EstadoAsociacionArchivo {
    formato: &'static str,
    extension: &'static str,
    predeterminada: bool,
    aplicacion_actual: Option<String>,
}

fn ruta_bundle_desde_ejecutable(ejecutable: &Path) -> Result<PathBuf, String> {
    let bundle = ejecutable
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .ok_or_else(|| "No fue posible localizar el bundle de Carlector".to_string())?;
    if bundle.extension().and_then(|extension| extension.to_str()) != Some("app") {
        return Err("Asociaciones disponibles solo desde Carlector.app instalada".to_string());
    }
    Ok(bundle.to_path_buf())
}

fn ruta_bundle_actual() -> Result<PathBuf, String> {
    let ejecutable = std::env::current_exe()
        .map_err(|error| format!("No fue posible localizar Carlector: {error}"))?;
    ruta_bundle_desde_ejecutable(&ejecutable)
}

fn rutas_equivalentes(izquierda: &Path, derecha: &Path) -> bool {
    let normalizar = |ruta: &Path| std::fs::canonicalize(ruta).unwrap_or_else(|_| ruta.to_path_buf());
    normalizar(izquierda) == normalizar(derecha)
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use block2::RcBlock;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSError, NSString, NSURL};
    use objc2_uniform_type_identifiers::UTType;
    use std::sync::Mutex;
    use std::time::Duration;

    fn tipo_contenido(formato: FormatoAsociacion) -> Result<objc2::rc::Retained<UTType>, String> {
        let identificador = NSString::from_str(formato.identificador_tipo());
        UTType::typeWithIdentifier(&identificador)
            .ok_or_else(|| format!("macOS no reconoce el tipo {}", formato.identificador_tipo()))
    }

    fn nombre_aplicacion(url: &NSURL) -> Option<String> {
        let ruta = url.path()?.to_string();
        Path::new(&ruta)
            .file_stem()
            .and_then(|nombre| nombre.to_str())
            .map(str::to_string)
    }

    fn consultar_asociaciones(ruta_bundle: &Path) -> Result<Vec<EstadoAsociacionArchivo>, String> {
        let espacio = NSWorkspace::sharedWorkspace();
        FormatoAsociacion::TODOS
            .into_iter()
            .map(|formato| {
                let tipo = tipo_contenido(formato)?;
                let aplicacion = espacio.URLForApplicationToOpenContentType(&tipo);
                let ruta_actual = aplicacion
                    .as_ref()
                    .and_then(|url| url.path())
                    .map(|ruta| PathBuf::from(ruta.to_string()));
                Ok(EstadoAsociacionArchivo {
                    formato: formato.id(),
                    extension: formato.extension(),
                    predeterminada: ruta_actual
                        .as_deref()
                        .is_some_and(|ruta| rutas_equivalentes(ruta, ruta_bundle)),
                    aplicacion_actual: aplicacion.as_deref().and_then(nombre_aplicacion),
                })
            })
            .collect()
    }

    async fn ejecutar_en_hilo_principal<T, F>(aplicacion: &AppHandle, operacion: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, String> + Send + 'static,
    {
        let (enviar, recibir) = tokio::sync::oneshot::channel();
        aplicacion
            .run_on_main_thread(move || {
                let _ = enviar.send(operacion());
            })
            .map_err(|error| format!("No fue posible usar Launch Services: {error}"))?;
        recibir
            .await
            .map_err(|_| "Launch Services no devolvió una respuesta".to_string())?
    }

    pub(super) async fn estado(aplicacion: AppHandle) -> Result<Vec<EstadoAsociacionArchivo>, String> {
        let ruta_bundle = ruta_bundle_actual()?;
        ejecutar_en_hilo_principal(&aplicacion, move || consultar_asociaciones(&ruta_bundle)).await
    }

    pub(super) async fn establecer(
        aplicacion: AppHandle,
        formato: FormatoAsociacion,
    ) -> Result<Vec<EstadoAsociacionArchivo>, String> {
        let ruta_bundle = ruta_bundle_actual()?;
        let ruta_consulta = ruta_bundle.clone();
        let (enviar_resultado, recibir_resultado) = tokio::sync::oneshot::channel();
        aplicacion
            .run_on_main_thread(move || {
                let tipo = match tipo_contenido(formato) {
                    Ok(tipo) => tipo,
                    Err(_) => {
                        let _ = enviar_resultado.send(false);
                        return;
                    }
                };
                let resultado_pendiente = Mutex::new(Some(enviar_resultado));
                let completar = RcBlock::new(move |error: *mut NSError| {
                    if let Some(enviar) = resultado_pendiente.lock().ok().and_then(|mut estado| estado.take()) {
                        let _ = enviar.send(error.is_null());
                    }
                });
                let ruta = NSString::from_str(&ruta_bundle.to_string_lossy());
                let url_aplicacion = NSURL::fileURLWithPath_isDirectory(&ruta, true);
                NSWorkspace::sharedWorkspace()
                    .setDefaultApplicationAtURL_toOpenContentType_completionHandler(
                        &url_aplicacion,
                        &tipo,
                        Some(&completar),
                    );
            })
            .map_err(|error| format!("No fue posible solicitar el cambio a macOS: {error}"))?;

        let aceptada = tokio::time::timeout(Duration::from_secs(15), recibir_resultado)
            .await
            .map_err(|_| "macOS no respondió al cambio de aplicación predeterminada".to_string())?
            .map_err(|_| "macOS canceló el cambio de aplicación predeterminada".to_string())?;
        if !aceptada {
            return Err("macOS rechazó el cambio de aplicación predeterminada".to_string());
        }
        ejecutar_en_hilo_principal(&aplicacion, move || consultar_asociaciones(&ruta_consulta)).await
    }
}

#[tauri::command]
pub(crate) async fn estado_asociaciones_archivo(
    aplicacion: AppHandle,
) -> Result<Vec<EstadoAsociacionArchivo>, String> {
    #[cfg(target_os = "macos")]
    {
        macos::estado(aplicacion).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = aplicacion;
        Err("Asociaciones de archivo disponibles solo en macOS".to_string())
    }
}

#[tauri::command]
pub(crate) async fn establecer_asociacion_archivo(
    aplicacion: AppHandle,
    formato: String,
) -> Result<Vec<EstadoAsociacionArchivo>, String> {
    let formato = FormatoAsociacion::desde_id(&formato)?;
    #[cfg(target_os = "macos")]
    {
        macos::establecer(aplicacion, formato).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (aplicacion, formato);
        Err("Asociaciones de archivo disponibles solo en macOS".to_string())
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn acepta_formatos_declarados_y_rechaza_identificadores_ajenos() {
        assert_eq!(FormatoAsociacion::desde_id("pdf"), Ok(FormatoAsociacion::Pdf));
        assert_eq!(FormatoAsociacion::desde_id("epub"), Ok(FormatoAsociacion::Epub));
        assert_eq!(FormatoAsociacion::desde_id("markdown"), Ok(FormatoAsociacion::Markdown));
        assert!(FormatoAsociacion::desde_id("docx").is_err());
    }

    #[test]
    fn obtiene_bundle_solo_desde_estructura_app_valida() {
        let ejecutable = Path::new("/Applications/Carlector.app/Contents/MacOS/carlector");
        assert_eq!(
            ruta_bundle_desde_ejecutable(ejecutable),
            Ok(PathBuf::from("/Applications/Carlector.app"))
        );
        assert!(ruta_bundle_desde_ejecutable(Path::new("/tmp/carlector")).is_err());
    }
}
