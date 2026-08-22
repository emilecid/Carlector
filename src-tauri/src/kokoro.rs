use std::fs;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use ndarray::ArrayD;
use ndarray_npy::NpzReader;
use sayd_kokoro::Kokoro;
use serde::Serialize;
use sha2::{Digest, Sha256};

const ARCHIVO_MODELO: &str = "kokoro-v1.0.onnx";
const ARCHIVO_VOCES: &str = "voices-v1.0.bin";
const ARCHIVO_TOKENIZADOR: &str = "tokenizer.json";
const SHA256_MODELO: &str = "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5";
const SHA256_VOCES: &str = "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d";

#[derive(Debug, Clone, Serialize)]
pub struct EstadoKokoro {
    pub instalado: bool,
    pub modelo_sha256: Option<String>,
    pub voces_sha256: Option<String>,
    pub directorio: String,
}

pub struct MotorKokoro {
    directorio: PathBuf,
    motor: Option<Kokoro>,
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
        let modelo_sha256 = validar_sha256(ruta_modelo, SHA256_MODELO, "modelo ONNX")?;
        let voces_sha256 = validar_sha256(ruta_voces, SHA256_VOCES, "paquete de voces")?;
        fs::create_dir_all(&self.directorio).map_err(|error| format!("No fue posible crear el directorio Kokoro: {error}"))?;
        fs::copy(ruta_modelo, self.ruta_modelo()).map_err(|error| format!("No fue posible copiar el modelo: {error}"))?;
        fs::copy(ruta_voces, self.ruta_voces()).map_err(|error| format!("No fue posible copiar las voces: {error}"))?;
        self.modelo_sha256 = Some(modelo_sha256);
        self.voces_sha256 = Some(voces_sha256);
        self.motor = None;
        self.cargar_motor()?;
        self.estado()
    }

    fn cargar_motor(&mut self) -> Result<&mut Kokoro, String> {
        if self.motor.is_none() {
            if !self.ruta_modelo().is_file() || !self.ruta_voces().is_file() {
                return Err("Kokoro ONNX no está instalado. Importe el modelo y las voces desde Configuración > Voz.".to_string());
            }
            preparar_paquete_voces(&self.ruta_voces(), &self.directorio)?;
            escribir_tokenizador(&self.directorio.join(ARCHIVO_TOKENIZADOR))?;
            configurar_onnx_runtime()?;
            self.motor = Some(Kokoro::new(&self.directorio, ARCHIVO_MODELO, 2).map_err(|error| format!("No fue posible cargar Kokoro ONNX: {error}"))?);
        }
        self.motor.as_mut().ok_or_else(|| "No fue posible iniciar Kokoro ONNX".to_string())
    }

    pub async fn sintetizar(&mut self, texto: &str, voz: Option<&str>, velocidad: f32, idioma: Option<&str>) -> Result<Vec<u8>, String> {
        if texto.trim().is_empty() { return Err("No hay texto para sintetizar".to_string()); }
        let idioma = normalizar_idioma(idioma.unwrap_or("en-us"))?;
        let voz = voz.unwrap_or_else(|| voz_predeterminada(idioma));
        validar_voz_idioma(voz, idioma)?;
        let fonemas = fonetizar(texto, idioma)?;
        let motor = self.cargar_motor()?;
        motor.load_voice(voz).map_err(|error| format!("No fue posible cargar la voz {voz}: {error}"))?;
        let muestras = motor.synth(&fonemas, voz, velocidad).map_err(|error| format!("Kokoro no pudo sintetizar el fragmento: {error}"))?;
        crear_wav(&muestras, 24_000)
    }
}

fn normalizar_idioma(idioma: &str) -> Result<&'static str, String> {
    match idioma.trim().to_ascii_lowercase().as_str() {
        "es" | "es-es" | "es-cl" | "es-419" => Ok("es"),
        "en" | "en-us" => Ok("en-us"),
        "en-gb" => Ok("en-gb"),
        otro => Err(format!("Kokoro no tiene un paquete fonético compatible con {otro}")),
    }
}

fn voz_predeterminada(idioma: &str) -> &'static str {
    match idioma { "es" => "ef_dora", "en-gb" => "bf_emma", _ => "af_heart" }
}

fn validar_voz_idioma(voz: &str, idioma: &str) -> Result<(), String> {
    let prefijo = match idioma { "es" => 'e', "en-gb" => 'b', _ => 'a' };
    if voz.starts_with(prefijo) { Ok(()) } else { Err(format!("La voz {voz} no corresponde al idioma {idioma}. Selecciona una voz compatible.")) }
}

