use std::path::{Path, PathBuf};

use serde::Serialize;

const ERROR_NO_DISPONIBLE: &str = "Kokoro ONNX no está disponible en esta plataforma";

#[derive(Debug, Clone, Serialize)]
pub struct EstadoKokoro {
    pub instalado: bool,
    pub modelo_sha256: Option<String>,
    pub voces_sha256: Option<String>,
    pub directorio: String,
}

pub struct MotorKokoro {
    directorio: PathBuf,
}

impl MotorKokoro {
    pub fn nuevo(directorio_datos: &Path) -> Self {
        Self {
            directorio: directorio_datos.join("motores").join("kokoro-onnx-v1"),
        }
    }

    pub fn estado(&self) -> Result<EstadoKokoro, String> {
        Ok(EstadoKokoro {
            instalado: false,
            modelo_sha256: None,
            voces_sha256: None,
            directorio: self.directorio.to_string_lossy().into_owned(),
        })
    }

    pub async fn instalar(
        &mut self,
        _ruta_modelo: &Path,
        _ruta_voces: &Path,
    ) -> Result<EstadoKokoro, String> {
        Err(ERROR_NO_DISPONIBLE.to_string())
    }

    pub async fn sintetizar(
        &mut self,
        _texto: &str,
        _voz: Option<&str>,
        _velocidad: f32,
        _idioma: Option<&str>,
    ) -> Result<Vec<u8>, String> {
        Err(ERROR_NO_DISPONIBLE.to_string())
    }
}
