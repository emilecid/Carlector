use tauri::App;

#[cfg(target_os = "macos")]
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder,
};

#[cfg(target_os = "macos")]
const ID_MENU_PREFERENCIAS: &str = "abrir-preferencias";
#[cfg(target_os = "macos")]
pub(super) const ETIQUETA_VENTANA_PREFERENCIAS: &str = "preferencias";

#[cfg(target_os = "macos")]
fn abrir_ventana_preferencias<R: Runtime>(aplicacion: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(ventana) = aplicacion.get_webview_window(ETIQUETA_VENTANA_PREFERENCIAS) {
        ventana.unminimize()?;
        ventana.show()?;
        ventana.set_focus()?;
        return Ok(());
    }

    let ventana = WebviewWindowBuilder::new(
        aplicacion,
        ETIQUETA_VENTANA_PREFERENCIAS,
        WebviewUrl::App("index.html?preferencias=1".into()),
    )
    .title("Configuración — Carlector")
    .inner_size(720.0, 780.0)
    .min_inner_size(560.0, 620.0)
    .resizable(true)
    .center()
    .build()?;
    ventana.show()?;
    ventana.set_focus()?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub(super) fn instalar_menu(aplicacion: &mut App) -> tauri::Result<()> {
    let preferencias = MenuItemBuilder::with_id(ID_MENU_PREFERENCIAS, "Configuración…")
        .accelerator("CmdOrCtrl+,")
        .build(aplicacion)?;
    let menu_aplicacion = SubmenuBuilder::new(aplicacion, "Carlector")
        .about(None)
        .separator()
        .item(&preferencias)
        .separator()
        .services()
        .separator()
        .hide_with_text("Ocultar Carlector")
        .hide_others_with_text("Ocultar las demás")
        .show_all_with_text("Mostrar todo")
        .separator()
        .quit_with_text("Salir de Carlector")
        .build()?;
    let menu_edicion = SubmenuBuilder::new(aplicacion, "Edición")
        .undo_with_text("Deshacer")
        .redo_with_text("Rehacer")
        .separator()
        .cut_with_text("Cortar")
        .copy_with_text("Copiar")
        .paste_with_text("Pegar")
        .select_all_with_text("Seleccionar todo")
        .build()?;
    let menu_ventana = SubmenuBuilder::new(aplicacion, "Ventana")
        .minimize_with_text("Minimizar")
        .close_window_with_text("Cerrar ventana")
        .separator()
        .fullscreen_with_text("Pantalla completa")
        .separator()
        .bring_all_to_front_with_text("Traer todo al frente")
        .build()?;
    let menu = MenuBuilder::new(aplicacion)
        .items(&[&menu_aplicacion, &menu_edicion, &menu_ventana])
        .build()?;
    aplicacion.set_menu(menu)?;
    aplicacion.on_menu_event(|manejador, evento| {
        if evento.id().as_ref() == ID_MENU_PREFERENCIAS {
            if let Err(error) = abrir_ventana_preferencias(manejador) {
                eprintln!("No fue posible abrir Configuración: {error}");
            }
        }
    });
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(super) fn instalar_menu(_aplicacion: &mut App) -> tauri::Result<()> {
    Ok(())
}