fn fonetizar(texto: &str, idioma: &str) -> Result<String, String> {
    let binario = buscar_binario(&["/opt/homebrew/bin/espeak-ng", "/usr/local/bin/espeak-ng", "/usr/bin/espeak-ng"])
        .unwrap_or_else(|| PathBuf::from("espeak-ng"));
    let mut hijo = Command::new(binario)
        .args(["-q", "--ipa=3", "-v", idioma, "--stdin"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|_| "Falta espeak-ng. Instálalo desde el administrador del paquete de idioma.".to_string())?;
    hijo.stdin.as_mut().ok_or_else(|| "No fue posible abrir el fonetizador".to_string())?
        .write_all(texto.as_bytes()).map_err(|error| format!("No fue posible enviar texto al fonetizador: {error}"))?;
    let salida = hijo.wait_with_output().map_err(|error| format!("Falló el fonetizador: {error}"))?;
    if !salida.status.success() { return Err(format!("Falló espeak-ng: {}", String::from_utf8_lossy(&salida.stderr).trim())); }
    let fonemas = String::from_utf8_lossy(&salida.stdout).split_whitespace().collect::<Vec<_>>().join(" ");
    if fonemas.is_empty() { Err("El paquete fonético no produjo pronunciación".to_string()) } else { Ok(fonemas) }
}

fn buscar_binario(candidatos: &[&str]) -> Option<PathBuf> {
    candidatos.iter().map(PathBuf::from).find(|ruta| ruta.is_file())
}

fn configurar_onnx_runtime() -> Result<(), String> {
    if std::env::var_os("ORT_DYLIB_PATH").is_some() { return Ok(()); }
    let ruta = buscar_binario(&[
        "/opt/homebrew/opt/onnxruntime/lib/libonnxruntime.dylib",
        "/usr/local/opt/onnxruntime/lib/libonnxruntime.dylib",
        "/usr/lib/libonnxruntime.so",
        "/usr/local/lib/libonnxruntime.so",
    ]).ok_or_else(|| "Falta ONNX Runtime. Instala el componente local ONNX Runtime del paquete Kokoro.".to_string())?;
    std::env::set_var("ORT_DYLIB_PATH", ruta);
    Ok(())
}

fn preparar_paquete_voces(origen: &Path, directorio: &Path) -> Result<(), String> {
    let destino = directorio.join("voices");
    if destino.join("ef_dora.bin").is_file() && destino.join("af_heart.bin").is_file() { return Ok(()); }
    fs::create_dir_all(&destino).map_err(|error| format!("No fue posible preparar las voces: {error}"))?;
    let archivo = File::open(origen).map_err(|error| format!("No fue posible abrir el paquete de voces: {error}"))?;
    let mut npz = NpzReader::new(archivo).map_err(|error| format!("El paquete de voces no usa formato NPZ oficial: {error}"))?;
    for nombre in npz.names().map_err(|error| format!("No fue posible enumerar las voces: {error}"))? {
        let datos: ArrayD<f32> = npz.by_name(&nombre).map_err(|error| format!("No fue posible leer {nombre}: {error}"))?;
        let identificador = nombre.trim_end_matches(".npy");
        let archivo_salida = File::create(destino.join(format!("{identificador}.bin"))).map_err(|error| format!("No fue posible preparar {identificador}: {error}"))?;
        let mut salida = BufWriter::new(archivo_salida);
        let mut bloque = Vec::with_capacity(64 * 1024);
        for valor in datos.iter() {
            bloque.extend_from_slice(&valor.to_le_bytes());
            if bloque.len() >= 64 * 1024 {
                salida.write_all(&bloque).map_err(|error| format!("No fue posible escribir {identificador}: {error}"))?;
                bloque.clear();
            }
        }
        salida.write_all(&bloque).map_err(|error| format!("No fue posible escribir {identificador}: {error}"))?;
        salida.flush().map_err(|error| format!("No fue posible completar {identificador}: {error}"))?;
    }
    Ok(())
}

fn escribir_tokenizador(ruta: &Path) -> Result<(), String> {
    if ruta.is_file() { return Ok(()); }
    let caracteres = ";:,.!?—…\"()“” ̃ʣʥʦʨᵝꭧAIOQSTWYᵊabcdefhijklmnopqrstuvwxyzɑɐɒæβɔɕçɖðʤəɚɛɜɟɡɥɨɪʝɯɰŋɳɲɴøɸθœɹɾɻʁɽʂʃʈʧʊʋʌɣɤχʎʒʔˈˌːʰʲ↓→↗↘ᵻ";
    let ids = [1,2,3,4,5,6,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,31,33,35,36,39,41,42,43,44,45,46,47,48,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,75,76,77,78,80,81,82,83,85,86,87,90,92,99,101,102,103,110,111,112,113,114,115,116,118,119,120,123,125,126,128,129,130,131,132,133,135,136,138,139,140,142,143,147,148,156,157,158,162,164,169,171,172,173,177];
    let vocab: HashMap<String, i64> = caracteres.chars().zip(ids).map(|(c, id)| (c.to_string(), id)).collect();
    let contenido = serde_json::json!({"model":{"vocab":vocab}});
    fs::write(ruta, serde_json::to_vec(&contenido).map_err(|error| error.to_string())?).map_err(|error| format!("No fue posible crear el tokenizador: {error}"))
}

fn validar_archivo(ruta: &Path, nombre: &str, minimo: u64) -> Result<(), String> {
    let metadata = fs::metadata(ruta).map_err(|error| format!("No fue posible leer {nombre}: {error}"))?;
    if !metadata.is_file() || metadata.len() < minimo { return Err(format!("El {nombre} no es un archivo válido")); }
    Ok(())
}

fn calcular_sha256(ruta: &Path) -> Result<String, String> {
    let archivo = File::open(ruta).map_err(|error| format!("No fue posible verificar {}: {error}", ruta.display()))?;
    let mut lector = BufReader::new(archivo);
    let mut hash = Sha256::new();
    let mut bloque = [0_u8; 64 * 1024];
    loop {
        let leidos = lector.read(&mut bloque).map_err(|error| format!("No fue posible verificar {}: {error}", ruta.display()))?;
        if leidos == 0 { break; }
        hash.update(&bloque[..leidos]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn validar_sha256(ruta: &Path, esperado: &str, nombre: &str) -> Result<String, String> {
    let obtenido = calcular_sha256(ruta)?;
    if obtenido == esperado { Ok(obtenido) } else { Err(format!("El {nombre} no coincide con el SHA-256 oficial. Descárgalo nuevamente desde Repositorios de voz.")) }
}

fn crear_wav(muestras: &[f32], frecuencia: u32) -> Result<Vec<u8>, String> {
    let longitud_datos = muestras.len().checked_mul(2).ok_or_else(|| "Audio demasiado extenso".to_string())? as u32;
    let mut salida = Vec::with_capacity(44 + longitud_datos as usize);
    salida.extend_from_slice(b"RIFF");
    salida.extend_from_slice(&(36 + longitud_datos).to_le_bytes());
    salida.extend_from_slice(b"WAVEfmt \x10\0\0\0\x01\0\x01\0");
    salida.extend_from_slice(&frecuencia.to_le_bytes());
    salida.extend_from_slice(&(frecuencia * 2).to_le_bytes());
    salida.extend_from_slice(&2_u16.to_le_bytes());
    salida.extend_from_slice(&16_u16.to_le_bytes());
    salida.extend_from_slice(b"data");
    salida.extend_from_slice(&longitud_datos.to_le_bytes());
    for muestra in muestras {
        let valor = (muestra.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        salida.extend_from_slice(&valor.to_le_bytes());
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

    #[test]
    fn idioma_y_voz_deben_pertenecer_al_mismo_paquete() {
        assert_eq!(normalizar_idioma("es-CL").expect("español"), "es");
        assert!(validar_voz_idioma("ef_dora", "es").is_ok());
        assert!(validar_voz_idioma("af_heart", "es").is_err());
        assert_eq!(voz_predeterminada("es"), "ef_dora");
    }

    #[test]
    fn verifica_sha256_oficial_sin_aceptar_archivo_distinto() {
        let ruta = std::env::temp_dir().join(format!("carlector-hash-{}.bin", std::process::id()));
        fs::write(&ruta, b"abc").expect("crear archivo hash");
        let esperado = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

        assert!(validar_sha256(&ruta, esperado, "prueba").is_ok());
        assert!(validar_sha256(&ruta, &"0".repeat(64), "prueba").is_err());

        fs::remove_file(ruta).expect("limpiar archivo hash");
    }

    #[test]
    #[ignore = "requiere modelo Kokoro local explícito"]
    fn sintetiza_modelo_local_configurado() {
        let raiz = std::env::var("CARLECTOR_DIRECTORIO_DATOS").expect("CARLECTOR_DIRECTORIO_DATOS");
        let mut motor = MotorKokoro::nuevo(Path::new(&raiz));
        assert!(motor.estado().expect("estado Kokoro").instalado);
        let wav_ingles = tauri::async_runtime::block_on(motor.sintetizar("Hello from Carlector.", Some("af_heart"), 1.0, Some("en-us"))).expect("síntesis Kokoro inglesa");
        let wav_espanol = tauri::async_runtime::block_on(motor.sintetizar("Hola desde Carlector.", Some("ef_dora"), 1.0, Some("es"))).expect("síntesis Kokoro española");
        assert!(wav_ingles.len() > 44);
        assert!(wav_espanol.len() > 44);
        if let Ok(ruta) = std::env::var("CARLECTOR_SALIDA_WAV_PRUEBA") {
            fs::write(ruta, &wav_espanol).expect("guardar WAV diagnóstico");
        }
    }
}
