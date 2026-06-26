// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Force the GTK/WebKitGTK backend to use XWayland on Linux. Under native
    // Wayland (e.g. KWin) the window's input region is not committed until a
    // resize, leaving the title bar controls unresponsive until the window is
    // maximized. Only set it when the user hasn't picked a backend themselves.
    #[cfg(target_os = "linux")]
    if std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    scratch_lib::run()
}
