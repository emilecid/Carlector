use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use kokoro_en::{KokoroTts, Voice};
use serde::Serialize;
use sha2::{Digest, Sha256};

const ARCHIVO_MODELO: &str = "kokoro-v1.0.onnx";
const ARCHIVO_VOCES: &str = "voices-v1.0.bin";

#[derive(Debug, Clone, Serialize)]
pub struct EstadoKokoro {
    pub instalado: bool,
    pub modelo_sha256: Option<String>,
    pub voces_sha256: Option<String>,
    pub directorio: String,
}

pub struct MotorKokoro {
    directorio: PathBuf,
    motor: Option<KokoroTts>,
    modelo_sha256: Option<String>,
    voces_sha256: Option<String>,
}

impl MotorKokoro {
    pub fn nuevo(directorio_datos: &Path) -> Self {
        Self { directorio: directorio_datos.join("motores").join("kokoro-onnx-v1"), motor: None, modelo_sha256: None, voces_sha256: None }
    }

    fn ruta_modelo(&self) -> PathBuf { self.directorio.join(ARCHIVO_MODELO) }
    fn ruta_voces(&self) -> PathBuf { self.directorio.join(ARCHIVO_VOCES) }

    pub fn estado(&self) -> Result<EstadoKokoro, String> {
        let modelo = self.ruta_modelo();
        let voces = self.ruta_voces();
        let instalado = validar_archivo(&modelo, "modelo ONNX", 1_000_000).is_ok()
            && validar_archivo(&voces, "paquete de voces", 1_000).is_ok();
        Ok(EstadoKokoro {
            instalado,
            modelo_sha256: self.modelo_sha256.clone(),
            voces_sha256: self.voces_sha256.clone(),
            directorio: self.directorio.to_string_lossy().into_owned(),
        })
    }

    pub async fn instalar(&mut self, ruta_modelo: &Path, ruta_voces: &Path) -> Result<EstadoKokoro, String> {
        validar_archivo(ruta_modelo, "modelo ONNX", 1_000_000)?;
        validar_archivo(ruta_voces, "paquete de voces", 1_000)?;
        fs::create_dir_all(&self.directorio).map_err(|error| format!("No fue posible crear el directorio Kokoro: {error}"))?;
        fs::copy(ruta_modelo, self.ruta_modelo()).map_err(|error| format!("No fue posible copiar el modelo: {error}"))?;
        fs::copy(ruta_voces, self.ruta_voces()).map_err(|error| format!("No fue posible copiar las voces: {error}"))?;
        self.modelo_sha256 = Some(calcular_sha256(&self.ruta_modelo())?);
        self.voces_sha256 = Some(calcular_sha256(&self.ruta_voces())?);
        self.motor = None;
        self.cargar_motor().await?;
        self.estado()
    }

    async fn cargar_motor(&mut self) -> Result<&KokoroTts, String> {
        if self.motor.is_none() {
            if !self.ruta_modelo().is_file() || !self.ruta_voces().is_file() {
                return Err("Kokoro ONNX no está instalado. Importe el modelo y las voces desde Configuración > Voz.".to_string());
            }
            let modelo = self.ruta_modelo().to_string_lossy().into_owned();
            let voces = self.ruta_voces().to_string_lossy().into_owned();
            self.motor = Some(KokoroTts::new(&modelo, &voces).await.map_err(|error| format!("No fue posible cargar Kokoro ONNX: {error}"))?);
        }
        self.motor.as_ref().ok_or_else(|| "No fue posible iniciar Kokoro ONNX".to_string())
    }

    pub async fn sintetizar(&mut self, texto: &str, voz: Option<&str>, velocidad: f32, idioma: Option<&str>) -> Result<Vec<u8>, String> {
        if texto.trim().is_empty() { return Err("No hay texto para sintetizar".to_string()); }
        if idioma.is_some_and(|codigo| !codigo.to_ascii_lowercase().starts_with("en")) {
            return Err("Este adaptador Kokoro verificado admite inglés; selecciona TTS del sistema para español".to_string());
        }
        let voz = Voice::new(voz.unwrap_or("af_heart")).with_speed(velocidad);
        let (muestras, _) = self.cargar_motor().await?.synth(texto, voz).await.map_err(|error| format!("Kokoro no pudo sintetizar el fragmento: {error}"))?;
        crear_wav(&muestras, 24_000)
    }
}

fn validar_archivo(ruta: &Path, nombre: &str, minimo: u64) -> Result<(), String> {
    let metadata = fs::metadata(ruta).map_err(|error| format!("No fue posible leer {nombre}: {error}"))?;
    if !metadata.is_file() || metadata.len() < minimo { return Err(format!("El {nombre} no es un archivo válido")); }
    Ok(())
}

fn calcular_sha256(ruta: &Path) -> Result<String, String> {
    let datos = fs::read(ruta).map_err(|error| format!("No fue posible verificar {}: {error}", ruta.display()))?;
    Ok(format!("{:x}", Sha256::digest(datos)))
}

fn crear_wav(muestras: &[f32], frecuencia: u32) -> Result<Vec<u8>, String> {
    let longitud_datos = muestras.len().checked_mul(2).ok_or_else(|| "Audio demasiado extenso".to_string())? as u32;
    let mut salida = Vec::with_capacity(44 + longitud_datos as usize);
    salida.write_all(b"RIFF").map_err(|error| error.to_string())?;
    salida.write_all(&(36 + longitud_datos).to_le_bytes()).map_err(|error| error.to_string())?;
    salida.write_all(b"WAVEfmt \x10\0\0\0\x01\0\x01\0").map_err(|error| error.to_string())?;
    salida.write_all(&frecuencia.to_le_bytes()).map_err(|error| error.to_string())?;
    salida.write_all(&(frecuencia * 2).to_le_bytes()).map_err(|error| error.to_string())?;
    salida.write_all(&2_u16.to_le_bytes()).map_err(|error| error.to_string())?;
    salida.write_all(&16_u16.to_le_bytes()).map_err(|error| error.to_string())?;
    salida.write_all(b"data").map_err(|error| error.to_string())?;
    salida.write_all(&longitud_datos.to_le_bytes()).map_err(|error| error.to_string())?;
    for muestra in muestras {
        let valor = (muestra.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        salida.write_all(&valor.to_le_bytes()).map_err(|error| error.to_string())?;
    }
    Ok(salida)
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn wav_contiene_cabecera_y_muestras_pcm() {
        let wav = crear_wav(&[0.0, 0.5, -0.5], 24_000).expect("crear wav");
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(wav.len(), 50);
    }

    #[test]
    fn estado_exige_modelo_y_voces_con_tamano_utilizable() {
        let raiz = std::env::temp_dir().join(format!("carlector-kokoro-{}", std::process::id()));
        let directorio = raiz.join("motores").join("kokoro-onnx-v1");
        fs::create_dir_all(&directorio).expect("crear temporal Kokoro");
        fs::write(directorio.join(ARCHIVO_MODELO), vec![0_u8; 1_000_000]).expect("modelo temporal");
        fs::write(directorio.join(ARCHIVO_VOCES), vec![0_u8; 1_000]).expect("voces temporales");
        let motor = MotorKokoro::nuevo(&raiz);
        assert!(motor.estado().expect("estado Kokoro").instalado);
        fs::write(directorio.join(ARCHIVO_VOCES), [0_u8; 10]).expect("voces inválidas");
        assert!(!motor.estado().expect("estado inválido").instalado);
        fs::remove_dir_all(&raiz).expect("limpiar temporal Kokoro");
    }
}
