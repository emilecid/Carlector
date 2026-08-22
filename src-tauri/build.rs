fn main() {
    // Recompila los recursos frontend integrados cuando cambia la aplicación.
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build()
}
