use carlector_lib::markdown::extraer_markdown;

#[test]
fn extrae_bloques_semanticos_sin_html_activo() {
    let fuente = r#"# Álgebra lineal

Texto con **tildes** y una cita [1].

> Fragmento citado.

$$x^2 + y^2 = z^2$$

<script>alert('no')</script>
"#;

    let documento = extraer_markdown(fuente, "apunte.md");

    assert_eq!(documento.titulo, "Álgebra lineal");
    assert_eq!(documento.formato, "MARKDOWN");
    assert!(documento.bloques.iter().any(|bloque| bloque.estructura == "cita" && bloque.contenido == "Fragmento citado."));
    assert!(documento.bloques.iter().any(|bloque| bloque.estructura == "matematica" && bloque.contenido.contains("x^2")));
    assert!(!documento.bloques.iter().any(|bloque| bloque.contenido.contains("script") || bloque.contenido.contains("alert")));
    assert!(documento.bloques.iter().all(|bloque| bloque.inicio_fuente < bloque.fin_fuente));
}

#[test]
fn usa_nombre_de_archivo_y_conserva_markdown_vacio() {
    let vacio = extraer_markdown("  \n", "notas.markdown");

    assert_eq!(vacio.titulo, "notas");
    assert!(vacio.bloques.is_empty());
}
