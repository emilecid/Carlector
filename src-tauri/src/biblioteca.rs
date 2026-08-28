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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnclaFragmento {
    pub bloque_id: String,
    pub inicio: i64,
    pub fin: i64,
}

pub struct RepositorioBiblioteca {
    conexion: Connection,
}

pub fn abrir_base_datos(ruta: &Path) -> Result<RepositorioBiblioteca, ErrorBiblioteca> {
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
           orden INTEGER NOT NULL DEFAULT 0
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
           creado TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    migrar_formato_markdown(&conexion)?;
    Ok(RepositorioBiblioteca { conexion })
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
        let ruta_canonica = ruta_archivo.canonicalize().unwrap_or(ruta_archivo);
        let titulo = ruta_canonica.file_stem().and_then(|nombre| nombre.to_str()).unwrap_or("Documento").to_string();
        let ruta_texto = ruta_canonica.to_string_lossy().to_string();
        let id = format!("documento-{:x}", calcular_hash_ruta(&ruta_texto));
        self.conexion.execute(
            "INSERT INTO documentos (id, titulo, formato, ruta) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(ruta) DO NOTHING",
            params![id, titulo, formato, ruta_texto],
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
        let nombre = nombre.trim();
        let id = format!("carpeta-{:x}", calcular_hash_ruta(&format!("{nombre}-{}", self.contar_carpetas()?)));
        let orden = self.contar_carpetas()?;
        self.conexion.execute("INSERT INTO carpetas (id, nombre, orden) VALUES (?1, ?2, ?3)", params![id, nombre, orden])?;
        Ok(Carpeta { id, nombre: nombre.to_string(), orden })
    }

    pub fn listar_carpetas(&self) -> Result<Vec<Carpeta>, ErrorBiblioteca> {
        let mut consulta = self.conexion.prepare("SELECT id, nombre, orden FROM carpetas ORDER BY orden, nombre COLLATE NOCASE")?;
        let filas = consulta.query_map([], |fila| Ok(Carpeta { id: fila.get(0)?, nombre: fila.get(1)?, orden: fila.get(2)? }))?;
        filas.collect::<Result<Vec<_>, _>>().map_err(ErrorBiblioteca::from)
    }

    pub fn renombrar_carpeta(&self, id: &str, nombre: &str) -> Result<(), ErrorBiblioteca> {
        self.conexion.execute("UPDATE carpetas SET nombre = ?1 WHERE id = ?2", params![nombre.trim(), id])?;
        Ok(())
    }

    pub fn eliminar_carpeta(&self, id: &str) -> Result<(), ErrorBiblioteca> {
        self.conexion.execute("UPDATE documentos SET carpeta_id = NULL WHERE carpeta_id = ?1", [id])?;
        self.conexion.execute("DELETE FROM carpetas WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn mover_documento(&self, id_documento: &str, carpeta_id: Option<&str>) -> Result<(), ErrorBiblioteca> {
        self.conexion.execute("UPDATE documentos SET carpeta_id = ?1 WHERE id = ?2", params![carpeta_id, id_documento])?;
        Ok(())
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
        self.conexion.execute("DELETE FROM fragmentos_guardados WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn cambiar_destacado_fragmento(&self, id: &str, destacado: bool) -> Result<(), ErrorBiblioteca> {
        self.conexion.execute("UPDATE fragmentos_guardados SET destacado = ?1 WHERE id = ?2", params![destacado, id])?;
        Ok(())
    }

    pub fn guardar_nota(&self, nota: &NotaDocumento) -> Result<(), ErrorBiblioteca> {
        self.conexion.execute(
            "INSERT OR REPLACE INTO notas_documento (id, documento_id, texto, creado) VALUES (?1, ?2, ?3, ?4)",
            params![nota.id, nota.documento_id, nota.texto, nota.creado],
        )?;
        Ok(())
    }

    pub fn listar_notas(&self, documento_id: &str) -> Result<Vec<NotaDocumento>, ErrorBiblioteca> {
        let mut consulta = self.conexion.prepare(
            "SELECT id, documento_id, texto, creado FROM notas_documento WHERE documento_id = ?1 ORDER BY creado, id",
        )?;
        let filas = consulta.query_map([documento_id], |fila| Ok(NotaDocumento {
            id: fila.get(0)?, documento_id: fila.get(1)?, texto: fila.get(2)?, creado: fila.get(3)?,
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
        assert_eq!(repositorio.leer_documento(&documento.id).expect("leer PDF"), b"%PDF-1.7");
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

        assert_eq!(documentos.len(), 2);
        assert!(documentos.iter().any(|documento| documento.id == "anterior" && documento.formato == "PDF"));
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
    fn organiza_y_desvincula_sin_borrar_original() {
        let directorio = std::env::temp_dir().join(format!("carlector-organizacion-{}", std::process::id()));
        fs::create_dir_all(&directorio).expect("crear temporal");
        let ruta_pdf = directorio.join("libro.pdf");
        fs::write(&ruta_pdf, b"%PDF").expect("crear PDF");
        let repositorio = abrir_base_datos(&directorio.join("prueba.db")).expect("abrir base");
        let documento = repositorio.importar_documento(ruta_pdf.to_str().expect("ruta UTF-8")).expect("importar");
        let carpeta = repositorio.crear_carpeta("Matemáticas").expect("crear carpeta");

        repositorio.mover_documento(&documento.id, Some(&carpeta.id)).expect("mover");
        assert_eq!(repositorio.listar_documentos().expect("listar")[0].carpeta_id.as_deref(), Some(carpeta.id.as_str()));
        let fragmento = FragmentoGuardado { id: "marca-1".to_string(), documento_id: documento.id.clone(), texto: "texto elegido".to_string(), indice_fragmento: 3, creado: "2026-08-20T10:00:00Z".to_string(), destacado: true, ancla: None };
        repositorio.guardar_fragmento(&fragmento).expect("guardar fragmento");
        assert_eq!(repositorio.listar_fragmentos(&documento.id).expect("listar fragmentos"), vec![fragmento]);
        repositorio.cambiar_destacado_fragmento("marca-1", false).expect("quitar destacado");
        assert!(!repositorio.listar_fragmentos(&documento.id).expect("listar sin destacado")[0].destacado);
        repositorio.guardar_cache_documento(&documento.id, r#"{"titulo":"Libro","bloques":[]}"#).expect("guardar cache");
        assert_eq!(repositorio.leer_cache_documento(&documento.id).expect("leer cache").as_deref(), Some(r#"{"titulo":"Libro","bloques":[]}"#));
        repositorio.eliminar_documento(&documento.id).expect("desvincular");
        assert!(ruta_pdf.exists());
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
        let nota = NotaDocumento { id: "nota-1".to_string(), documento_id: documento.id.clone(), texto: "Idea propia".to_string(), creado: "2026-08-28T10:00:00Z".to_string() };

        repositorio.guardar_nota(&nota).expect("guardar nota");
        assert_eq!(repositorio.listar_notas(&documento.id).expect("listar notas"), vec![nota]);
        repositorio.eliminar_nota("nota-1").expect("eliminar nota");
        assert!(repositorio.listar_notas(&documento.id).expect("sin notas").is_empty());
        fs::remove_dir_all(directorio).expect("limpiar temporal");
    }
}
