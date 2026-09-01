use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ErrorBiblioteca {
    #[error("El archivo no existe: {0}")]
    ArchivoInexistente(String),
    #[error("Formato no admitido: {0}")]
    FormatoInvalido(String),
    #[error("Nombre no válido: {0}")]
    NombreInvalido(String),
    #[error("Operación no permitida: {0}")]
    OperacionInvalida(String),
    #[error("Error de base de datos: {0}")]
    BaseDatos(#[from] rusqlite::Error),
    #[error("No fue posible leer el documento: {0}")]
    Lectura(#[from] std::io::Error),
    #[error("No fue posible serializar datos locales: {0}")]
    Serializacion(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Documento {
    pub id: String,
    pub titulo: String,
    pub autor: String,
    pub formato: String,
    pub ruta: String,
    pub progreso: f64,
    pub ultima_lectura: Option<String>,
    pub carpeta_id: Option<String>,
    pub orden: i64,
    pub estado_lectura: Option<EstadoLecturaDocumento>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EstadoLecturaDocumento {
    pub indice_fragmento: i64,
    pub pagina: i64,
    pub indice_unidad: i64,
    pub desplazamiento: f64,
    pub modo_visual_pdf: String,
    pub componentes: EstadoPanelesLectura,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EstadoPanelesLectura {
    pub biblioteca: bool,
    pub inspector: bool,
    pub controles: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Carpeta {
    pub id: String,
    pub nombre: String,
    pub orden: i64,
    #[serde(default)]
    pub ruta: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FragmentoGuardado {
    pub id: String,
    pub documento_id: String,
    pub texto: String,
    pub indice_fragmento: i64,
    pub creado: String,
    pub destacado: bool,
    #[serde(default)]
    pub ancla: Option<AnclaFragmento>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NotaDocumento {
    pub id: String,
    pub documento_id: String,
    pub texto: String,
    pub creado: String,
    #[serde(default)]
    pub fragmento_id: Option<String>,
    #[serde(default)]
    pub pagina: Option<i64>,
    #[serde(default)]
    pub ancla: Option<AnclaFragmento>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnclaFragmento {
    pub bloque_id: String,
    pub inicio: i64,
    pub fin: i64,
}

pub struct RepositorioBiblioteca {
    conexion: Connection,
    directorio_biblioteca: PathBuf,
}

pub fn abrir_base_datos(ruta: &Path) -> Result<RepositorioBiblioteca, ErrorBiblioteca> {
    let directorio_biblioteca = ruta.parent().unwrap_or_else(|| Path::new(".")).join("Biblioteca");
    fs::create_dir_all(&directorio_biblioteca)?;
    let directorio_biblioteca = directorio_biblioteca.canonicalize()?;
    let conexion = Connection::open(ruta)?;
    conexion.execute_batch(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS documentos (
           id TEXT PRIMARY KEY,
           titulo TEXT NOT NULL,
           autor TEXT NOT NULL DEFAULT '',
           formato TEXT NOT NULL CHECK(formato IN ('PDF', 'EPUB', 'MARKDOWN')),
           ruta TEXT NOT NULL UNIQUE,
           progreso REAL NOT NULL DEFAULT 0 CHECK(progreso BETWEEN 0 AND 100),
           ultima_lectura TEXT,
           carpeta_id TEXT,
           orden INTEGER NOT NULL DEFAULT 0,
           estado_lectura_json TEXT
         );
         CREATE TABLE IF NOT EXISTS carpetas (
           id TEXT PRIMARY KEY,
           nombre TEXT NOT NULL,
           orden INTEGER NOT NULL DEFAULT 0,
           ruta TEXT
         );
         CREATE TABLE IF NOT EXISTS fragmentos_guardados (
           id TEXT PRIMARY KEY,
           documento_id TEXT NOT NULL,
           texto TEXT NOT NULL,
           indice_fragmento INTEGER NOT NULL CHECK(indice_fragmento >= 0),
           creado TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
           ,destacado INTEGER NOT NULL DEFAULT 1,
           ancla_json TEXT
         );
         CREATE INDEX IF NOT EXISTS fragmentos_documento ON fragmentos_guardados(documento_id, indice_fragmento);
         CREATE TABLE IF NOT EXISTS notas_documento (
           id TEXT PRIMARY KEY,
           documento_id TEXT NOT NULL,
           texto TEXT NOT NULL CHECK(length(trim(texto)) > 0),
           creado TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           fragmento_id TEXT,
           pagina INTEGER CHECK(pagina IS NULL OR pagina >= 1),
           ancla_json TEXT
         );
         CREATE INDEX IF NOT EXISTS notas_por_documento ON notas_documento(documento_id, creado);
         CREATE TABLE IF NOT EXISTS cache_documentos (
           documento_id TEXT PRIMARY KEY,
           contenido TEXT NOT NULL,
           actualizado TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE INDEX IF NOT EXISTS documentos_ultima_lectura ON documentos(ultima_lectura);",
    )?;
    migrar_columna(&conexion, "carpeta_id", "TEXT")?;
    migrar_columna(&conexion, "orden", "INTEGER NOT NULL DEFAULT 0")?;
    migrar_columna(&conexion, "estado_lectura_json", "TEXT")?;
    migrar_columna_tabla(&conexion, "fragmentos_guardados", "destacado", "INTEGER NOT NULL DEFAULT 1")?;
    migrar_columna_tabla(&conexion, "fragmentos_guardados", "ancla_json", "TEXT")?;
    migrar_columna_tabla(&conexion, "notas_documento", "fragmento_id", "TEXT")?;
    migrar_columna_tabla(&conexion, "notas_documento", "pagina", "INTEGER")?;
    migrar_columna_tabla(&conexion, "notas_documento", "ancla_json", "TEXT")?;
    migrar_columna_tabla(&conexion, "carpetas", "ruta", "TEXT")?;
    conexion.execute("CREATE UNIQUE INDEX IF NOT EXISTS carpetas_ruta ON carpetas(ruta) WHERE ruta IS NOT NULL", [])?;
    migrar_formato_markdown(&conexion)?;
    let repositorio = RepositorioBiblioteca { conexion, directorio_biblioteca };
    repositorio.sincronizar_biblioteca()?;
    Ok(repositorio)
}

fn migrar_formato_markdown(conexion: &Connection) -> Result<(), rusqlite::Error> {
    let definicion: String = conexion.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'documentos'",
        [],
        |fila| fila.get(0),
    )?;
    if definicion.contains("'MARKDOWN'") { return Ok(()); }
    conexion.execute_batch(
        "BEGIN IMMEDIATE;
         ALTER TABLE documentos RENAME TO documentos_anteriores;
         CREATE TABLE documentos (
           id TEXT PRIMARY KEY,
           titulo TEXT NOT NULL,
           autor TEXT NOT NULL DEFAULT '',
           formato TEXT NOT NULL CHECK(formato IN ('PDF', 'EPUB', 'MARKDOWN')),
           ruta TEXT NOT NULL UNIQUE,
           progreso REAL NOT NULL DEFAULT 0 CHECK(progreso BETWEEN 0 AND 100),
           ultima_lectura TEXT,
           carpeta_id TEXT,
           orden INTEGER NOT NULL DEFAULT 0,
           estado_lectura_json TEXT
         );
         INSERT INTO documentos (id, titulo, autor, formato, ruta, progreso, ultima_lectura, carpeta_id, orden, estado_lectura_json)
           SELECT id, titulo, autor, formato, ruta, progreso, ultima_lectura, carpeta_id, orden, estado_lectura_json FROM documentos_anteriores;
         DROP TABLE documentos_anteriores;
         CREATE INDEX IF NOT EXISTS documentos_ultima_lectura ON documentos(ultima_lectura);
         COMMIT;",
    )
}

fn migrar_columna(conexion: &Connection, nombre: &str, definicion: &str) -> Result<(), rusqlite::Error> {
    migrar_columna_tabla(conexion, "documentos", nombre, definicion)
}

fn migrar_columna_tabla(conexion: &Connection, tabla: &str, nombre: &str, definicion: &str) -> Result<(), rusqlite::Error> {
    let mut consulta = conexion.prepare(&format!("PRAGMA table_info({tabla})"))?;
    let columnas = consulta.query_map([], |fila| fila.get::<_, String>(1))?.collect::<Result<Vec<_>, _>>()?;
    if !columnas.iter().any(|columna| columna == nombre) {
        conexion.execute(&format!("ALTER TABLE {tabla} ADD COLUMN {nombre} {definicion}"), [])?;
    }
    Ok(())
}

fn validar_ruta_documento(ruta: &str) -> Result<(PathBuf, String), ErrorBiblioteca> {
    let ruta_archivo = PathBuf::from(ruta);
    if !ruta_archivo.is_file() {
        return Err(ErrorBiblioteca::ArchivoInexistente(ruta.to_string()));
    }
    let extension = ruta_archivo.extension().and_then(|extension| extension.to_str()).unwrap_or_default().to_uppercase();
    let formato = match extension.as_str() {
        "PDF" | "EPUB" => extension,
        "MD" | "MARKDOWN" => "MARKDOWN".to_string(),
        _ => return Err(ErrorBiblioteca::FormatoInvalido(extension)),
    };
    Ok((ruta_archivo, formato))
}

fn validar_nombre(nombre: &str) -> Result<String, ErrorBiblioteca> {
    let nombre = nombre.trim();
    if nombre.is_empty() || nombre == "." || nombre == ".." || nombre.chars().any(|caracter| matches!(caracter, '/' | ':' | '\0')) {
        return Err(ErrorBiblioteca::NombreInvalido(nombre.to_string()));
    }
    Ok(nombre.to_string())
}

fn ruta_sin_colision(directorio: &Path, nombre: &str, semilla: &str) -> PathBuf {
    let directa = directorio.join(nombre);
    if !directa.exists() { return directa; }
    let ruta = Path::new(nombre);
    let base = ruta.file_stem().and_then(|valor| valor.to_str()).unwrap_or("Documento");
    let extension = ruta.extension().and_then(|valor| valor.to_str());
    let sufijo = format!("{:x}", calcular_hash_ruta(semilla));
    let alternativo = match extension {
        Some(extension) => format!("{base}-{}.{extension}", &sufijo[..8]),
        None => format!("{base}-{}", &sufijo[..8]),
    };
    directorio.join(alternativo)
}

fn archivos_iguales(izquierda: &Path, derecha: &Path) -> Result<bool, std::io::Error> {
    if fs::metadata(izquierda)?.len() != fs::metadata(derecha)?.len() { return Ok(false); }
    Ok(fs::read(izquierda)? == fs::read(derecha)?)
}

pub fn descubrir_documentos_directorio(ruta: &Path) -> Result<Vec<String>, ErrorBiblioteca> {
    if !ruta.is_dir() {
        return Err(ErrorBiblioteca::ArchivoInexistente(ruta.to_string_lossy().to_string()));
    }
    let raiz = ruta.canonicalize()?;
    let mut pendientes = vec![raiz.clone()];
    let mut documentos = Vec::new();
    while let Some(directorio) = pendientes.pop() {
        for entrada in fs::read_dir(directorio)? {
            let entrada = entrada?;
            let tipo = entrada.file_type()?;
            if tipo.is_symlink() { continue; }
            let ruta_entrada = entrada.path();
            if tipo.is_dir() {
                pendientes.push(ruta_entrada);
                continue;
            }
            let extension = ruta_entrada.extension().and_then(|valor| valor.to_str()).unwrap_or_default();
            if tipo.is_file() && ["pdf", "epub", "md", "markdown"].iter().any(|admitida| extension.eq_ignore_ascii_case(admitida)) {
                let ruta_canonica = ruta_entrada.canonicalize()?;
                if ruta_canonica.starts_with(&raiz) {
                    documentos.push(ruta_canonica.to_string_lossy().to_string());
                }
            }
        }
    }
    documentos.sort();
    Ok(documentos)
}

impl RepositorioBiblioteca {
    pub fn importar_documento(&self, ruta: &str) -> Result<Documento, ErrorBiblioteca> {
        let (ruta_archivo, formato) = validar_ruta_documento(ruta)?;
        let origen = ruta_archivo.canonicalize()?;
        let ruta_canonica = if origen.starts_with(&self.directorio_biblioteca) {
            origen
        } else {
            let nombre = origen.file_name().and_then(|valor| valor.to_str()).unwrap_or("Documento");
            for documento in self.listar_documentos()? {
                let existente = Path::new(&documento.ruta);
                if existente.file_name() == origen.file_name() && existente.is_file() && archivos_iguales(&origen, existente)? {
                    return Ok(documento);
                }
            }
            let mut destino = self.directorio_biblioteca.join(nombre);
            if destino.exists() {
                let destino_existente = destino.canonicalize()?;
                if archivos_iguales(&origen, &destino_existente)? {
                    if let Ok(documento) = self.obtener_documento_por_ruta(&destino_existente.to_string_lossy()) {
                        return Ok(documento);
                    }
                }
                destino = ruta_sin_colision(&self.directorio_biblioteca, nombre, &origen.to_string_lossy());
                if destino.exists() && archivos_iguales(&origen, &destino)? {
                    if let Ok(documento) = self.obtener_documento_por_ruta(&destino.canonicalize()?.to_string_lossy()) {
                        return Ok(documento);
                    }
                }
            }
            if !destino.exists() { fs::copy(&origen, &destino)?; }
            destino.canonicalize()?
        };
        let titulo = ruta_canonica.file_stem().and_then(|nombre| nombre.to_str()).unwrap_or("Documento").to_string();
        let ruta_texto = ruta_canonica.to_string_lossy().to_string();
        let id = format!("documento-{:x}", calcular_hash_ruta(&ruta_texto));
        let carpeta_id = self.carpeta_para_ruta(&ruta_canonica)?;
        self.conexion.execute(
            "INSERT INTO documentos (id, titulo, formato, ruta, carpeta_id) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(ruta) DO UPDATE SET carpeta_id = excluded.carpeta_id",
            params![id, titulo, formato, ruta_texto, carpeta_id],
        )?;
        self.obtener_documento_por_ruta(&ruta_texto)
    }

    pub fn listar_documentos(&self) -> Result<Vec<Documento>, ErrorBiblioteca> {
        let mut consulta = self.conexion.prepare(
            "SELECT id, titulo, autor, formato, ruta, progreso, ultima_lectura, carpeta_id, orden, estado_lectura_json
             FROM documentos ORDER BY orden, titulo COLLATE NOCASE",
        )?;
        let filas = consulta.query_map([], convertir_fila_documento)?;
        filas.collect::<Result<Vec<_>, _>>().map_err(ErrorBiblioteca::from)
    }

    pub fn crear_carpeta(&self, nombre: &str) -> Result<Carpeta, ErrorBiblioteca> {
        let nombre = validar_nombre(nombre)?;
        let ruta = self.directorio_biblioteca.join(&nombre);
        if ruta.exists() { return Err(ErrorBiblioteca::OperacionInvalida(format!("La carpeta ya existe: {nombre}"))); }
        fs::create_dir(&ruta)?;
        let ruta = ruta.canonicalize()?.to_string_lossy().to_string();
        let id = format!("carpeta-{:x}", calcular_hash_ruta(&ruta));
        let orden = self.contar_carpetas()?;
        self.conexion.execute("INSERT INTO carpetas (id, nombre, orden, ruta) VALUES (?1, ?2, ?3, ?4)", params![id, nombre, orden, ruta])?;
        Ok(Carpeta { id, nombre, orden, ruta: Some(ruta) })
    }

    pub fn listar_carpetas(&self) -> Result<Vec<Carpeta>, ErrorBiblioteca> {
        let mut consulta = self.conexion.prepare("SELECT id, nombre, orden, ruta FROM carpetas ORDER BY orden, nombre COLLATE NOCASE")?;
        let filas = consulta.query_map([], |fila| Ok(Carpeta { id: fila.get(0)?, nombre: fila.get(1)?, orden: fila.get(2)?, ruta: fila.get(3)? }))?;
        filas.collect::<Result<Vec<_>, _>>().map_err(ErrorBiblioteca::from)
    }

    pub fn ruta_carpeta(&self, id: &str) -> Result<PathBuf, ErrorBiblioteca> {
        let ruta: String = self.conexion.query_row("SELECT ruta FROM carpetas WHERE id = ?1 AND ruta IS NOT NULL", [id], |fila| fila.get(0))?;
        let ruta_directorio = PathBuf::from(&ruta);
        if !ruta_directorio.is_dir() { return Err(ErrorBiblioteca::ArchivoInexistente(ruta)); }
        ruta_directorio.canonicalize().map_err(ErrorBiblioteca::from)
    }

    pub fn sincronizar_biblioteca(&self) -> Result<(), ErrorBiblioteca> {
        let carpetas_previas = self.listar_carpetas()?;
        for carpeta in carpetas_previas {
            let interna = carpeta.ruta.as_deref().map(Path::new).is_some_and(|ruta| ruta.starts_with(&self.directorio_biblioteca) && ruta.is_dir());
            if !interna { self.conexion.execute("DELETE FROM carpetas WHERE id = ?1", [&carpeta.id])?; }
        }
        for entrada in fs::read_dir(&self.directorio_biblioteca)? {
            let entrada = entrada?;
            let tipo = entrada.file_type()?;
            if tipo.is_symlink() { continue; }
            if tipo.is_dir() {
                let ruta = entrada.path().canonicalize()?;
                let ruta_texto = ruta.to_string_lossy().to_string();
                let nombre = entrada.file_name().to_string_lossy().to_string();
                let id = format!("carpeta-{:x}", calcular_hash_ruta(&ruta_texto));
                let orden = self.contar_carpetas()?;
                self.conexion.execute("INSERT OR IGNORE INTO carpetas (id, nombre, orden, ruta) VALUES (?1, ?2, ?3, ?4)", params![id, nombre, orden, ruta_texto])?;
                self.conexion.execute("UPDATE carpetas SET nombre = ?1 WHERE ruta = ?2", params![nombre, ruta_texto])?;
            }
        }
        let carpetas = self.listar_carpetas()?;
        let mut rutas = Vec::new();
        let mut ubicaciones = vec![(self.directorio_biblioteca.clone(), None)];
        ubicaciones.extend(carpetas.iter().filter_map(|carpeta| carpeta.ruta.as_ref().map(|ruta| (PathBuf::from(ruta), Some(carpeta.id.clone())))));
        for (directorio, carpeta_id) in ubicaciones {
            for entrada in fs::read_dir(directorio)? {
                let entrada = entrada?;
                let tipo = entrada.file_type()?;
                if !tipo.is_file() || tipo.is_symlink() { continue; }
                let ruta = entrada.path();
                if validar_ruta_documento(&ruta.to_string_lossy()).is_err() { continue; }
                let ruta = ruta.canonicalize()?;
                let ruta_texto = ruta.to_string_lossy().to_string();
                let formato = validar_ruta_documento(&ruta_texto)?.1;
                let titulo = ruta.file_stem().and_then(|valor| valor.to_str()).unwrap_or("Documento");
                let id = format!("documento-{:x}", calcular_hash_ruta(&ruta_texto));
                self.conexion.execute(
                    "INSERT INTO documentos (id, titulo, formato, ruta, carpeta_id) VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(ruta) DO UPDATE SET carpeta_id = excluded.carpeta_id",
                    params![id, titulo, formato, ruta_texto, carpeta_id],
                )?;
                rutas.push(ruta_texto);
            }
        }
        for documento in self.listar_documentos()? {
            if !rutas.contains(&documento.ruta) { self.eliminar_registro_documento(&documento.id)?; }
        }
        Ok(())
    }

    pub fn renombrar_carpeta(&self, id: &str, nombre: &str) -> Result<Carpeta, ErrorBiblioteca> {
        let nombre = validar_nombre(nombre)?;
        let anterior = self.ruta_carpeta(id)?;
        let destino = self.directorio_biblioteca.join(&nombre);
        if destino.exists() && destino != anterior { return Err(ErrorBiblioteca::OperacionInvalida(format!("La carpeta ya existe: {nombre}"))); }
        if destino != anterior { fs::rename(&anterior, &destino)?; }
        let destino = destino.canonicalize()?;
        let documentos = self.listar_documentos()?.into_iter().filter(|documento| documento.carpeta_id.as_deref() == Some(id)).collect::<Vec<_>>();
        for documento in documentos {
            if let Some(archivo) = Path::new(&documento.ruta).file_name() {
                self.conexion.execute("UPDATE documentos SET ruta = ?1 WHERE id = ?2", params![destino.join(archivo).to_string_lossy(), documento.id])?;
            }
        }
        let ruta = destino.to_string_lossy().to_string();
        self.conexion.execute("UPDATE carpetas SET nombre = ?1, ruta = ?2 WHERE id = ?3", params![nombre, ruta, id])?;
        self.obtener_carpeta_por_ruta(&ruta)
    }

    pub fn eliminar_carpeta(&self, id: &str) -> Result<(), ErrorBiblioteca> {
        let ruta = self.ruta_carpeta(id)?;
        if fs::read_dir(&ruta)?.next().is_some() { return Err(ErrorBiblioteca::OperacionInvalida("La carpeta no está vacía".to_string())); }
        fs::remove_dir(&ruta)?;
        self.conexion.execute("DELETE FROM carpetas WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn mover_documento(&self, id_documento: &str, carpeta_id: Option<&str>) -> Result<Documento, ErrorBiblioteca> {
        let documento = self.obtener_documento(id_documento)?;
        let origen = PathBuf::from(&documento.ruta);
        let directorio = match carpeta_id { Some(id) => self.ruta_carpeta(id)?, None => self.directorio_biblioteca.clone() };
        let nombre = origen.file_name().and_then(|valor| valor.to_str()).ok_or_else(|| ErrorBiblioteca::NombreInvalido(documento.ruta.clone()))?;
        let mut destino = directorio.join(nombre);
        if destino != origen && destino.exists() { destino = ruta_sin_colision(&directorio, nombre, id_documento); }
        if destino != origen { fs::rename(&origen, &destino)?; }
        let ruta = destino.canonicalize()?.to_string_lossy().to_string();
        self.conexion.execute("UPDATE documentos SET carpeta_id = ?1, ruta = ?2 WHERE id = ?3", params![carpeta_id, ruta, id_documento])?;
        self.obtener_documento(id_documento)
    }

    pub fn renombrar_documento(&self, id: &str, nombre: &str) -> Result<Documento, ErrorBiblioteca> {
        let nombre = validar_nombre(nombre)?;
        let documento = self.obtener_documento(id)?;
        let origen = PathBuf::from(&documento.ruta);
        let extension = origen.extension().and_then(|valor| valor.to_str()).unwrap_or_default();
        let nombre_archivo = if extension.is_empty() { nombre.clone() } else { format!("{nombre}.{extension}") };
        let destino = origen.parent().unwrap_or(&self.directorio_biblioteca).join(nombre_archivo);
        if destino.exists() && destino != origen { return Err(ErrorBiblioteca::OperacionInvalida(format!("El archivo ya existe: {nombre}"))); }
        if destino != origen { fs::rename(&origen, &destino)?; }
        let ruta = destino.canonicalize()?.to_string_lossy().to_string();
        self.conexion.execute("UPDATE documentos SET titulo = ?1, ruta = ?2 WHERE id = ?3", params![nombre, ruta, id])?;
        self.obtener_documento(id)
    }

    pub fn editar_documento(&self, id: &str, titulo: &str, autor: &str) -> Result<(), ErrorBiblioteca> {
        self.conexion.execute("UPDATE documentos SET titulo = ?1, autor = ?2 WHERE id = ?3", params![titulo.trim(), autor.trim(), id])?;
        Ok(())
    }

    pub fn reordenar_documentos(&mut self, ids: &[String]) -> Result<(), ErrorBiblioteca> {
        let transaccion = self.conexion.transaction()?;
        for (orden, id) in ids.iter().enumerate() {
            transaccion.execute("UPDATE documentos SET orden = ?1 WHERE id = ?2", params![orden as i64, id])?;
        }
        transaccion.commit()?;
        Ok(())
    }

    pub fn eliminar_documento(&self, id: &str) -> Result<(), ErrorBiblioteca> {
        let documento = self.obtener_documento(id)?;
        let ruta = PathBuf::from(&documento.ruta);
        if !ruta.starts_with(&self.directorio_biblioteca) {
            return Err(ErrorBiblioteca::OperacionInvalida("El documento no pertenece a la Biblioteca".to_string()));
        }
        if ruta.is_file() { fs::remove_file(ruta)?; }
        self.eliminar_registro_documento(id)
    }

    fn eliminar_registro_documento(&self, id: &str) -> Result<(), ErrorBiblioteca> {
        self.conexion.execute("DELETE FROM fragmentos_guardados WHERE documento_id = ?1", [id])?;
        self.conexion.execute("DELETE FROM notas_documento WHERE documento_id = ?1", [id])?;
        self.conexion.execute("DELETE FROM cache_documentos WHERE documento_id = ?1", [id])?;
        self.conexion.execute("DELETE FROM documentos WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn guardar_cache_documento(&self, documento_id: &str, contenido: &str) -> Result<(), ErrorBiblioteca> {
        self.conexion.execute(
            "INSERT INTO cache_documentos (documento_id, contenido, actualizado) VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(documento_id) DO UPDATE SET contenido = excluded.contenido, actualizado = CURRENT_TIMESTAMP",
            params![documento_id, contenido],
        )?;
        Ok(())
    }

    pub fn leer_cache_documento(&self, documento_id: &str) -> Result<Option<String>, ErrorBiblioteca> {
        match self.conexion.query_row("SELECT contenido FROM cache_documentos WHERE documento_id = ?1", [documento_id], |fila| fila.get(0)) {
            Ok(contenido) => Ok(Some(contenido)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(ErrorBiblioteca::from(error)),
        }
    }

    pub fn guardar_fragmento(&self, fragmento: &FragmentoGuardado) -> Result<(), ErrorBiblioteca> {
        let ancla_json = fragmento.ancla.as_ref().map(serde_json::to_string).transpose()?;
        self.conexion.execute(
            "INSERT OR REPLACE INTO fragmentos_guardados (id, documento_id, texto, indice_fragmento, creado, destacado, ancla_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![fragmento.id, fragmento.documento_id, fragmento.texto, fragmento.indice_fragmento, fragmento.creado, fragmento.destacado, ancla_json],
        )?;
        Ok(())
    }

    pub fn listar_fragmentos(&self, documento_id: &str) -> Result<Vec<FragmentoGuardado>, ErrorBiblioteca> {
        let mut consulta = self.conexion.prepare(
            "SELECT id, documento_id, texto, indice_fragmento, creado, destacado, ancla_json FROM fragmentos_guardados WHERE documento_id = ?1 ORDER BY indice_fragmento, creado",
        )?;
        let filas = consulta.query_map([documento_id], |fila| Ok(FragmentoGuardado {
            id: fila.get(0)?, documento_id: fila.get(1)?, texto: fila.get(2)?, indice_fragmento: fila.get(3)?, creado: fila.get(4)?, destacado: fila.get(5)?,
            ancla: fila.get::<_, Option<String>>(6)?.and_then(|valor| serde_json::from_str(&valor).ok()),
        }))?;
        filas.collect::<Result<Vec<_>, _>>().map_err(ErrorBiblioteca::from)
    }

    pub fn eliminar_fragmento(&self, id: &str) -> Result<(), ErrorBiblioteca> {
        self.conexion.execute("UPDATE notas_documento SET fragmento_id = NULL WHERE fragmento_id = ?1", [id])?;
        self.conexion.execute("DELETE FROM fragmentos_guardados WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn cambiar_destacado_fragmento(&self, id: &str, destacado: bool) -> Result<(), ErrorBiblioteca> {
        self.conexion.execute("UPDATE fragmentos_guardados SET destacado = ?1 WHERE id = ?2", params![destacado, id])?;
        Ok(())
    }

    pub fn guardar_nota(&self, nota: &NotaDocumento) -> Result<(), ErrorBiblioteca> {
        let ancla_json = nota.ancla.as_ref().map(serde_json::to_string).transpose()?;
        self.conexion.execute(
            "INSERT OR REPLACE INTO notas_documento (id, documento_id, texto, creado, fragmento_id, pagina, ancla_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![nota.id, nota.documento_id, nota.texto, nota.creado, nota.fragmento_id, nota.pagina, ancla_json],
        )?;
        Ok(())
    }

    pub fn listar_notas(&self, documento_id: &str) -> Result<Vec<NotaDocumento>, ErrorBiblioteca> {
        let mut consulta = self.conexion.prepare(
            "SELECT id, documento_id, texto, creado, fragmento_id, pagina, ancla_json FROM notas_documento WHERE documento_id = ?1 ORDER BY creado, id",
        )?;
        let filas = consulta.query_map([documento_id], |fila| Ok(NotaDocumento {
            id: fila.get(0)?, documento_id: fila.get(1)?, texto: fila.get(2)?, creado: fila.get(3)?, fragmento_id: fila.get(4)?, pagina: fila.get(5)?,
            ancla: fila.get::<_, Option<String>>(6)?.and_then(|valor| serde_json::from_str(&valor).ok()),
        }))?;
        filas.collect::<Result<Vec<_>, _>>().map_err(ErrorBiblioteca::from)
    }

    pub fn eliminar_nota(&self, id: &str) -> Result<(), ErrorBiblioteca> {
        self.conexion.execute("DELETE FROM notas_documento WHERE id = ?1", [id])?;
        Ok(())
    }

    fn contar_carpetas(&self) -> Result<i64, ErrorBiblioteca> {
        self.conexion.query_row("SELECT COUNT(*) FROM carpetas", [], |fila| fila.get(0)).map_err(ErrorBiblioteca::from)
    }

    pub fn guardar_progreso(&self, id_documento: &str, progreso: f64, estado_lectura: &EstadoLecturaDocumento) -> Result<(), ErrorBiblioteca> {
        let progreso_limitado = progreso.clamp(0.0, 100.0);
        let estado_json = serde_json::to_string(estado_lectura)?;
        self.conexion.execute(
            "UPDATE documentos SET progreso = ?1, ultima_lectura = datetime('now'), estado_lectura_json = ?2 WHERE id = ?3",
            params![progreso_limitado, estado_json, id_documento],
        )?;
        Ok(())
    }

    pub fn leer_documento(&self, id_documento: &str) -> Result<Vec<u8>, ErrorBiblioteca> {
        let ruta: String = self.conexion.query_row(
            "SELECT ruta FROM documentos WHERE id = ?1",
            [id_documento],
            |fila| fila.get(0),
        )?;
        let (ruta_validada, _) = validar_ruta_documento(&ruta)?;
        fs::read(ruta_validada).map_err(ErrorBiblioteca::from)
    }

    fn obtener_documento_por_ruta(&self, ruta: &str) -> Result<Documento, ErrorBiblioteca> {
        self.conexion.query_row(
            "SELECT id, titulo, autor, formato, ruta, progreso, ultima_lectura, carpeta_id, orden, estado_lectura_json FROM documentos WHERE ruta = ?1",
            [ruta], convertir_fila_documento,
        ).map_err(ErrorBiblioteca::from)
    }

    fn obtener_documento(&self, id: &str) -> Result<Documento, ErrorBiblioteca> {
        self.conexion.query_row(
            "SELECT id, titulo, autor, formato, ruta, progreso, ultima_lectura, carpeta_id, orden, estado_lectura_json FROM documentos WHERE id = ?1",
            [id], convertir_fila_documento,
        ).map_err(ErrorBiblioteca::from)
    }

    fn carpeta_para_ruta(&self, ruta: &Path) -> Result<Option<String>, ErrorBiblioteca> {
        let padre = ruta.parent().unwrap_or(&self.directorio_biblioteca);
        if padre == self.directorio_biblioteca { return Ok(None); }
        let ruta_padre = padre.to_string_lossy().to_string();
        match self.conexion.query_row("SELECT id FROM carpetas WHERE ruta = ?1", [&ruta_padre], |fila| fila.get(0)) {
            Ok(id) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(ErrorBiblioteca::from(error)),
        }
    }

    fn obtener_carpeta_por_ruta(&self, ruta: &str) -> Result<Carpeta, ErrorBiblioteca> {
        self.conexion.query_row(
            "SELECT id, nombre, orden, ruta FROM carpetas WHERE ruta = ?1",
            [ruta],
            |fila| Ok(Carpeta { id: fila.get(0)?, nombre: fila.get(1)?, orden: fila.get(2)?, ruta: fila.get(3)? }),
        ).map_err(ErrorBiblioteca::from)
    }
}

fn convertir_fila_documento(fila: &rusqlite::Row<'_>) -> rusqlite::Result<Documento> {
    Ok(Documento {
        id: fila.get(0)?, titulo: fila.get(1)?, autor: fila.get(2)?, formato: fila.get(3)?,
        ruta: fila.get(4)?, progreso: fila.get(5)?, ultima_lectura: fila.get(6)?, carpeta_id: fila.get(7)?, orden: fila.get(8)?,
        estado_lectura: fila.get::<_, Option<String>>(9)?.and_then(|valor| serde_json::from_str(&valor).ok()),
    })
}

fn calcular_hash_ruta(ruta: &str) -> u64 {
    ruta.bytes().fold(14_695_981_039_346_656_037, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(1_099_511_628_211))
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use std::fs;

    #[test]
    fn importa_pdf_sin_mover_original() {
        let directorio = std::env::temp_dir().join(format!("lector-prueba-{}", std::process::id()));
        fs::create_dir_all(&directorio).expect("crear temporal");
        let ruta_pdf = directorio.join("Analisis.pdf");
        fs::write(&ruta_pdf, b"%PDF-1.7").expect("crear fixture");
        let repositorio = abrir_base_datos(&directorio.join("prueba.db")).expect("abrir base");

        let documento = repositorio.importar_documento(ruta_pdf.to_str().expect("ruta UTF-8")).expect("importar");

        assert_eq!(documento.formato, "PDF");
        assert!(ruta_pdf.exists());
        assert!(Path::new(&documento.ruta).starts_with(directorio.join("Biblioteca").canonicalize().expect("canonicalizar Biblioteca")));
        assert!(Path::new(&documento.ruta).is_file());
        assert_eq!(repositorio.leer_documento(&documento.id).expect("leer PDF"), b"%PDF-1.7");
        let otro_origen = directorio.join("otro");
        fs::create_dir(&otro_origen).expect("crear segundo origen");
        let mismo_nombre = otro_origen.join("Analisis.pdf");
        fs::write(&mismo_nombre, b"%PDF-2.0").expect("crear PDF homónimo");
        let segundo = repositorio.importar_documento(mismo_nombre.to_str().expect("ruta UTF-8")).expect("importar homónimo");
        assert_ne!(documento.ruta, segundo.ruta);
        assert_eq!(repositorio.leer_documento(&segundo.id).expect("leer segundo PDF"), b"%PDF-2.0");
        fs::remove_dir_all(directorio).expect("limpiar temporal");
    }

    #[test]
    fn rechaza_formato_no_admitido() {
        let directorio = std::env::temp_dir().join(format!("lector-formato-{}", std::process::id()));
        fs::create_dir_all(&directorio).expect("crear temporal");
        let ruta_txt = directorio.join("documento.txt");
        fs::write(&ruta_txt, b"texto").expect("crear fixture");

        let error = validar_ruta_documento(ruta_txt.to_str().expect("ruta UTF-8")).expect_err("debe fallar");

        assert!(matches!(error, ErrorBiblioteca::FormatoInvalido(_)));
        fs::remove_dir_all(directorio).expect("limpiar temporal");
    }

    #[test]
    fn importa_markdown_y_lo_descubre_en_carpetas() {
        let directorio = std::env::temp_dir().join(format!("lector-markdown-{}", std::process::id()));
        fs::create_dir_all(&directorio).expect("crear temporal");
        let ruta_markdown = directorio.join("Apunte.MD");
        fs::write(&ruta_markdown, "# Álgebra\n").expect("crear Markdown");
        let repositorio = abrir_base_datos(&directorio.join("prueba.db")).expect("abrir base");

        let documento = repositorio.importar_documento(ruta_markdown.to_str().expect("ruta UTF-8")).expect("importar Markdown");
        let encontrados = descubrir_documentos_directorio(&directorio).expect("descubrir Markdown");

        assert_eq!(documento.formato, "MARKDOWN");
        assert_eq!(repositorio.leer_documento(&documento.id).expect("leer Markdown"), "# Álgebra\n".as_bytes());
        assert!(encontrados.iter().any(|ruta| ruta.ends_with("Apunte.MD")));
        fs::remove_dir_all(directorio).expect("limpiar temporal");
    }

    #[test]
    fn migra_biblioteca_anterior_sin_perder_documentos() {
        let directorio = std::env::temp_dir().join(format!("lector-migracion-markdown-{}", std::process::id()));
        fs::create_dir_all(&directorio).expect("crear temporal");
        let ruta_db = directorio.join("prueba.db");
        let ruta_pdf = directorio.join("existente.pdf");
        let ruta_md = directorio.join("nuevo.md");
        fs::write(&ruta_pdf, b"%PDF").expect("crear PDF");
        fs::write(&ruta_md, b"# Nuevo").expect("crear Markdown");
        let conexion = Connection::open(&ruta_db).expect("abrir DB anterior");
        conexion.execute_batch(
            "CREATE TABLE documentos (
               id TEXT PRIMARY KEY, titulo TEXT NOT NULL, autor TEXT NOT NULL DEFAULT '',
               formato TEXT NOT NULL CHECK(formato IN ('PDF', 'EPUB')), ruta TEXT NOT NULL UNIQUE,
               progreso REAL NOT NULL DEFAULT 0, ultima_lectura TEXT, carpeta_id TEXT,
               orden INTEGER NOT NULL DEFAULT 0, estado_lectura_json TEXT
             );",
        ).expect("crear esquema anterior");
        conexion.execute(
            "INSERT INTO documentos (id, titulo, formato, ruta) VALUES ('anterior', 'Existente', 'PDF', ?1)",
            [ruta_pdf.to_string_lossy().to_string()],
        ).expect("guardar documento anterior");
        drop(conexion);

        let repositorio = abrir_base_datos(&ruta_db).expect("migrar base");
        repositorio.importar_documento(ruta_md.to_str().expect("ruta UTF-8")).expect("importar Markdown");
        let documentos = repositorio.listar_documentos().expect("listar después de migrar");

        assert_eq!(documentos.len(), 1);
        assert!(ruta_pdf.exists());
        assert!(documentos.iter().any(|documento| documento.formato == "MARKDOWN"));
        fs::remove_dir_all(directorio).expect("limpiar temporal");
    }

    #[test]
    fn descubre_documentos_compatibles_en_subcarpetas() {
        let directorio = std::env::temp_dir().join(format!("carlector-carpeta-{}", std::process::id()));
        let subcarpeta = directorio.join("subcarpeta");
        fs::create_dir_all(&subcarpeta).expect("crear temporal");
        fs::write(directorio.join("uno.pdf"), b"%PDF").expect("crear PDF");
        fs::write(subcarpeta.join("dos.EPUB"), b"EPUB").expect("crear EPUB");
        fs::write(subcarpeta.join("ignorar.txt"), b"texto").expect("crear TXT");

        let rutas = descubrir_documentos_directorio(&directorio).expect("descubrir documentos");

        assert_eq!(rutas.len(), 2);
        assert!(rutas.iter().all(|ruta| ruta.ends_with(".pdf") || ruta.ends_with(".EPUB")));
        fs::remove_dir_all(directorio).expect("limpiar temporal");
    }

    #[test]
    fn organiza_y_elimina_copia_sin_borrar_original() {
        let directorio = std::env::temp_dir().join(format!("carlector-organizacion-{}", std::process::id()));
        fs::create_dir_all(&directorio).expect("crear temporal");
        let ruta_pdf = directorio.join("libro.pdf");
        fs::write(&ruta_pdf, b"%PDF").expect("crear PDF");
        let repositorio = abrir_base_datos(&directorio.join("prueba.db")).expect("abrir base");
        let documento = repositorio.importar_documento(ruta_pdf.to_str().expect("ruta UTF-8")).expect("importar");
        let carpeta = repositorio.crear_carpeta("Matemáticas").expect("crear carpeta");

        let movido = repositorio.mover_documento(&documento.id, Some(&carpeta.id)).expect("mover");
        assert_eq!(movido.carpeta_id.as_deref(), Some(carpeta.id.as_str()));
        assert!(Path::new(&movido.ruta).starts_with(Path::new(carpeta.ruta.as_deref().expect("ruta física"))));
        let fragmento = FragmentoGuardado { id: "marca-1".to_string(), documento_id: documento.id.clone(), texto: "texto elegido".to_string(), indice_fragmento: 3, creado: "2026-08-20T10:00:00Z".to_string(), destacado: true, ancla: None };
        repositorio.guardar_fragmento(&fragmento).expect("guardar fragmento");
        assert_eq!(repositorio.listar_fragmentos(&documento.id).expect("listar fragmentos"), vec![fragmento]);
        repositorio.cambiar_destacado_fragmento("marca-1", false).expect("quitar destacado");
        assert!(!repositorio.listar_fragmentos(&documento.id).expect("listar sin destacado")[0].destacado);
        repositorio.guardar_cache_documento(&documento.id, r#"{"titulo":"Libro","bloques":[]}"#).expect("guardar cache");
        assert_eq!(repositorio.leer_cache_documento(&documento.id).expect("leer cache").as_deref(), Some(r#"{"titulo":"Libro","bloques":[]}"#));
        repositorio.eliminar_documento(&documento.id).expect("desvincular");
        assert!(ruta_pdf.exists());
        assert!(!Path::new(&movido.ruta).exists());
        assert!(repositorio.listar_documentos().expect("listar vacío").is_empty());
        assert!(repositorio.listar_fragmentos(&documento.id).expect("sin fragmentos huérfanos").is_empty());
        fs::remove_dir_all(directorio).expect("limpiar temporal");
    }

    #[test]
    fn guarda_y_recupera_estado_lectura_exacto() {
        let directorio = std::env::temp_dir().join(format!("carlector-progreso-{}", std::process::id()));
        fs::create_dir_all(&directorio).expect("crear temporal");
        let ruta_pdf = directorio.join("libro.pdf");
        fs::write(&ruta_pdf, b"%PDF").expect("crear PDF");
        let repositorio = abrir_base_datos(&directorio.join("prueba.db")).expect("abrir base");
        let documento = repositorio.importar_documento(ruta_pdf.to_str().expect("ruta UTF-8")).expect("importar");
        let estado = EstadoLecturaDocumento {
            indice_fragmento: 17,
            pagina: 4,
            indice_unidad: 2,
            desplazamiento: 815.5,
            modo_visual_pdf: "original".to_string(),
            componentes: EstadoPanelesLectura { biblioteca: false, inspector: true, controles: false },
        };

        repositorio.guardar_progreso(&documento.id, 42.0, &estado).expect("guardar progreso");
        let recuperado = repositorio.listar_documentos().expect("listar").remove(0);

        assert_eq!(recuperado.progreso, 42.0);
        assert_eq!(recuperado.estado_lectura, Some(estado));
        fs::remove_dir_all(directorio).expect("limpiar temporal");
    }

    #[test]
    fn guarda_lista_y_elimina_notas_asociadas_al_documento() {
        let directorio = std::env::temp_dir().join(format!("carlector-notas-{}", std::process::id()));
        fs::create_dir_all(&directorio).expect("crear temporal");
        let ruta_pdf = directorio.join("libro.pdf");
        fs::write(&ruta_pdf, b"%PDF").expect("crear PDF");
        let repositorio = abrir_base_datos(&directorio.join("prueba.db")).expect("abrir base");
        let documento = repositorio.importar_documento(ruta_pdf.to_str().expect("ruta UTF-8")).expect("importar");
        let nota = NotaDocumento { id: "nota-1".to_string(), documento_id: documento.id.clone(), texto: "Idea propia".to_string(), creado: "2026-08-28T10:00:00Z".to_string(), fragmento_id: None, pagina: None, ancla: None };

        repositorio.guardar_nota(&nota).expect("guardar nota");
        assert_eq!(repositorio.listar_notas(&documento.id).expect("listar notas"), vec![nota]);
        repositorio.eliminar_nota("nota-1").expect("eliminar nota");
        assert!(repositorio.listar_notas(&documento.id).expect("sin notas").is_empty());
        fs::remove_dir_all(directorio).expect("limpiar temporal");
    }

    #[test]
    fn prepara_notas_para_vincular_fragmento_pagina_y_ancla() {
        let directorio = std::env::temp_dir().join(format!("carlector-notas-vinculadas-{}", std::process::id()));
        fs::create_dir_all(&directorio).expect("crear temporal");
        let repositorio = abrir_base_datos(&directorio.join("prueba.db")).expect("abrir base");
        let ruta_pdf = directorio.join("cientifico.pdf");
        fs::write(&ruta_pdf, b"%PDF").expect("crear PDF");
        let documento = repositorio.importar_documento(ruta_pdf.to_str().expect("ruta UTF-8")).expect("importar");
        let ancla = AnclaFragmento { bloque_id: "bloque-7".to_string(), inicio: 12, fin: 48 };
        let fragmento = FragmentoGuardado { id: "fragmento-7".to_string(), documento_id: documento.id.clone(), texto: "Texto científico".to_string(), indice_fragmento: 7, creado: "2026-08-28T10:00:00Z".to_string(), destacado: true, ancla: Some(ancla.clone()) };
        repositorio.guardar_fragmento(&fragmento).expect("guardar fragmento");
        let nota = NotaDocumento { id: "nota-7".to_string(), documento_id: documento.id.clone(), texto: "Relacionar con α".to_string(), creado: "2026-08-28T11:00:00Z".to_string(), fragmento_id: Some(fragmento.id.clone()), pagina: Some(7), ancla: Some(ancla.clone()) };

        repositorio.guardar_nota(&nota).expect("guardar nota vinculada");
        assert_eq!(repositorio.listar_notas(&documento.id).expect("listar notas"), vec![nota]);
        repositorio.eliminar_fragmento(&fragmento.id).expect("eliminar fragmento");
        let nota_sin_fragmento = repositorio.listar_notas(&documento.id).expect("listar nota conservada").remove(0);
        assert_eq!(nota_sin_fragmento.fragmento_id, None);
        assert_eq!(nota_sin_fragmento.pagina, Some(7));
        assert_eq!(nota_sin_fragmento.ancla, Some(ancla));
        fs::remove_dir_all(directorio).expect("limpiar temporal");
    }

    #[test]
    fn crea_mueve_y_renombra_en_biblioteca_real() {
        let directorio = std::env::temp_dir().join(format!("carlector-biblioteca-real-{}", std::process::id()));
        fs::create_dir_all(&directorio).expect("crear temporal");
        let origen = directorio.join("uno.pdf");
        fs::write(&origen, b"%PDF").expect("crear PDF");
        let repositorio = abrir_base_datos(&directorio.join("prueba.db")).expect("abrir base");
        let documento = repositorio.importar_documento(origen.to_str().expect("ruta UTF-8")).expect("importar");
        let copia_inicial = PathBuf::from(&documento.ruta);
        let carpeta = repositorio.crear_carpeta("Ciencias").expect("crear carpeta");
        let movido = repositorio.mover_documento(&documento.id, Some(&carpeta.id)).expect("mover físicamente");
        let renombrado = repositorio.renombrar_documento(&documento.id, "Teoría final").expect("renombrar archivo");
        let carpeta_renombrada = repositorio.renombrar_carpeta(&carpeta.id, "Investigación").expect("renombrar carpeta");
        let actualizado = repositorio.obtener_documento(&documento.id).expect("documento actualizado");

        assert!(origen.exists());
        assert!(!copia_inicial.exists());
        assert!(!Path::new(&movido.ruta).exists());
        assert_eq!(Path::new(&renombrado.ruta).file_name().and_then(|valor| valor.to_str()), Some("Teoría final.pdf"));
        assert!(Path::new(&actualizado.ruta).is_file());
        assert!(Path::new(&actualizado.ruta).starts_with(carpeta_renombrada.ruta.as_deref().expect("ruta carpeta")));
        fs::remove_dir_all(directorio).expect("limpiar temporal");
    }

    #[test]
    fn sincroniza_cambios_hechos_desde_finder() {
        let directorio = std::env::temp_dir().join(format!("carlector-sincronizacion-real-{}", std::process::id()));
        fs::create_dir_all(&directorio).expect("crear temporal");
        let repositorio = abrir_base_datos(&directorio.join("prueba.db")).expect("abrir base");
        let carpeta = directorio.join("Biblioteca").join("Ciencia");
        fs::create_dir(&carpeta).expect("crear carpeta desde Finder");
        let original = carpeta.join("artículo.md");
        fs::write(&original, "# Ciencia").expect("crear archivo desde Finder");

        repositorio.sincronizar_biblioteca().expect("sincronizar alta");
        let inicial = repositorio.listar_documentos().expect("listar");
        let renombrado = carpeta.join("artículo revisado.md");
        fs::rename(&original, &renombrado).expect("renombrar desde Finder");
        repositorio.sincronizar_biblioteca().expect("sincronizar renombre");
        let finalizados = repositorio.listar_documentos().expect("listar final");

        assert_eq!(inicial.len(), 1);
        assert_eq!(finalizados.len(), 1);
        assert!(finalizados[0].ruta.ends_with("artículo revisado.md"));
        assert!(finalizados[0].carpeta_id.is_some());
        fs::remove_dir_all(directorio).expect("limpiar temporal");
    }

    #[test]
    fn rechaza_nombres_peligrosos_y_eliminar_carpetas_con_contenido() {
        let directorio = std::env::temp_dir().join(format!("carlector-limites-biblioteca-{}", std::process::id()));
        fs::create_dir_all(&directorio).expect("crear temporal");
        let repositorio = abrir_base_datos(&directorio.join("prueba.db")).expect("abrir base");
        assert!(repositorio.crear_carpeta("../fuera").is_err());
        let carpeta = repositorio.crear_carpeta("Dentro").expect("crear carpeta");
        fs::write(Path::new(carpeta.ruta.as_deref().expect("ruta")).join("ocupado.pdf"), b"%PDF").expect("crear contenido");
        assert!(repositorio.eliminar_carpeta(&carpeta.id).is_err());
        fs::remove_dir_all(directorio).expect("limpiar temporal");
    }
}
