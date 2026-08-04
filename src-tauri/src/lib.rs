use anyhow::Result;
use base64::Engine;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::*;
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl};
use tauri::webview::{WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio::fs;
use tokio::io::AsyncWriteExt;

mod git;
mod persistence;
mod draft_checkpoint;
mod watcher_debounce;
mod hashing;

use watcher_debounce::{WatcherDebounce, WATCHER_DEBOUNCE_WINDOW};

#[cfg(test)]
mod note_persistence_tests;

// Note metadata for list display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMetadata {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub modified: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliStatus {
    pub supported: bool,
    pub installed: bool,
    pub path: Option<String>,
}

// Full note content
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub path: String,
    pub modified: i64,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteConflictSnapshot {
    pub content: String,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum NoteSaveResult {
    Saved { note: Note },
    Conflict { current: Option<NoteConflictSnapshot> },
}

// Theme color customization
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeColors {
    pub bg: Option<String>,
    pub bg_secondary: Option<String>,
    pub bg_muted: Option<String>,
    pub bg_emphasis: Option<String>,
    pub text: Option<String>,
    pub text_muted: Option<String>,
    pub text_inverse: Option<String>,
    pub border: Option<String>,
    pub accent: Option<String>,
}

// Theme settings
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSettings {
    pub mode: String, // "light" | "dark" | "system"
    pub custom_light_colors: Option<ThemeColors>,
    pub custom_dark_colors: Option<ThemeColors>,
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            mode: "system".to_string(),
            custom_light_colors: None,
            custom_dark_colors: None,
        }
    }
}

// Editor font settings (simplified)
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorFontSettings {
    pub base_font_family: Option<String>, // "system-sans" | "serif" | "monospace"
    pub base_font_size: Option<f32>,      // in px, default 16
    pub bold_weight: Option<i32>,         // 600, 700, 800 for headings and bold
    pub line_height: Option<f32>,         // default 1.6
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TextDirection {
    Auto,
    Ltr,
    Rtl,
}

// App config (stored in app data directory - just the notes folder path)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub notes_folder: Option<String>,
    #[serde(default)]
    pub workspaces: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub global_settings: Option<GlobalSettings>,
    #[serde(default, rename = "windowSessions", alias = "records")]
    pub records: HashMap<String, WindowSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowSession {
    pub workspace: String,
    pub selected_note_id: Option<String>,
    pub sidebar_visible: bool,
    pub focus_mode: bool,
    pub geometry: Option<WindowGeometry>,
}

impl WindowSession {
    fn for_workspace(workspace: String) -> Self {
        Self {
            workspace,
            selected_note_id: None,
            sidebar_visible: true,
            focus_mode: false,
            geometry: None,
        }
    }
}

fn upsert_window_session_workspace(
    config: &mut AppConfig,
    label: &str,
    workspace: String,
) {
    config
        .records
        .entry(label.to_string())
        .and_modify(|record| record.workspace = workspace.clone())
        .or_insert_with(|| WindowSession::for_workspace(workspace));
}

fn remove_window_session_on_destroy(
    config: &mut AppConfig,
    label: &str,
    is_quitting: bool,
    preserve_for_preview: bool,
) -> bool {
    !is_quitting && !preserve_for_preview && config.records.remove(label).is_some()
}

fn restorable_window_sessions(
    config: &AppConfig,
    standalone_preview: bool,
    workspace_is_available: impl Fn(&str) -> bool,
) -> Vec<(String, WindowSession)> {
    if standalone_preview {
        return Vec::new();
    }

    let mut records: Vec<_> = config
        .records
        .iter()
        .filter(|(label, record)| {
            label.to_string() != "preferences"
                && !label.starts_with("preview-")
                && workspace_is_available(&record.workspace)
        })
        .map(|(label, record)| (label.clone(), record.clone()))
        .collect();
    records.sort_by(|(left, _), (right, _)| {
        (left != "main", left).cmp(&(right != "main", right))
    });
    records
}

fn fallback_main_session(
    config: &AppConfig,
    default_workspace: Option<&str>,
    standalone_preview: bool,
    main_restored: bool,
    workspace_is_available: impl Fn(&str) -> bool,
) -> Option<WindowSession> {
    if standalone_preview || main_restored {
        return None;
    }

    let workspace = default_workspace?.to_string();
    if !workspace_is_available(&workspace) {
        return None;
    }

    let mut fallback = config
        .records
        .get("main")
        .cloned()
        .unwrap_or_else(|| WindowSession::for_workspace(workspace.clone()));
    if fallback.workspace != workspace {
        fallback.selected_note_id = None;
    }
    fallback.workspace = workspace;
    Some(fallback)
}

fn remember_workspace(config: &mut AppConfig, path: String) {
    if !config.workspaces.iter().any(|workspace| workspace == &path) {
        config.workspaces.push(path);
    }
}

fn workspace_is_remembered(config: &AppConfig, path: &str) -> bool {
    config.notes_folder.as_deref() == Some(path)
        || config.workspaces.iter().any(|workspace| workspace == path)
}

/// Forget only Scratch's reference to a workspace. No filesystem operation is
/// performed, so notes and folders on disk remain untouched.
fn forget_workspace(config: &mut AppConfig, path: &str) -> bool {
    if !workspace_is_remembered(config, path) {
        return false;
    }

    config.workspaces.retain(|workspace| workspace != path);
    if config.notes_folder.as_deref() == Some(path) {
        config.notes_folder = config.workspaces.first().cloned();
    }
    config.records.retain(|_, record| record.workspace != path);
    true
}

static WORKSPACE_WINDOW_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static RECOVERY_SNAPSHOT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct NativeNewWindowMenuSpec {
    parent_menu: &'static str,
    id: &'static str,
    label: &'static str,
    accelerator: &'static str,
}

fn native_new_window_menu_spec() -> NativeNewWindowMenuSpec {
    NativeNewWindowMenuSpec {
        parent_menu: "File",
        id: "new-window",
        label: "New Window",
        accelerator: "CmdOrCtrl+Shift+N",
    }
}

fn native_open_folder_menu_spec() -> NativeNewWindowMenuSpec {
    NativeNewWindowMenuSpec {
        parent_menu: "File",
        id: "open-folder",
        label: "Open Folder…",
        accelerator: "CmdOrCtrl+O",
    }
}

fn native_preferences_menu_spec() -> NativeNewWindowMenuSpec {
    NativeNewWindowMenuSpec {
        parent_menu: "Application",
        id: "preferences",
        label: "Preferences…",
        accelerator: "CmdOrCtrl+,",
    }
}

fn focused_window_target<'a>(
    windows: impl IntoIterator<Item = (&'a str, bool)>,
) -> Option<&'a str> {
    let mut main = None;
    let mut first = None;

    for (label, is_focused) in windows {
        if is_focused {
            return Some(label);
        }
        if label == "main" {
            main = Some(label);
        }
        first.get_or_insert(label);
    }

    main.or(first)
}

fn new_window_event_target<'a>(
    windows: impl IntoIterator<Item = (&'a str, bool)>,
) -> Option<&'a str> {
    let mut main = None;
    let mut first_full_editor = None;

    for (label, is_focused) in windows {
        if label.starts_with("preview-") || label == "preferences" {
            continue;
        }
        if is_focused {
            return Some(label);
        }
        if label == "main" {
            main = Some(label);
        }
        first_full_editor.get_or_insert(label);
    }

    main.or(first_full_editor)
}

fn build_application_menu(
    app_handle: &AppHandle,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let menu = Menu::default(app_handle)?;
    let spec = native_new_window_menu_spec();
    let open_folder_spec = native_open_folder_menu_spec();
    let preferences_spec = native_preferences_menu_spec();
    let new_window = MenuItem::with_id(
        app_handle,
        spec.id,
        spec.label,
        true,
        Some(spec.accelerator),
    )?;
    let open_folder = MenuItem::with_id(
        app_handle,
        open_folder_spec.id,
        open_folder_spec.label,
        true,
        Some(open_folder_spec.accelerator),
    )?;
    let preferences = MenuItem::with_id(
        app_handle,
        preferences_spec.id,
        preferences_spec.label,
        true,
        Some(preferences_spec.accelerator),
    )?;

    let application_menu_name = app_handle
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| app_handle.package_info().name.clone());
    let mut has_file_menu = false;

    for item in menu.items()? {
        let Some(submenu) = item.as_submenu() else {
            continue;
        };
        let text = submenu.text()?;
        if text == spec.parent_menu {
            has_file_menu = true;
            let separator = PredefinedMenuItem::separator(app_handle)?;
            submenu.prepend_items(&[&open_folder, &new_window, &separator])?;
        } else if text == application_menu_name {
            let separator = PredefinedMenuItem::separator(app_handle)?;
            submenu.insert_items(&[&preferences, &separator], 1)?;
        }
    }

    if has_file_menu {
        return Ok(menu);
    }

    // Tauri omits a default File menu on a few Unix desktop targets.
    // Keep the explicit new-window entry available there without replacing
    // any of the other platform-native default menus.
    let file_menu = Submenu::with_items(
        app_handle,
        spec.parent_menu,
        true,
        &[&open_folder, &new_window],
    )?;
    menu.prepend(&file_menu)?;
    Ok(menu)
}

const NATIVE_NEW_WINDOW_EVENT: &str = "new-window";
const NATIVE_OPEN_FOLDER_EVENT: &str = "open-folder";

fn emit_native_new_window_request(app: &AppHandle) {
    let window_states = app
        .webview_windows()
        .into_iter()
        .map(|(label, window)| {
            let is_focused = window.is_focused().unwrap_or(false);
            (label, is_focused)
        })
        .collect::<Vec<_>>();
    let target = new_window_event_target(
        window_states
            .iter()
            .map(|(label, is_focused)| (label.as_str(), *is_focused)),
    );

    if let Some(label) = target {
        let _ = app.emit_to(label, NATIVE_NEW_WINDOW_EVENT, ());
    }
}

fn emit_native_open_folder_request(app: &AppHandle) {
    let window_states = app
        .webview_windows()
        .into_iter()
        .map(|(label, window)| (label, window.is_focused().unwrap_or(false)))
        .collect::<Vec<_>>();
    let target = focused_window_target(
        window_states
            .iter()
            .map(|(label, is_focused)| (label.as_str(), *is_focused)),
    );

    if let Some(label) = target {
        let _ = app.emit_to(label, NATIVE_OPEN_FOLDER_EVENT, ());
    }
}

fn workspace_path_key(path: &Path) -> String {
    let path_str = path.to_string_lossy();
    format!("workspace-{}", crate::hashing::sha256_hex(path_str.as_bytes()))
}

fn workspace_window_label(path: &Path, sequence: u64) -> String {
    format!("{}-{}", workspace_path_key(path), sequence)
}

fn next_workspace_window_label(path: &Path) -> String {
    workspace_window_label(
        path,
        WORKSPACE_WINDOW_SEQUENCE.fetch_add(1, Ordering::Relaxed),
    )
}

#[derive(Debug, Default)]
struct WorkspaceBindings {
    by_window: HashMap<String, String>,
}

impl WorkspaceBindings {
    fn bind(
        &mut self,
        window_label: impl Into<String>,
        path: impl Into<String>,
    ) -> Option<String> {
        let window_label = window_label.into();
        let path = path.into();

        self.by_window.insert(window_label, path)
    }

    fn unbind(&mut self, window_label: &str) -> Option<String> {
        self.by_window.remove(window_label)
    }

    fn path_for_window(&self, window_label: &str) -> Option<&str> {
        self.by_window.get(window_label).map(String::as_str)
    }

    fn window_for_path(&self, path: &str) -> Option<&str> {
        self.by_window
            .iter()
            .find_map(|(label, workspace)| (workspace == path).then_some(label.as_str()))
    }

    fn windows_for_path(&self, path: &str) -> Vec<String> {
        let mut labels: Vec<String> = self
            .by_window
            .iter()
            .filter_map(|(label, workspace)| (workspace == path).then_some(label.clone()))
            .collect();
        labels.sort();
        labels
    }

    fn window_for_note_path(&self, note_path: &Path) -> Option<&str> {
        self.by_window
            .iter()
            .filter(|(_, workspace)| note_path.starts_with(Path::new(workspace)))
            .max_by_key(|(_, workspace)| Path::new(workspace).components().count())
            .map(|(label, _)| label.as_str())
    }

    fn windows_for_note_path(&self, note_path: &Path) -> Vec<String> {
        let max_depth = self
            .by_window
            .values()
            .filter(|workspace| note_path.starts_with(Path::new(workspace)))
            .map(|workspace| Path::new(workspace).components().count())
            .max();

        let Some(max_depth) = max_depth else {
            return Vec::new();
        };

        let mut labels: Vec<String> = self
            .by_window
            .iter()
            .filter(|(_, workspace)| {
                note_path.starts_with(Path::new(workspace))
                    && Path::new(workspace).components().count() == max_depth
            })
            .map(|(label, _)| label.clone())
            .collect();
        labels.sort();
        labels
    }
}

fn note_change_targets(
    bindings: &WorkspaceBindings,
    note_path: &Path,
    origin_window: Option<&str>,
) -> Vec<String> {
    bindings
        .windows_for_note_path(note_path)
        .into_iter()
        .filter(|label| origin_window != Some(label.as_str()))
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub path: String,
    pub name: String,
    pub is_default: bool,
    pub is_current: bool,
    pub is_open: bool,
}

fn build_workspace_infos(
    config: &AppConfig,
    bindings: &WorkspaceBindings,
    current_window_label: &str,
) -> Vec<WorkspaceInfo> {
    let mut paths = Vec::new();
    if let Some(default_path) = config.notes_folder.clone() {
        paths.push(default_path);
    }
    for workspace in &config.workspaces {
        if !paths.iter().any(|path| path == workspace) {
            paths.push(workspace.clone());
        }
    }

    let current_path = bindings.path_for_window(current_window_label);
    paths
        .into_iter()
        .map(|path| {
            let name = Path::new(&path)
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty())
                .unwrap_or(&path)
                .to_string();
            WorkspaceInfo {
                is_default: config.notes_folder.as_deref() == Some(path.as_str()),
                is_current: current_path == Some(path.as_str()),
                is_open: bindings.window_for_path(&path).is_some(),
                path,
                name,
            }
        })
        .collect()
}

// Per-folder settings (stored in .scratch/settings.json within notes folder)
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Settings {
    pub theme: ThemeSettings,
    #[serde(rename = "editorFont")]
    pub editor_font: Option<EditorFontSettings>,
    #[serde(rename = "gitEnabled")]
    pub git_enabled: Option<bool>,
    #[serde(rename = "pinnedNoteIds")]
    pub pinned_note_ids: Option<Vec<String>>,
    #[serde(rename = "textDirection")]
    pub text_direction: Option<TextDirection>,
    #[serde(rename = "editorWidth")]
    pub editor_width: Option<String>,
    #[serde(rename = "defaultNoteName")]
    pub default_note_name: Option<String>,
    #[serde(rename = "interfaceZoom")]
    pub interface_zoom: Option<f32>,
    #[serde(rename = "customEditorWidthPx")]
    pub custom_editor_width_px: Option<u32>,
    #[serde(rename = "editorWidthResizeEnabled")]
    pub editor_width_resize_enabled: Option<bool>,
    #[serde(rename = "editorToolbarVisible")]
    pub editor_toolbar_visible: Option<bool>,
    #[serde(rename = "titleBarModifiedDateVisible")]
    pub title_bar_modified_date_visible: Option<bool>,
    #[serde(rename = "titleBarFilenameVisible")]
    pub title_bar_filename_visible: Option<bool>,
    /// Custom sidebar width in px; `None` means the default width is used.
    #[serde(rename = "sidebarWidthPx")]
    pub sidebar_width_px: Option<u32>,
    #[serde(rename = "ollamaModel")]
    pub ollama_model: Option<String>,
    #[serde(rename = "foldersEnabled")]
    pub folders_enabled: Option<bool>,
    #[serde(rename = "sidebarSortOrder")]
    pub sidebar_sort_order: Option<String>,
    #[serde(rename = "ignoredPatterns")]
    pub ignored_patterns: Option<Vec<String>>,
    #[serde(rename = "customColorsLight")]
    pub custom_colors_light: Option<std::collections::HashMap<String, String>>,
    #[serde(rename = "customColorsDark")]
    pub custom_colors_dark: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct GlobalSettings {
    pub theme: ThemeSettings,
    #[serde(rename = "editorFont")]
    pub editor_font: Option<EditorFontSettings>,
    #[serde(rename = "textDirection")]
    pub text_direction: Option<TextDirection>,
    #[serde(rename = "editorWidth")]
    pub editor_width: Option<String>,
    #[serde(rename = "defaultNoteName")]
    pub default_note_name: Option<String>,
    #[serde(rename = "interfaceZoom")]
    pub interface_zoom: Option<f32>,
    #[serde(rename = "customEditorWidthPx")]
    pub custom_editor_width_px: Option<u32>,
    #[serde(rename = "editorWidthResizeEnabled")]
    pub editor_width_resize_enabled: Option<bool>,
    #[serde(rename = "editorToolbarVisible")]
    pub editor_toolbar_visible: Option<bool>,
    #[serde(rename = "titleBarModifiedDateVisible")]
    pub title_bar_modified_date_visible: Option<bool>,
    #[serde(rename = "titleBarFilenameVisible")]
    pub title_bar_filename_visible: Option<bool>,
    #[serde(rename = "sidebarWidthPx")]
    pub sidebar_width_px: Option<u32>,
    #[serde(rename = "ollamaModel")]
    pub ollama_model: Option<String>,
    #[serde(rename = "customColorsLight")]
    pub custom_colors_light: Option<HashMap<String, String>>,
    #[serde(rename = "customColorsDark")]
    pub custom_colors_dark: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct WorkspaceSettings {
    #[serde(rename = "gitEnabled")]
    pub git_enabled: Option<bool>,
    #[serde(rename = "pinnedNoteIds")]
    pub pinned_note_ids: Option<Vec<String>>,
    #[serde(rename = "foldersEnabled")]
    pub folders_enabled: Option<bool>,
    #[serde(rename = "sidebarSortOrder")]
    pub sidebar_sort_order: Option<String>,
    #[serde(rename = "ignoredPatterns")]
    pub ignored_patterns: Option<Vec<String>>,
}

fn split_settings(settings: Settings) -> (GlobalSettings, WorkspaceSettings) {
    let Settings {
        theme,
        editor_font,
        git_enabled,
        pinned_note_ids,
        text_direction,
        editor_width,
        default_note_name,
        interface_zoom,
        custom_editor_width_px,
        editor_width_resize_enabled,
        editor_toolbar_visible,
        title_bar_modified_date_visible,
        title_bar_filename_visible,
        sidebar_width_px,
        ollama_model,
        folders_enabled,
        sidebar_sort_order,
        ignored_patterns,
        custom_colors_light,
        custom_colors_dark,
    } = settings;

    (
        GlobalSettings {
            theme,
            editor_font,
            text_direction,
            editor_width,
            default_note_name,
            interface_zoom,
            custom_editor_width_px,
            editor_width_resize_enabled,
            editor_toolbar_visible,
            title_bar_modified_date_visible,
            title_bar_filename_visible,
            sidebar_width_px,
            ollama_model,
            custom_colors_light,
            custom_colors_dark,
        },
        WorkspaceSettings {
            git_enabled,
            pinned_note_ids,
            folders_enabled,
            sidebar_sort_order,
            ignored_patterns,
        },
    )
}

fn merge_settings(global: &GlobalSettings, workspace: &WorkspaceSettings) -> Settings {
    Settings {
        theme: global.theme.clone(),
        editor_font: global.editor_font.clone(),
        git_enabled: workspace.git_enabled,
        pinned_note_ids: workspace.pinned_note_ids.clone(),
        text_direction: global.text_direction.clone(),
        editor_width: global.editor_width.clone(),
        default_note_name: global.default_note_name.clone(),
        interface_zoom: global.interface_zoom,
        custom_editor_width_px: global.custom_editor_width_px,
        editor_width_resize_enabled: global.editor_width_resize_enabled,
        editor_toolbar_visible: global.editor_toolbar_visible,
        title_bar_modified_date_visible: global.title_bar_modified_date_visible,
        title_bar_filename_visible: global.title_bar_filename_visible,
        sidebar_width_px: global.sidebar_width_px,
        ollama_model: global.ollama_model.clone(),
        folders_enabled: workspace.folders_enabled,
        sidebar_sort_order: workspace.sidebar_sort_order.clone(),
        ignored_patterns: workspace.ignored_patterns.clone(),
        custom_colors_light: global.custom_colors_light.clone(),
        custom_colors_dark: global.custom_colors_dark.clone(),
    }
}

fn merge_json_patch(target: &mut serde_json::Value, patch: serde_json::Value) {
    match (target, patch) {
        (serde_json::Value::Object(target), serde_json::Value::Object(patch)) => {
            for (key, value) in patch {
                match target.get_mut(&key) {
                    Some(current) => merge_json_patch(current, value),
                    None => {
                        target.insert(key, value);
                    }
                }
            }
        }
        (target, patch) => *target = patch,
    }
}

fn apply_settings_patch<T>(current: &T, patch: serde_json::Value) -> Result<T, String>
where
    T: Serialize + serde::de::DeserializeOwned,
{
    if !patch.is_object() {
        return Err("Settings patch must be an object".to_string());
    }

    let mut merged = serde_json::to_value(current).map_err(|error| error.to_string())?;
    merge_json_patch(&mut merged, patch);
    serde_json::from_value(merged).map_err(|error| error.to_string())
}

fn migrate_legacy_settings(
    config: &mut AppConfig,
    legacy_settings: Settings,
) -> Option<WorkspaceSettings> {
    if config.global_settings.is_some() {
        return None;
    }

    let (global, workspace) = split_settings(legacy_settings);
    config.global_settings = Some(global);
    Some(workspace)
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum SettingsChangeScope {
    Global,
    Workspace,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsChangedPayload {
    scope: SettingsChangeScope,
    workspace: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum SettingsChangeTargets {
    All,
    Windows(Vec<String>),
}

fn settings_change_targets(
    bindings: &WorkspaceBindings,
    scope: SettingsChangeScope,
    workspace: Option<&str>,
) -> SettingsChangeTargets {
    match scope {
        SettingsChangeScope::Global => SettingsChangeTargets::All,
        SettingsChangeScope::Workspace => SettingsChangeTargets::Windows(
            workspace
                .map(|path| bindings.windows_for_path(path))
                .unwrap_or_default(),
        ),
    }
}

// Search result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub modified: i64,
    pub score: f32,
}

// AI execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExecutionResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

// File watcher state
pub struct FileWatcherState {
    #[allow(dead_code)]
    watcher: RecommendedWatcher,
}

fn ensure_shared_resource<T>(
    slot: &Mutex<Option<T>>,
    create: impl FnOnce() -> Result<T, String>,
) -> Result<bool, String> {
    let mut resource = slot
        .lock()
        .map_err(|_| "shared workspace resource lock poisoned".to_string())?;
    if resource.is_some() {
        return Ok(false);
    }

    *resource = Some(create()?);
    Ok(true)
}

fn get_or_initialize_shared<K, V, E>(
    registry: &RwLock<HashMap<K, Arc<V>>>,
    initializers: &Mutex<HashMap<K, Arc<Mutex<()>>>>,
    key: K,
    create: impl FnOnce() -> Result<V, E>,
) -> Result<Arc<V>, E>
where
    K: Clone + Eq + std::hash::Hash,
{
    if let Some(existing) = registry
        .read()
        .expect("shared registry read lock")
        .get(&key)
        .cloned()
    {
        return Ok(existing);
    }

    let initializer = initializers
        .lock()
        .expect("shared initializer registry lock")
        .entry(key.clone())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone();
    let _initializing = initializer.lock().expect("shared initializer lock");

    if let Some(existing) = registry
        .read()
        .expect("shared registry read lock")
        .get(&key)
        .cloned()
    {
        return Ok(existing);
    }

    let created = Arc::new(create()?);
    registry
        .write()
        .expect("shared registry write lock")
        .insert(key, Arc::clone(&created));
    Ok(created)
}

// Tantivy search index state
pub struct SearchIndex {
    index: Index,
    reader: IndexReader,
    writer: Mutex<IndexWriter>,
    #[allow(dead_code)]
    schema: Schema,
    id_field: Field,
    title_field: Field,
    content_field: Field,
    modified_field: Field,
}

impl SearchIndex {
    fn new(index_path: &PathBuf) -> Result<Self> {
        // Build schema
        let mut schema_builder = Schema::builder();
        let id_field = schema_builder.add_text_field("id", STRING | STORED);
        let title_field = schema_builder.add_text_field("title", TEXT | STORED);
        let content_field = schema_builder.add_text_field("content", TEXT | STORED);
        let modified_field = schema_builder.add_i64_field("modified", INDEXED | STORED);
        let schema = schema_builder.build();

        // Create or open index
        std::fs::create_dir_all(index_path)?;
        let index = Index::create_in_dir(index_path, schema.clone())
            .or_else(|_| Index::open_in_dir(index_path))?;

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()?;

        let writer = index.writer(50_000_000)?; // 50MB buffer

        Ok(Self {
            index,
            reader,
            writer: Mutex::new(writer),
            schema,
            id_field,
            title_field,
            content_field,
            modified_field,
        })
    }

    fn index_note(&self, id: &str, title: &str, content: &str, modified: i64) -> Result<()> {
        let mut writer = self.writer.lock().expect("search writer mutex");

        // Delete existing document with this ID
        let id_term = tantivy::Term::from_field_text(self.id_field, id);
        writer.delete_term(id_term);

        // Add new document
        writer.add_document(doc!(
            self.id_field => id,
            self.title_field => title,
            self.content_field => content,
            self.modified_field => modified,
        ))?;

        writer.commit()?;
        Ok(())
    }

    fn delete_note(&self, id: &str) -> Result<()> {
        let mut writer = self.writer.lock().expect("search writer mutex");
        let id_term = tantivy::Term::from_field_text(self.id_field, id);
        writer.delete_term(id_term);
        writer.commit()?;
        Ok(())
    }

    fn search(&self, query_str: &str, limit: usize) -> Result<Vec<SearchResult>> {
        let searcher = self.reader.searcher();
        let query_parser =
            QueryParser::for_index(&self.index, vec![self.title_field, self.content_field]);

        // Parse query, fall back to prefix query if parsing fails
        let query = query_parser
            .parse_query(query_str)
            .or_else(|_| query_parser.parse_query(&format!("{}*", query_str)))?;

        let top_docs = searcher.search(&query, &TopDocs::with_limit(limit))?;

        let mut results = Vec::with_capacity(top_docs.len());
        for (score, doc_address) in top_docs {
            let doc: TantivyDocument = searcher.doc(doc_address)?;

            let id = doc
                .get_first(self.id_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let title = doc
                .get_first(self.title_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let content = doc
                .get_first(self.content_field)
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let modified = doc
                .get_first(self.modified_field)
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            let preview = generate_preview(content);

            results.push(SearchResult {
                id,
                title,
                preview,
                modified,
                score,
            });
        }

        Ok(results)
    }

    fn rebuild_index(&self, notes_folder: &PathBuf, ignored_dirs: &[String]) -> Result<()> {
        let mut writer = self.writer.lock().expect("search writer mutex");
        writer.delete_all_documents()?;

        if notes_folder.exists() {
            use walkdir::WalkDir;
            for entry in WalkDir::new(notes_folder)
                .max_depth(10)
                .into_iter()
                .filter_entry(|e| is_visible_notes_entry(e, ignored_dirs))
                .flatten()
            {
                let file_path = entry.path();
                if !file_path.is_file() {
                    continue;
                }
                if let Some(id) = id_from_abs_path(notes_folder, file_path, ignored_dirs) {
                    if let Ok(content) = std::fs::read_to_string(file_path) {
                        let modified = entry
                            .metadata()
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0);

                        let title = extract_title(&content);

                        writer.add_document(doc!(
                            self.id_field => id.as_str(),
                            self.title_field => title,
                            self.content_field => content.as_str(),
                            self.modified_field => modified,
                        ))?;
                    }
                }
            }
        }

        writer.commit()?;
        Ok(())
    }
}

pub struct WorkspaceSession {
    pub notes_folder: String,
    pub settings: RwLock<WorkspaceSettings>,
    pub notes_cache: RwLock<HashMap<String, NoteMetadata>>,
    pub file_watcher: Mutex<Option<FileWatcherState>>,
    pub search_index: Mutex<Option<SearchIndex>>,
    pub(crate) debounce_map: Arc<Mutex<WatcherDebounce>>,
}

impl WorkspaceSession {
    #[cfg(test)]
    fn empty(notes_folder: String) -> Self {
        Self {
            notes_folder,
            settings: RwLock::new(WorkspaceSettings::default()),
            notes_cache: RwLock::new(HashMap::new()),
            file_watcher: Mutex::new(None),
            search_index: Mutex::new(None),
            debounce_map: Arc::new(Mutex::new(WatcherDebounce::default())),
        }
    }

    fn initialize(app: &AppHandle, path: &Path) -> Result<Self, String> {
        let (canonical_path, notes_folder) = prepare_notes_folder(path)?;
        Self::initialize_prepared(app, canonical_path, notes_folder)
    }

    fn initialize_prepared(
        app: &AppHandle,
        canonical_path: PathBuf,
        notes_folder: String,
    ) -> Result<Self, String> {
        let settings = load_settings(&notes_folder);
        let ignored_dirs = get_effective_ignored_dirs(&settings);
        let search_index = get_workspace_search_index_path(app, &canonical_path)
            .ok()
            .and_then(|index_path| SearchIndex::new(&index_path).ok())
            .inspect(|index| {
                let _ = index.rebuild_index(&canonical_path, &ignored_dirs);
            });

        let _ = app
            .asset_protocol_scope()
            .allow_directory(&canonical_path, true);

        Ok(Self {
            notes_folder,
            settings: RwLock::new(settings),
            notes_cache: RwLock::new(HashMap::new()),
            file_watcher: Mutex::new(None),
            search_index: Mutex::new(search_index),
            debounce_map: Arc::new(Mutex::new(WatcherDebounce::default())),
        })
    }
}

// App state with improved structure
pub struct AppState {
    pub app_config: RwLock<AppConfig>,  // notes_folder path (stored in app data)
    pub settings: RwLock<WorkspaceSettings>, // per-folder settings (stored in .scratch/)
    pub notes_cache: RwLock<HashMap<String, NoteMetadata>>,
    pub file_watcher: Mutex<Option<FileWatcherState>>,
    pub search_index: Mutex<Option<SearchIndex>>,
    pub(crate) debounce_map: Arc<Mutex<WatcherDebounce>>,
    workspace_sessions: RwLock<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_initializers: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    workspace_bindings: RwLock<WorkspaceBindings>,
    is_quitting: AtomicBool,
    preserve_session_labels: Mutex<HashSet<String>>,
}

enum WorkspaceRuntime<'a> {
    Main(&'a AppState),
    Session(Arc<WorkspaceSession>),
}

impl WorkspaceRuntime<'_> {
    fn notes_folder(&self) -> Result<String, String> {
        match self {
            Self::Main(state) => state
                .workspace_bindings
                .read()
                .expect("workspace bindings read lock")
                .path_for_window("main")
                .map(str::to_string)
                .or_else(|| {
                    state
                        .app_config
                        .read()
                        .expect("app_config read lock")
                        .notes_folder
                        .clone()
                })
                .ok_or_else(|| "Notes folder not set".to_string()),
            Self::Session(session) => Ok(session.notes_folder.clone()),
        }
    }

    fn settings(&self) -> &RwLock<WorkspaceSettings> {
        match self {
            Self::Main(state) => &state.settings,
            Self::Session(session) => &session.settings,
        }
    }

    fn note_path(&self, id: &str) -> Result<PathBuf, String> {
        abs_path_from_id(&PathBuf::from(self.notes_folder()?), id)
    }

    fn notes_cache(&self) -> &RwLock<HashMap<String, NoteMetadata>> {
        match self {
            Self::Main(state) => &state.notes_cache,
            Self::Session(session) => &session.notes_cache,
        }
    }

    fn file_watcher(&self) -> &Mutex<Option<FileWatcherState>> {
        match self {
            Self::Main(state) => &state.file_watcher,
            Self::Session(session) => &session.file_watcher,
        }
    }

    fn search_index(&self) -> &Mutex<Option<SearchIndex>> {
        match self {
            Self::Main(state) => &state.search_index,
            Self::Session(session) => &session.search_index,
        }
    }

    fn debounce_map(&self) -> &Arc<Mutex<WatcherDebounce>> {
        match self {
            Self::Main(state) => &state.debounce_map,
            Self::Session(session) => &session.debounce_map,
        }
    }
}

fn uses_default_workspace_fallback(window_label: &str) -> bool {
    window_label == "main"
        || window_label == "preferences"
        || window_label.starts_with("preview-")
}

impl AppState {
    fn get_or_initialize_workspace_session(
        &self,
        app: &AppHandle,
        path: &Path,
    ) -> Result<Arc<WorkspaceSession>, String> {
        let (canonical_path, notes_folder) = prepare_notes_folder(path)?;
        get_or_initialize_shared(
            &self.workspace_sessions,
            &self.workspace_initializers,
            notes_folder.clone(),
            || WorkspaceSession::initialize_prepared(app, canonical_path, notes_folder),
        )
    }

    fn workspace_for_window(&self, window_label: &str) -> Result<WorkspaceRuntime<'_>, String> {
        let session = if uses_default_workspace_fallback(window_label) {
            self.workspace_session("main")
        } else {
            self.workspace_session(window_label)
        };
        if let Some(session) = session {
            return Ok(WorkspaceRuntime::Session(session));
        }

        if uses_default_workspace_fallback(window_label) {
            return Ok(WorkspaceRuntime::Main(self));
        }

        Err(format!(
            "Workspace session not found for window: {}",
            window_label
        ))
    }

    fn register_workspace_session(
        &self,
        window_label: impl Into<String>,
        session: WorkspaceSession,
    ) -> Arc<WorkspaceSession> {
        let window_label = window_label.into();
        let notes_folder = session.notes_folder.clone();
        let shared_session = {
            let mut sessions = self
                .workspace_sessions
                .write()
                .expect("workspace sessions write lock");
            sessions
                .entry(notes_folder.clone())
                .or_insert_with(|| Arc::new(session))
                .clone()
        };

        let previous_folder = self
            .workspace_bindings
            .write()
            .expect("workspace bindings write lock")
            .bind(window_label.clone(), notes_folder.clone());
        if let Some(previous_folder) = previous_folder {
            if previous_folder != notes_folder {
                let has_remaining_windows = !self
                    .workspace_bindings
                    .read()
                    .expect("workspace bindings read lock")
                    .windows_for_path(&previous_folder)
                    .is_empty();
                if !has_remaining_windows {
                    self.workspace_sessions
                        .write()
                        .expect("workspace sessions write lock")
                        .remove(&previous_folder);
                    self.workspace_initializers
                        .lock()
                        .expect("workspace initializers lock")
                        .remove(&previous_folder);
                }
            }
        }
        shared_session
    }

    fn workspace_session(&self, window_label: &str) -> Option<Arc<WorkspaceSession>> {
        let notes_folder = self
            .workspace_bindings
            .read()
            .expect("workspace bindings read lock")
            .path_for_window(window_label)?
            .to_string();
        self.workspace_sessions
            .read()
            .expect("workspace sessions read lock")
            .get(&notes_folder)
            .cloned()
    }

    fn workspace_session_for_path(&self, notes_folder: &str) -> Option<Arc<WorkspaceSession>> {
        self.workspace_sessions
            .read()
            .expect("workspace sessions read lock")
            .get(notes_folder)
            .cloned()
    }

    fn bind_existing_workspace_session(
        &self,
        window_label: impl Into<String>,
        notes_folder: impl Into<String>,
    ) -> Result<Arc<WorkspaceSession>, String> {
        let window_label = window_label.into();
        let notes_folder = notes_folder.into();
        let session = self
            .workspace_session_for_path(&notes_folder)
            .ok_or_else(|| format!("Workspace session not found for path: {}", notes_folder))?;
        self.workspace_bindings
            .write()
            .expect("workspace bindings write lock")
            .bind(window_label, notes_folder);
        Ok(session)
    }

    fn remove_workspace_session(&self, window_label: &str) -> Option<Arc<WorkspaceSession>> {
        let (notes_folder, has_remaining_windows) = {
            let mut bindings = self
                .workspace_bindings
                .write()
                .expect("workspace bindings write lock");
            let notes_folder = bindings.unbind(window_label)?;
            let has_remaining_windows = !bindings.windows_for_path(&notes_folder).is_empty();
            (notes_folder, has_remaining_windows)
        };

        if has_remaining_windows {
            return self
                .workspace_sessions
                .read()
                .expect("workspace sessions read lock")
                .get(&notes_folder)
                .cloned();
        }

        let removed = self.workspace_sessions
            .write()
            .expect("workspace sessions write lock")
            .remove(&notes_folder);
        self.workspace_initializers
            .lock()
            .expect("workspace initializers lock")
            .remove(&notes_folder);
        removed
    }

    #[cfg(test)]
    fn workspace_session_count(&self) -> usize {
        self.workspace_sessions
            .read()
            .expect("workspace sessions read lock")
            .len()
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            app_config: RwLock::new(AppConfig::default()),
            settings: RwLock::new(WorkspaceSettings::default()),
            notes_cache: RwLock::new(HashMap::new()),
            file_watcher: Mutex::new(None),
            search_index: Mutex::new(None),
            debounce_map: Arc::new(Mutex::new(WatcherDebounce::default())),
            workspace_sessions: RwLock::new(HashMap::new()),
            workspace_initializers: Mutex::new(HashMap::new()),
            workspace_bindings: RwLock::new(WorkspaceBindings::default()),
            is_quitting: AtomicBool::new(false),
            preserve_session_labels: Mutex::new(HashSet::new()),
        }
    }
}

type PendingOpenRequest = (Vec<String>, String);

// macOS open-file and single-instance callbacks may arrive before `setup`
// manages AppState. Keep those requests until the notes configuration is ready.
static PENDING_SINGLE_INSTANCE_OPENS: Mutex<Vec<PendingOpenRequest>> = Mutex::new(Vec::new());
static PENDING_OPENED_MARKDOWN_PATHS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

// Utility: Sanitize filename from title
fn sanitize_filename(title: &str) -> String {
    let sanitized: String = title
        .chars()
        .filter(|c| *c != '\u{00A0}' && *c != '\u{FEFF}')
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => c,
        })
        .collect();

    let trimmed = sanitized.trim();
    if trimmed.is_empty() || is_effectively_empty(trimmed) {
        "Untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

fn ordinal_suffix(day: u32) -> &'static str {
    match (day % 100, day % 10) {
        (11..=13, _) => "th",
        (_, 1) => "st",
        (_, 2) => "nd",
        (_, 3) => "rd",
        _ => "th",
    }
}

/// Expands template tags in a note name template using local timezone
fn expand_note_name_template(template: &str) -> String {
    use chrono::{Datelike, Local};

    let mut result = template.to_string();

    // Get current time in local timezone
    let now = Local::now();

    // Timestamp tag (Unix timestamp)
    result = result.replace("{timestamp}", &now.timestamp().to_string());

    // Date tags
    result = result.replace("{date}", &now.format("%Y-%m-%d").to_string());
    result = result.replace("{year}", &now.format("%Y").to_string());
    result = result.replace("{month}", &now.format("%m").to_string());
    result = result.replace("{day}", &now.format("%d").to_string());

    // Text-based date tags (English, locale-independent)
    result = result.replace("{monthName}", &now.format("%B").to_string());
    result = result.replace("{monthShort}", &now.format("%b").to_string());
    result = result.replace("{weekday}", &now.format("%A").to_string());
    result = result.replace("{weekdayShort}", &now.format("%a").to_string());
    let day_num = now.day();
    result = result.replace(
        "{dayOrdinal}",
        &format!("{}{}", day_num, ordinal_suffix(day_num)),
    );

    // Time tags (use dash instead of colon for filename safety)
    result = result.replace("{time}", &now.format("%H-%M-%S").to_string());

    // Note: {counter} is handled in create_note function

    result
}

/// Extracts a display title from a note ID (filename)
fn extract_title_from_id(id: &str) -> String {
    // Get last path component (filename)
    let filename = id.rsplit('/').next().unwrap_or(id);

    // Convert to display title (replace dashes/underscores with spaces)
    let title = filename.replace(['-', '_'], " ");

    // Title case
    title
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().to_string() + chars.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// Utility: Check if a string is effectively empty
fn is_effectively_empty(s: &str) -> bool {
    s.chars()
        .all(|c| c.is_whitespace() || c == '\u{00A0}' || c == '\u{FEFF}')
}

/// Strip YAML frontmatter (leading `---` ... `---` block) from content.
fn strip_frontmatter(content: &str) -> &str {
    let trimmed = content.trim_start();
    if trimmed.starts_with("---") {
        // Find the closing --- (skip the opening line)
        if let Some(rest) = trimmed.strip_prefix("---") {
            if let Some(end) = rest.find("\n---") {
                // Skip past closing --- and the newline after it (handle CRLF)
                let after_close = &rest[end + 4..];
                return after_close
                    .strip_prefix("\r\n")
                    .or_else(|| after_close.strip_prefix('\n'))
                    .unwrap_or(after_close);
            }
        }
    }
    content
}

// Utility: Extract title from markdown content
fn extract_title(content: &str) -> String {
    let body = strip_frontmatter(content);
    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(title) = trimmed.strip_prefix("# ") {
            let title = title.trim();
            if !is_effectively_empty(title) {
                return title.to_string();
            }
        }
        if !is_effectively_empty(trimmed) {
            return trimmed.chars().take(50).collect();
        }
    }
    "Untitled".to_string()
}

// Utility: Generate preview from content (strip markdown formatting)
fn generate_preview(content: &str) -> String {
    let body = strip_frontmatter(content);
    // Skip the first line (title), find first non-empty line
    for line in body.lines().skip(1) {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            let stripped = strip_markdown(trimmed);
            if !stripped.is_empty() {
                return stripped.chars().take(100).collect();
            }
        }
    }
    String::new()
}

// Strip common markdown formatting from text
fn strip_markdown(text: &str) -> String {
    let mut result = text.to_string();

    // Remove heading markers (##, ###, etc.)
    let trimmed = result.trim_start();
    if trimmed.starts_with('#') {
        result = trimmed.trim_start_matches('#').trim_start().to_string();
    }

    // Remove strikethrough (~~text~~) - before other markers
    while let Some(start) = result.find("~~") {
        if let Some(end) = result[start + 2..].find("~~") {
            let inner = &result[start + 2..start + 2 + end];
            result = format!("{}{}{}", &result[..start], inner, &result[start + 4 + end..]);
        } else {
            break;
        }
    }

    // Remove bold (**text** or __text__) - before italic
    while let Some(start) = result.find("**") {
        if let Some(end) = result[start + 2..].find("**") {
            let inner = &result[start + 2..start + 2 + end];
            result = format!("{}{}{}", &result[..start], inner, &result[start + 4 + end..]);
        } else {
            break;
        }
    }
    while let Some(start) = result.find("__") {
        if let Some(end) = result[start + 2..].find("__") {
            let inner = &result[start + 2..start + 2 + end];
            result = format!("{}{}{}", &result[..start], inner, &result[start + 4 + end..]);
        } else {
            break;
        }
    }

    // Remove inline code (`code`)
    while let Some(start) = result.find('`') {
        if let Some(end) = result[start + 1..].find('`') {
            let inner = &result[start + 1..start + 1 + end];
            result = format!("{}{}{}", &result[..start], inner, &result[start + 2 + end..]);
        } else {
            break;
        }
    }

    // Remove images ![alt](url) - must come before links
    let img_re = regex::Regex::new(r"!\[([^\]]*)\]\([^)]+\)").unwrap();
    result = img_re.replace_all(&result, "$1").to_string();

    // Remove links [text](url)
    let link_re = regex::Regex::new(r"\[([^\]]+)\]\([^)]+\)").unwrap();
    result = link_re.replace_all(&result, "$1").to_string();

    // Remove italic (*text* or _text_) - simple approach after bold is removed
    // Match *text* where text doesn't contain *
    while let Some(start) = result.find('*') {
        if let Some(end) = result[start + 1..].find('*') {
            if end > 0 {
                let inner = &result[start + 1..start + 1 + end];
                result = format!("{}{}{}", &result[..start], inner, &result[start + 2 + end..]);
            } else {
                break;
            }
        } else {
            break;
        }
    }
    // Match _text_ where text doesn't contain _
    while let Some(start) = result.find('_') {
        if let Some(end) = result[start + 1..].find('_') {
            if end > 0 {
                let inner = &result[start + 1..start + 1 + end];
                result = format!("{}{}{}", &result[..start], inner, &result[start + 2 + end..]);
            } else {
                break;
            }
        } else {
            break;
        }
    }

    // Remove task list markers
    result = result
        .replace("- [ ] ", "")
        .replace("- [x] ", "")
        .replace("- [X] ", "");

    // Remove list markers at start (-, *, +, 1.)
    let list_re = regex::Regex::new(r"^(\s*[-+*]|\s*\d+\.)\s+").unwrap();
    result = list_re.replace(&result, "").to_string();

    result.trim().to_string()
}

/// Directories to exclude from note discovery and ID resolution (app-internal, always excluded).
const EXCLUDED_DIRS: &[&str] = &[".git", ".scratch", ".obsidian", ".trash", "assets"];

/// Default user-configurable directories to ignore (common build/dependency folders).
const DEFAULT_IGNORED_DIRS: &[&str] = &[
    "node_modules",
    ".next",
    ".nuxt",
    "dist",
    "build",
    "out",
    "target",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    ".cache",
    "coverage",
    ".svn",
    ".hg",
    "bower_components",
    ".turbo",
    ".parcel-cache",
];

/// Get the effective ignored directories from settings (or defaults if not customized).
fn get_effective_ignored_dirs(settings: &WorkspaceSettings) -> Vec<String> {
    settings.ignored_patterns.clone().unwrap_or_else(|| {
        DEFAULT_IGNORED_DIRS.iter().map(|s| s.to_string()).collect()
    })
}

/// Filter for WalkDir: skips excluded and user-ignored directories.
fn is_visible_notes_entry(entry: &walkdir::DirEntry, ignored_dirs: &[String]) -> bool {
    if entry.file_type().is_dir() {
        let name = entry.file_name().to_str().unwrap_or("");
        return !EXCLUDED_DIRS.contains(&name) && !ignored_dirs.iter().any(|d| d == name);
    }
    true
}

/// Convert an absolute file path to a note ID (relative path from notes root, no .md extension, POSIX separators).
/// Returns None if the path is outside the root, not a .md file, or in an excluded/ignored directory.
fn id_from_abs_path(notes_root: &Path, file_path: &Path, ignored_dirs: &[String]) -> Option<String> {
    let rel = file_path.strip_prefix(notes_root).ok()?;

    // Skip files inside excluded or ignored directories.
    // Only block specific known dirs so that dot-prefixed *files* like ".foo.md" are still visible.
    for component in rel.parent().unwrap_or(Path::new("")).components() {
        if let std::path::Component::Normal(name) = component {
            let name_str = name.to_str()?;
            if EXCLUDED_DIRS.contains(&name_str) || ignored_dirs.iter().any(|d| d == name_str) {
                return None;
            }
        }
    }

    // Must be a .md file
    if file_path.extension()?.to_str()? != "md" {
        return None;
    }

    // Build ID: relative path without .md suffix, using POSIX separators.
    // Strip .md by converting to string and trimming (avoids with_extension
    // which breaks on stems containing dots like "meeting.2024-01-15.md").
    let rel_str = rel.to_str()?;
    let id = rel_str.strip_suffix(".md")?.replace(std::path::MAIN_SEPARATOR, "/");

    if id.is_empty() {
        None
    } else {
        Some(id)
    }
}

/// Convert a note ID to an absolute file path. Validates against path traversal.
fn abs_path_from_id(notes_root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.contains('\\') {
        return Err("Invalid note ID: backslashes not allowed".to_string());
    }

    let rel = Path::new(id);

    for component in rel.components() {
        match component {
            std::path::Component::ParentDir => {
                return Err("Invalid note ID: parent directory references not allowed".to_string());
            }
            std::path::Component::CurDir => {
                return Err("Invalid note ID: current directory references not allowed".to_string());
            }
            std::path::Component::RootDir | std::path::Component::Prefix(_) => {
                return Err("Invalid note ID: absolute paths not allowed".to_string());
            }
            _ => {}
        }
    }

    // Append ".md" via OsString to avoid with_extension replacing dots in stems
    // (e.g. "meeting.2024-01-15" would become "meeting.md" with with_extension)
    let joined = notes_root.join(rel);
    let mut file_path_os = joined.into_os_string();
    file_path_os.push(".md");
    let file_path = PathBuf::from(file_path_os);

    if !file_path.starts_with(notes_root) {
        return Err("Invalid note ID: path escapes notes folder".to_string());
    }

    Ok(file_path)
}

// Get app config file path (in app data directory)
fn get_app_config_path(app: &AppHandle) -> Result<PathBuf> {
    let app_data = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_data)?;
    Ok(app_data.join("config.json"))
}

// Get per-folder settings file path (in .scratch/ within notes folder)
fn get_settings_path(notes_folder: &str) -> PathBuf {
    let scratch_dir = PathBuf::from(notes_folder).join(".scratch");
    std::fs::create_dir_all(&scratch_dir).ok();
    scratch_dir.join("settings.json")
}

fn get_workspace_search_index_path(app: &AppHandle, notes_folder: &Path) -> Result<PathBuf> {
    let app_data = app.path().app_data_dir()?;
    let indexes = app_data.join("workspace_search_indexes");
    std::fs::create_dir_all(&indexes)?;
    Ok(indexes.join(workspace_path_key(notes_folder)))
}

fn remove_workspace_search_index(app: &AppHandle, path: &str) -> Result<()> {
    let app_data = app.path().app_data_dir()?;
    let index_path = app_data.join("workspace_search_indexes").join(workspace_path_key(Path::new(path)));
    if index_path.exists() {
        std::fs::remove_dir_all(index_path)?;
    }
    Ok(())
}

// Load app config from disk (notes folder path)
fn load_app_config(app: &AppHandle) -> AppConfig {
    let path = match get_app_config_path(app) {
        Ok(p) => p,
        Err(error) => {
            eprintln!("app config path resolution failed: {error}");
            return AppConfig::default();
        }
    };

    match std::fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(config) => config,
            Err(error) => {
                eprintln!("app config deserialization failed: {error}");
                AppConfig::default()
            }
        },
        Err(error) => {
            eprintln!("app config read failed: {error}");
            AppConfig::default()
        }
    }
}

// Save app config to disk
fn save_app_config(app: &AppHandle, config: &AppConfig) -> Result<()> {
    let path = get_app_config_path(app)?;
    let content = serde_json::to_string_pretty(config)?;
    std::fs::write(path, content)?;
    Ok(())
}

// Load per-folder settings from disk
fn load_settings(notes_folder: &str) -> Result<WorkspaceSettings, String> {
    let path = get_settings_path(notes_folder);

    if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let settings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(settings)
    } else {
        Ok(WorkspaceSettings::default())
    }
}

fn load_legacy_settings(notes_folder: &str) -> Result<Settings, String> {
    let path = get_settings_path(notes_folder);

    if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let settings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(settings)
    } else {
        Ok(Settings::default())
    }
}

// Save per-folder settings to disk
fn save_settings(notes_folder: &str, settings: &WorkspaceSettings) -> Result<()> {
    let path = get_settings_path(notes_folder);
    let content = serde_json::to_string_pretty(settings)?;
    std::fs::write(path, content)?;
    Ok(())
}

// Normalize notes folder path from plain paths and legacy file:// URIs.
fn normalize_notes_folder_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Notes folder path is empty".to_string());
    }

    if trimmed.starts_with("file://") {
        let parsed = url::Url::parse(trimmed)
            .map_err(|e| format!("Invalid file URL for notes folder: {}", e))?;
        return parsed
            .to_file_path()
            .map_err(|_| "Invalid file URL for notes folder".to_string());
    }

    Ok(PathBuf::from(trimmed))
}

fn prepare_notes_folder(path_buf: &Path) -> Result<(PathBuf, String), String> {
    if !path_buf.exists() {
        std::fs::create_dir_all(path_buf).map_err(|e| e.to_string())?;
    }

    let canonical = std::fs::canonicalize(path_buf).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(canonical.join("assets")).map_err(|e| e.to_string())?;

    let scratch_dir = canonical.join(".scratch");
    std::fs::create_dir_all(&scratch_dir).map_err(|e| e.to_string())?;

    let write_test_path = scratch_dir.join(".write-test");
    std::fs::write(&write_test_path, b"ok")
        .map_err(|e| format!("Notes folder is not writable: {}", e))?;
    let _ = std::fs::remove_file(&write_test_path);

    let normalized = canonical.to_string_lossy().into_owned();
    // Load per-folder settings (starts fresh with defaults if none exist)
    let settings = load_settings(&normalized_path).unwrap_or_default();

    Ok((canonical, normalized))
}

fn configure_main_workspace(

    {
        let mut config = state.app_config.write().expect("app_config write lock");
        let mut next = config.clone();
        if make_default {
            next.notes_folder = Some(normalized_path.clone());
        }
        remember_workspace(&mut next, normalized_path.clone());
        upsert_window_session_workspace(&mut next, "main", normalized_path.clone());
        save_app_config(app, &next).map_err(|error| error.to_string())?;
        *config = next;
    }
    state.register_workspace_session("main", session);

    Ok(normalized_path)
}

/// Sets and persists the main/default notes folder.
fn initialize_notes_folder(
    app: &AppHandle,
    path_buf: &Path,
    state: &AppState,
) -> Result<String, String> {
    configure_main_workspace(app, path_buf, state, true)
}

/// Rebinds the main window while preserving the configured default folder.
fn switch_main_workspace(
    app: &AppHandle,
    path_buf: &Path,
    state: &AppState,
) -> Result<String, String> {
    configure_main_workspace(app, path_buf, state, false)
}

// TAURI COMMANDS

#[tauri::command]
fn get_notes_folder(window: WebviewWindow, state: State<AppState>) -> Option<String> {
    state
        .workspace_for_window(window.label())
        .ok()?
        .notes_folder()
        .ok()
}

#[tauri::command]
fn get_window_session(window: WebviewWindow, state: State<AppState>) -> Option<WindowSession> {
    let mut record = state
        .app_config
        .read()
        .expect("app config read lock")
        .records
        .get(window.label())
        .cloned()?;
    if let Some(workspace) = state
        .workspace_bindings
        .read()
        .expect("workspace bindings read lock")
        .path_for_window(window.label())
    {
        record.workspace = workspace.to_string();
    }
    Some(record)
}

#[tauri::command]
fn update_window_session(
    patch: serde_json::Value,
    window: WebviewWindow,
    state: State<AppState>,
) -> Result<(), String> {
    let workspace = state
        .workspace_for_window(window.label())?
        .notes_folder()?;
    let mut patch = patch;
    let patch_object = patch
        .as_object_mut()
        .ok_or_else(|| "Window session patch must be an object".to_string())?;
    patch_object.remove("workspace");

    let mut config = state.app_config.write().expect("app config write lock");
    if !workspace_is_remembered(&config, &workspace) {
        return Ok(());
    }
    let current = config
        .records
        .get(window.label())
        .cloned()
        .unwrap_or_else(|| WindowSession::for_workspace(workspace.clone()));
    let mut updated = apply_settings_patch(&current, patch)?;
    updated.workspace = workspace;

    let mut next = config.clone();
    next.records.insert(window.label().to_string(), updated);
    save_app_config(window.app_handle(), &next).map_err(|error| error.to_string())?;
    *config = next;
    Ok(())
}

fn clear_window_session_record(
    app: &AppHandle,
    state: &AppState,
    label: &str,
) -> Result<bool, String> {
    let mut config = state.app_config.write().expect("app config write lock");
    if !config.records.contains_key(label) {
        return Ok(false);
    }

    let mut next = config.clone();
    next.records.remove(label);
    save_app_config(app, &next).map_err(|error| error.to_string())?;
    *config = next;
    Ok(true)
}

fn handle_window_destroyed(app: &AppHandle, label: &str) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let is_quitting = state.is_quitting.load(Ordering::SeqCst);
    let preserve_for_preview = state
        .preserve_session_labels
        .lock()
        .expect("preserved session labels mutex")
        .remove(label);
    {
        let mut config = state.app_config.write().expect("app config write lock");
        let mut next = config.clone();
        if remove_window_session_on_destroy(
            &mut next,
            label,
            is_quitting,
            preserve_for_preview,
        ) {
            match save_app_config(app, &next) {
                Ok(()) => *config = next,
                Err(error) => {
                    eprintln!("Failed to clear closed window session {label}: {error}")
                }
            }
        }
    }
    state.remove_workspace_session(label);
    let _ = app.emit("workspaces-changed", ());
}

fn is_full_editor_window(label: &str) -> bool {
    label == "main" || label.starts_with("workspace-")
}

fn request_full_window_closure_for_preview(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let windows: Vec<_> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| is_full_editor_window(label))
        .collect();
    {
        let mut preserved = state
            .preserve_session_labels
            .lock()
            .expect("preserved session labels mutex");
        preserved.extend(windows.iter().map(|(label, _)| label.clone()));
    }
    for (_, window) in windows {
        let _ = window.close();
    }
}

#[tauri::command]
fn clear_window_session(
    window: WebviewWindow,
    state: State<AppState>,
) -> Result<(), String> {
    clear_window_session_record(window.app_handle(), &state, window.label())?;
    Ok(())
}

/// Finalize a close request only after the WebView has flushed the draft or
/// persisted a recovery snapshot. Keeping force-destroy in trusted Rust avoids
/// exposing `plugin:window|destroy` to editor WebViews.
#[tauri::command]
fn close_window_after_save(window: WebviewWindow) -> Result<(), String> {
    window
        .destroy()
        .map_err(|error| format!("Failed to close window after save: {error}"))
}

#[tauri::command]
async fn set_notes_folder(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path_buf = normalize_notes_folder_path(&path)?;
    if window.label() == "main" {
        let _normalized = initialize_notes_folder(&app, &path_buf, &state)?;
        let _ = app.emit("workspaces-changed", ());
        return Ok(());
    }

    let (notes_folder, session) = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let path_buf = path_buf.clone();
        move || {
            let session = WorkspaceSession::initialize(&app, &path_buf)?;
            Ok::<(String, WorkspaceSession), String>((session.notes_folder.clone(), session))
        }
    })
    .await
    .map_err(|error| format!("Workspace initialization failed: {}", error))??;

    {
        let mut config = state.app_config.write().expect("app_config write lock");
        let mut next = config.clone();
        remember_workspace(&mut next, notes_folder.clone());
        upsert_window_session_workspace(&mut next, window.label(), notes_folder.clone());
        save_app_config(&app, &next).map_err(|e| e.to_string())?;
        *config = next;
    }
    state.register_workspace_session(window.label(), session);
    let _ = app.emit("workspaces-changed", ());
    Ok(())
}

#[tauri::command]
fn list_workspaces(window: WebviewWindow, state: State<AppState>) -> Vec<WorkspaceInfo> {
    let config = state
        .app_config
        .read()
        .expect("app_config read lock")
        .clone();
    let bindings = state
        .workspace_bindings
        .read()
        .expect("workspace bindings read lock");
    build_workspace_infos(&config, &bindings, window.label())
}

#[tauri::command]
fn remove_workspace_from_list(
    app: AppHandle,
    path: String,
    state: State<AppState>,
) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Workspace path is empty".to_string());
    }

    {
        let mut config = state.app_config.write().expect("app config write lock");
        let mut next = config.clone();
        if !forget_workspace(&mut next, path) {
            return Ok(());
        }
        save_app_config(&app, &next).map_err(|error| error.to_string())?;
        *config = next;
    }

    let _ = app.emit("workspaces-changed", ());
    let _ = remove_workspace_search_index(&app, path);
    Ok(())
}

#[tauri::command]
async fn switch_workspace(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path_buf = normalize_notes_folder_path(&path)?;
    let normalized_path = if window.label() == "main" {
        switch_main_workspace(&app, &path_buf, &state)?
    } else {
        let (notes_folder, session) = tauri::async_runtime::spawn_blocking({
            let app = app.clone();
            let path_buf = path_buf.clone();
            move || {
                let session = WorkspaceSession::initialize(&app, &path_buf)?;
                Ok::<(String, WorkspaceSession), String>((session.notes_folder.clone(), session))
            }
        })
        .await
        .map_err(|error| format!("Workspace initialization failed: {}", error))??;

        {
            let mut config = state.app_config.write().expect("app_config write lock");
            let mut next = config.clone();
            remember_workspace(&mut next, notes_folder.clone());
            upsert_window_session_workspace(
                &mut next,
                window.label(),
                notes_folder.clone(),
            );
            save_app_config(&app, &next).map_err(|error| error.to_string())?;
            *config = next;
        }
        state.register_workspace_session(window.label(), session);
        notes_folder
    };

    let _ = app.emit("workspaces-changed", ());
    Ok(normalized_path)
}

fn restore_window_session(
    app: &AppHandle,
    state: &AppState,
    label: &str,
    record: &WindowSession,
) -> Result<(), String> {
    let workspace_path = Path::new(&record.workspace);
    let existing_session = state.workspace_session_for_path(&record.workspace);
    if let Some(session) = existing_session {
        state
            .workspace_bindings
            .write()
            .expect("workspace bindings write lock")
            .bind(label, session.notes_folder.clone());
    } else {
        let session = WorkspaceSession::initialize(app, workspace_path)?;
        state.register_workspace_session(label, session);
    }

    if label == "main" {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "Main window not found".to_string())?;
        if let Some(geometry) = &record.geometry {
            let _ = window.set_position(tauri::PhysicalPosition::new(geometry.x, geometry.y));
            let _ = window.set_size(tauri::PhysicalSize::new(
                geometry.width,
                geometry.height,
            ));
        }
        return Ok(());
    }

    if app.get_webview_window(label).is_some() {
        return Ok(());
    }

    let title = workspace_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Scratch");
    let runtime_config = runtime_window_config_from_template(
        &app.config().app.windows[0],
        label,
        WebviewUrl::App("index.html?mode=workspace".into()),
    );
    let mut builder = WebviewWindowBuilder::from_config(app, &runtime_config)
        .map_err(|error| format!("Failed to configure workspace window {label}: {error}"))?
        .title(format!("{} — Scratch", title))
        .inner_size(1080.0, 720.0)
        .min_inner_size(600.0, 400.0)
        .resizable(true)
        .decorations(true);
    if let Some(geometry) = &record.geometry {
        builder = builder
            .position(geometry.x as f64, geometry.y as f64)
            .inner_size(geometry.width as f64, geometry.height as f64);
    }

    let window = builder.build().map_err(|error| {
        state.remove_workspace_session(label);
        format!("Failed to restore workspace window {label}: {error}")
    })?;
    let _ = window.show();
    Ok(())
}

#[tauri::command]
async fn open_workspace_window(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path_buf = normalize_notes_folder_path(&path)?;
    let init_app = app.clone();
    let session = tauri::async_runtime::spawn_blocking(move || {
        let state = init_app.state::<AppState>();
        state.get_or_initialize_workspace_session(&init_app, &path_buf)
    })
    .await
    .map_err(|error| format!("Workspace initialization failed: {}", error))??;
    let notes_folder = session.notes_folder.clone();

    let label = loop {
        let candidate = next_workspace_window_label(Path::new(&notes_folder));
        let record_exists = state
            .app_config
            .read()
            .expect("app config read lock")
            .records
            .contains_key(&candidate);
        if app.get_webview_window(&candidate).is_none() && !record_exists {
            break candidate;
        }
    };
    let title = Path::new(&notes_folder)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Scratch")
        .to_string();

    {
        let mut config = state.app_config.write().expect("app_config write lock");
        let mut next = config.clone();
        remember_workspace(&mut next, notes_folder.clone());
        upsert_window_session_workspace(&mut next, &label, notes_folder.clone());
        save_app_config(&app, &next).map_err(|error| error.to_string())?;
        *config = next;
    }
    let binding_result = state
        .bind_existing_workspace_session(&label, notes_folder.clone())
        .map(|_| ());
    if let Err(error) = binding_result {
        let _ = clear_window_session_record(&app, &state, &label);
        return Err(error);
    }

    let runtime_config = runtime_window_config_from_template(
        &app.config().app.windows[0],
        &label,
        WebviewUrl::App("index.html?mode=workspace".into()),
    );
    let builder = WebviewWindowBuilder::from_config(&app, &runtime_config)
        .map_err(|error| format!("Failed to configure workspace window: {error}"))?
        .title(format!("{} — Scratch", title))
        .inner_size(1080.0, 720.0)
        .min_inner_size(600.0, 400.0)
        .resizable(true)
        .decorations(true);

    let window = builder.build().map_err(|error| {
        state.remove_workspace_session(&label);
        let _ = clear_window_session_record(&app, &state, &label);
        format!("Failed to create workspace window: {}", error)
    })?;
    let _ = window.show();
    window.set_focus().map_err(|error| error.to_string())?;
    let _ = app.emit("workspaces-changed", ());

    Ok(label)
}

#[tauri::command]
async fn list_notes(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<NoteMetadata>, String> {
    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;

    let path = PathBuf::from(&folder);
    if !path.exists() {
        return Ok(vec![]);
    }

    let ignored_dirs = {
        let settings = workspace.settings().read().expect("settings read lock");
        get_effective_ignored_dirs(&settings)
    };

    let path_clone = path.clone();
    let discovered = tokio::task::spawn_blocking(move || {
        use walkdir::WalkDir;
        let mut results: Vec<(String, String, String, i64)> = Vec::new();
        for entry in WalkDir::new(&path_clone)
            .max_depth(10)
            .into_iter()
            .filter_entry(|e| is_visible_notes_entry(e, &ignored_dirs))
            .flatten()
        {
            let file_path = entry.path();
            if !file_path.is_file() {
                continue;
            }
            if let Some(id) = id_from_abs_path(&path_clone, file_path, &ignored_dirs) {
                if let Ok(content) = std::fs::read_to_string(file_path) {
                    let modified = entry
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    let title = extract_title(&content);
                    let preview = generate_preview(&content);
                    results.push((id, title, preview, modified));
                }
            }
        }
        results
    })
    .await
    .map_err(|e| e.to_string())?;

    let mut notes: Vec<NoteMetadata> = discovered
        .into_iter()
        .map(|(id, title, preview, modified)| NoteMetadata {
            id,
            title,
            preview,
            modified,
        })
        .collect();

    // Load pinned note IDs from settings
    let pinned_ids: HashSet<String> = {
        let settings = workspace.settings().read().expect("settings read lock");
        settings
            .pinned_note_ids
            .as_ref()
            .map(|ids| ids.iter().cloned().collect())
            .unwrap_or_default()
    };

    // Sort: pinned notes first (by date), then unpinned notes (by date)
    notes.sort_by(|a, b| {
        let a_pinned = pinned_ids.contains(&a.id);
        let b_pinned = pinned_ids.contains(&b.id);

        match (a_pinned, b_pinned) {
            (true, false) => std::cmp::Ordering::Less,    // a pinned, b not -> a first
            (false, true) => std::cmp::Ordering::Greater, // b pinned, a not -> b first
            _ => b.modified.cmp(&a.modified),             // both same status -> sort by date (newest first)
        }
    });

    // Update cache efficiently
    {
        let mut cache = workspace.notes_cache().write().expect("cache write lock");
        cache.clear();
        for note in &notes {
            cache.insert(note.id.clone(), note.clone());
        }
    }

    Ok(notes)
}

#[tauri::command]
async fn read_note(
    id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Note, String> {
    let workspace = state.workspace_for_window(window.label())?;
    let file_path = workspace.note_path(&id)?;
    if !file_path.exists() {
        return Err("Note not found".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || read_note_from_path(id, &file_path))
        .await
        .map_err(|error| format!("Note read task failed: {error}"))?
}

fn read_note_from_path(id: String, file_path: &Path) -> Result<Note, String> {
    let snapshot = persistence::read_snapshot(file_path)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Note not found".to_string())?;
    let metadata = std::fs::metadata(file_path).map_err(|error| error.to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);

    Ok(Note {
        id,
        title: extract_title(&snapshot.content),
        content: snapshot.content,
        path: file_path.to_string_lossy().into_owned(),
        modified,
        revision: snapshot.revision.to_string(),
    })
}

fn note_conflict_snapshot(
    current: Option<persistence::FileSnapshot>,
) -> Option<NoteConflictSnapshot> {
    current.map(|snapshot| NoteConflictSnapshot {
        content: snapshot.content,
        revision: snapshot.revision.to_string(),
    })
}

fn save_note_to_path(
    id: String,
    file_path: &Path,
    content: String,
    expected_revision: String,
) -> Result<NoteSaveResult, String> {
    let current = persistence::read_snapshot(file_path).map_err(|error| error.to_string())?;
    let expected = match current {
        Some(snapshot) if snapshot.revision.as_str() == expected_revision => snapshot.revision,
        current => {
            return Ok(NoteSaveResult::Conflict {
                current: note_conflict_snapshot(current),
            });
        }
    };

    match persistence::save_if_revision(file_path, &content, Some(&expected))
        .map_err(|error| error.to_string())?
    {
        persistence::SaveResult::Saved { .. } => Ok(NoteSaveResult::Saved {
            note: read_note_from_path(id, file_path)?,
        }),
        persistence::SaveResult::Conflict { current } => Ok(NoteSaveResult::Conflict {
            current: note_conflict_snapshot(current),
        }),
    }
}

fn write_recovery_snapshot(
    recovery_root: &Path,
    note_id: &str,
    source_path: &str,
    content: &str,
    reason: &str,
) -> Result<PathBuf, String> {
    let recovery_directory = recovery_root.join("recovery");
    std::fs::create_dir_all(&recovery_directory).map_err(|error| error.to_string())?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let sequence = RECOVERY_SNAPSHOT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let safe_note_id = sanitize_filename(&note_id.replace('/', "-"));
    let safe_reason = sanitize_filename(reason);
    let stem = format!("{timestamp}-{sequence}-{safe_reason}-{safe_note_id}");
    let recovery_path = recovery_directory.join(format!("{stem}.md"));

    match persistence::save_if_revision(&recovery_path, content, None)
        .map_err(|error| error.to_string())?
    {
        persistence::SaveResult::Saved { .. } => {}
        persistence::SaveResult::Conflict { .. } => {
            return Err("Recovery snapshot path unexpectedly already exists".to_string());
        }
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RecoveryMetadata<'a> {
        note_id: &'a str,
        source_path: &'a str,
        reason: &'a str,
        created_at_ms: u128,
    }

    let metadata = RecoveryMetadata {
        note_id,
        source_path,
        reason,
        created_at_ms: timestamp,
    };
    if let Ok(metadata_content) = serde_json::to_string_pretty(&metadata) {
        let metadata_path = recovery_directory.join(format!("{stem}.json"));
        let _ = persistence::save_if_revision(&metadata_path, &metadata_content, None);
    }

    Ok(recovery_path)
}

#[tauri::command]
async fn persist_recovery_snapshot(
    app: AppHandle,
    note_id: String,
    source_path: String,
    content: String,
    reason: String,
) -> Result<String, String> {
    let recovery_root = app.path().app_data_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        write_recovery_snapshot(
            &recovery_root,
            &note_id,
            &source_path,
            &content,
            &reason,
        )
        .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| format!("Recovery snapshot task failed: {error}"))?
}

#[tauri::command]
async fn write_draft_checkpoint(
    app: AppHandle,
    window: WebviewWindow,
    note_id: String,
    markdown: String,
    metadata: draft_checkpoint::DraftCheckpointMetadata,
) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let checkpoint = draft_checkpoint::DraftCheckpoint {
        key: draft_checkpoint::DraftCheckpointKey {
            window_label: window.label().to_string(),
            note_id,
        },
        markdown,
        metadata,
    };
    tauri::async_runtime::spawn_blocking(move || {
        draft_checkpoint::write_checkpoint(app_data, &checkpoint)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Draft checkpoint task failed: {error}"))?
}

#[tauri::command]
async fn get_draft_checkpoint(
    app: AppHandle,
    window: WebviewWindow,
    note_id: String,
) -> Result<Option<draft_checkpoint::DraftCheckpoint>, String> {
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let key = draft_checkpoint::DraftCheckpointKey {
        window_label: window.label().to_string(),
        note_id,
    };
    tauri::async_runtime::spawn_blocking(move || {
        draft_checkpoint::read_checkpoint(app_data, &key).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Draft checkpoint read task failed: {error}"))?
}

#[tauri::command]
async fn clear_draft_checkpoint(
    app: AppHandle,
    window: WebviewWindow,
    note_id: String,
) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let key = draft_checkpoint::DraftCheckpointKey {
        window_label: window.label().to_string(),
        note_id,
    };
    tauri::async_runtime::spawn_blocking(move || {
        draft_checkpoint::clear_checkpoint(app_data, &key).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Draft checkpoint clear task failed: {error}"))?
}

#[tauri::command]
async fn list_draft_checkpoints(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<draft_checkpoint::DraftCheckpoint>, String> {
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let window_label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        draft_checkpoint::list_checkpoints(app_data)
            .map(|checkpoints| {
                checkpoints
                    .into_iter()
                    .filter(|checkpoint| checkpoint.key.window_label == window_label)
                    .collect()
            })
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Draft checkpoint list task failed: {error}"))?
}

#[tauri::command]
async fn save_note(
    app: AppHandle,
    id: Option<String>,
    content: String,
    expected_revision: Option<String>,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<NoteSaveResult, String> {
    let workspace = state.workspace_for_window(window.label())?;
    let workspace_path = workspace.notes_folder()?;
    let previous_id = id.clone();
    let result = save_note_in_workspace(id, content, expected_revision, &workspace).await?;
    if let NoteSaveResult::Saved { note } = &result {
        let kind = if previous_id.as_deref().is_some_and(|id| id != note.id) {
            "renamed"
        } else {
            "modified"
        };
        emit_workspace_file_change(
            &app,
            &state,
            Path::new(&note.path),
            semantic_file_change_event(
                workspace_path,
                kind,
                previous_id.filter(|id| id != &note.id),
                Some(note),
                Some(window.label().to_string()),
            ),
            Some(window.label()),
        );
    }
    Ok(result)
}

async fn save_note_in_workspace(
    id: Option<String>,
    content: String,
    expected_revision: Option<String>,
    workspace: &WorkspaceRuntime<'_>,
) -> Result<NoteSaveResult, String> {
    let folder = workspace.notes_folder()?;
    let folder_path = PathBuf::from(&folder);

    let title = extract_title(&content);
    let sanitized_leaf = sanitize_filename(&title);
    let creates_new_note = id.is_none();

    // Determine the file ID and path, handling renames
    let (final_id, file_path, old_id) = if let Some(existing_id) = id {
        // Preserve directory prefix for notes in subfolders
        let (dir_prefix, desired_id) = if let Some(pos) = existing_id.rfind('/') {
            let prefix = &existing_id[..pos];
            (Some(prefix.to_string()), format!("{}/{}", prefix, sanitized_leaf))
        } else {
            (None, sanitized_leaf.clone())
        };

        let old_file_path = abs_path_from_id(&folder_path, &existing_id)?;

        if existing_id != desired_id {
            let mut new_id = desired_id.clone();
            let mut counter = 1;

            while new_id != existing_id
                && abs_path_from_id(&folder_path, &new_id)
                    .map(|p| p.exists())
                    .unwrap_or(false)
            {
                new_id = if let Some(ref prefix) = dir_prefix {
                    format!("{}/{}-{}", prefix, sanitized_leaf, counter)
                } else {
                    format!("{}-{}", sanitized_leaf, counter)
                };
                counter += 1;
            }

            let new_file_path = abs_path_from_id(&folder_path, &new_id)?;
            (new_id, new_file_path, Some((existing_id, old_file_path)))
        } else {
            (existing_id, old_file_path, None)
        }
    } else {
        // New notes go in root
        let mut new_id = sanitized_leaf.clone();
        let mut counter = 1;

        while abs_path_from_id(&folder_path, &new_id)
            .map(|p| p.exists())
            .unwrap_or(false)
        {
            new_id = format!("{}-{}", sanitized_leaf, counter);
            counter += 1;
        }

        let new_file_path = abs_path_from_id(&folder_path, &new_id)?;
        (new_id, new_file_path, None)
    };

    let initial_id = old_id
        .as_ref()
        .map(|(old_id, _)| old_id.clone())
        .unwrap_or_else(|| final_id.clone());
    let initial_path = old_id
        .as_ref()
        .map(|(_, old_path)| old_path.clone())
        .unwrap_or_else(|| file_path.clone());

    let initial_result = if let Some(expected_revision) = expected_revision {
        let save_id = initial_id.clone();
        let save_path = initial_path.clone();
        let save_content = content.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<NoteSaveResult, String> {
            save_note_to_path(save_id, &save_path, save_content, expected_revision)
        })
        .await
        .map_err(|error| format!("Note save task failed: {error}"))??
    } else if creates_new_note {
        let create_path = file_path.clone();
        let create_content = content.clone();
        let create_id = final_id.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<NoteSaveResult, String> {
            match persistence::save_if_revision(&create_path, &create_content, None)
                .map_err(|error| error.to_string())?
            {
                persistence::SaveResult::Saved { .. } => Ok(NoteSaveResult::Saved {
                    note: read_note_from_path(create_id, &create_path)?,
                }),
                persistence::SaveResult::Conflict { current } => {
                    Ok(NoteSaveResult::Conflict {
                        current: note_conflict_snapshot(current),
                    })
                }
            }
        })
        .await
        .map_err(|error| format!("Note create task failed: {error}"))??
    } else {
        return Err("Expected revision is required when saving an existing note".to_string());
    };

    let mut saved_note = match initial_result {
        NoteSaveResult::Conflict { current } => {
            return Ok(NoteSaveResult::Conflict { current });
        }
        NoteSaveResult::Saved { note } => note,
    };

    // A title change renames the note only after the original path has passed
    // compare-and-swap. The target is create-only, so a concurrent file can
    // never be overwritten. Failure leaves the durable updated source intact.
    if let Some((_, ref old_file_path)) = old_id {
        if *old_file_path != file_path {
            let target_path = file_path.clone();
            let target_path_for_cleanup = target_path.clone();
            let target_content = content.clone();
            let target_result = tauri::async_runtime::spawn_blocking(move || {
                persistence::save_if_revision(&target_path, &target_content, None)
                    .map_err(|error| error.to_string())
            })
            .await
            .map_err(|error| format!("Note rename task failed: {error}"))??;

            if matches!(target_result, persistence::SaveResult::Conflict { .. }) {
                return Err("Rename target changed while saving; source note was preserved".into());
            }

            if let Err(remove_error) = fs::remove_file(old_file_path)
                .await
                .map_err(|error| format!("Saved renamed note but could not remove source: {error}"))
            {
                let _ = fs::remove_file(&target_path_for_cleanup).await;
                return Err(remove_error);
            }
            let renamed_id = final_id.clone();
            let renamed_path = file_path.clone();
            saved_note = tauri::async_runtime::spawn_blocking(move || {
                read_note_from_path(renamed_id, &renamed_path)
            })
            .await
            .map_err(|error| format!("Renamed note read task failed: {error}"))??;
        }
    }

    let modified = saved_note.modified;

    // Update search index (delete old entry if renamed, then add new)
    {
        let index = workspace.search_index().lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            if let Some((ref old_id_str, _)) = old_id {
                let _ = search_index.delete_note(old_id_str);
            }
            let _ = search_index.index_note(&final_id, &title, &content, modified);
        }
    }

    // Update cache (remove old entry if renamed)
    if let Some((ref old_id_str, _)) = old_id {
        let mut cache = workspace.notes_cache().write().expect("cache write lock");
        cache.remove(old_id_str);
    }

    Ok(NoteSaveResult::Saved { note: saved_note })
}

#[tauri::command]
async fn delete_note(
    app: AppHandle,
    id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspace = state.workspace_for_window(window.label())?;
    let workspace_path = workspace.notes_folder()?;
    let file_path = workspace.note_path(&id)?;
    if file_path.exists() {
        fs::remove_file(&file_path)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Update search index
    {
        let index = workspace.search_index().lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            let _ = search_index.delete_note(&id);
        }
    }

    // Remove from cache
    {
        let mut cache = workspace.notes_cache().write().expect("cache write lock");
        cache.remove(&id);
    }

    emit_workspace_file_change(
        &app,
        &state,
        &file_path,
        semantic_file_change_event(
            workspace_path,
            "deleted",
            Some(id),
            None,
            Some(window.label().to_string()),
        ),
        Some(window.label()),
    );

    Ok(())
}

#[tauri::command]
async fn create_note(
    target_folder: Option<String>,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Note, String> {
    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;
    let folder_path = PathBuf::from(&folder);

    // Get global template (default "Untitled")
    let template = {
        let config = state.app_config.read().expect("app config read lock");
        config
            .global_settings
            .as_ref()
            .and_then(|settings| settings.default_note_name.clone())
            .unwrap_or_else(|| "Untitled".to_string())
    };

    // Expand template tags
    let expanded = expand_note_name_template(&template);

    // Sanitize filename
    let sanitized = sanitize_filename(&expanded);

    // Prepend folder prefix if specified
    let sanitized = if let Some(ref folder_prefix) = target_folder {
        if folder_prefix.is_empty() {
            sanitized
        } else {
            format!("{}/{}", folder_prefix.trim_end_matches('/'), sanitized)
        }
    } else {
        sanitized
    };

    // Handle {counter} tag
    let has_counter = template.contains("{counter}");
    let base_id = if has_counter {
        sanitized.replace("{counter}", "1")
    } else {
        sanitized.clone()
    };

    let mut final_id = base_id.clone();
    let mut counter = if has_counter { 2 } else { 1 };

    // Extract display title from filename
    let display_title = extract_title_from_id(&final_id);
    let content = format!("# {}\n\n", display_title);
    let file_path = abs_path_from_id(&folder_path, &final_id)?;

    // Create parent directories (for templates like {year}/{month}/{day})
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    loop {
        let create_path = file_path.clone();
        let create_content = content.clone();
        let _create_id = final_id.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            persistence::save_if_revision(&create_path, &create_content, None)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

        match result {
            persistence::SaveResult::Saved { .. } => break,
            persistence::SaveResult::Conflict { current } => {
                if current.is_none() {
                    return Err("Note file unexpectedly already exists".to_string());
                }
                final_id = if has_counter {
                    sanitized.replace("{counter}", &counter.to_string())
                } else {
                    format!("{}-{}", base_id, counter)
                };
                counter += 1;
            }
        }
    }

    let modified = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Update search index
    {
        let index = workspace.search_index().lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            let _ = search_index.index_note(&final_id, &display_title, &content, modified);
        }
    }

    let created_note = Note {
        id: final_id,
        title: display_title,
        revision: persistence::content_revision(&content).to_string(),
        content,
        path: file_path.to_string_lossy().into_owned(),
        modified,
    };

    {
        let mut cache = workspace.notes_cache().write().expect("cache write lock");
        cache.insert(created_note.id.clone(), NoteMetadata {
            id: created_note.id.clone(),
            title: created_note.title.clone(),
            preview: generate_preview(&created_note.content),
            modified: created_note.modified,
        });
    }

    emit_workspace_file_change(
        window.app_handle(),
        &state,
        Path::new(&created_note.path),
        semantic_file_change_event(
            folder,
            "created",
            None,
            Some(&created_note),
            Some(window.label().to_string()),
        ),
        Some(window.label()),
    );

    Ok(created_note)
}

#[tauri::command]
async fn duplicate_note(
    id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Note, String> {
    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;
    let folder_path = PathBuf::from(&folder);

    let original = read_note(id.clone(), window.clone(), state.clone())
        .await
        .map_err(|e| format!("Failed to read original note: {e}"))?;

    let base_title = extract_title(&original.content);
    let copy_title = if base_title.trim().is_empty() {
        "Copy"
    } else {
        &base_title
    };
    let copy_title = format!("{} (Copy)", copy_title);
    let sanitized = sanitize_filename(&copy_title);

    let folder_prefix = if let Some(pos) = id.rfind('/') {
        Some(id[..pos].to_string())
    } else {
        None
    };
    let sanitized = if let Some(ref prefix) = folder_prefix {
        format!("{}/{}", prefix, sanitized)
    } else {
        sanitized
    };

    let mut final_id = sanitized.clone();
    let mut counter = 1;
    while abs_path_from_id(&folder_path, &final_id)
        .map(|p| p.exists())
        .unwrap_or(false)
    {
        final_id = if let Some(ref prefix) = folder_prefix {
            format!("{}/{}-{}", prefix, copy_title, counter)
        } else {
            format!("{}-{}", copy_title, counter)
        };
        counter += 1;
    }

    let duplicated_content = if original.content.starts_with("# ") {
        if let Some(rest) = original.content.strip_prefix("# ") {
            let first_line_end = rest.find('\n').map_or(rest.len(), |i| i);
            let title = &rest[..first_line_end];
            format!("# {} (Copy){}", title, &rest[first_line_end..])
        } else {
            format!("# {} (Copy)", base_title)
        }
    } else {
        original.content.clone()
    };
    let display_title = extract_title_from_id(&final_id);
    let content = duplicated_content;
    let file_path = abs_path_from_id(&folder_path, &final_id)?;

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    loop {
        let create_path = file_path.clone();
        let create_content = content.clone();
        let _create_id = final_id.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            persistence::save_if_revision(&create_path, &create_content, None)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

        match result {
            persistence::SaveResult::Saved { .. } => break,
            persistence::SaveResult::Conflict { current } => {
                if current.is_none() {
                    return Err("Duplicate note file unexpectedly already exists".to_string());
                }
                final_id = if let Some(ref prefix) = folder_prefix {
                    format!("{}/{}-{}", prefix, copy_title, counter)
                } else {
                    format!("{}-{}", copy_title, counter)
                };
                counter += 1;
            }
        }
    }

    let modified = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    {
        let index = workspace.search_index().lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            let _ = search_index.index_note(&final_id, &display_title, &content, modified);
        }
    }

    let created_note = Note {
        id: final_id,
        title: display_title,
        revision: persistence::content_revision(&content).to_string(),
        content,
        path: file_path.to_string_lossy().into_owned(),
        modified,
    };

    {
        let mut cache = workspace.notes_cache().write().expect("cache write lock");
        cache.insert(created_note.id.clone(), NoteMetadata {
            id: created_note.id.clone(),
            title: created_note.title.clone(),
            preview: generate_preview(&created_note.content),
            modified: created_note.modified,
        });
    }

    emit_workspace_file_change(
        window.app_handle(),
        &state,
        Path::new(&created_note.path),
        semantic_file_change_event(
            folder,
            "created",
            None,
            Some(&created_note),
            Some(window.label().to_string()),
        ),
        Some(window.label()),
    );

    Ok(created_note)
}

/// Validate a relative folder path against traversal attacks
const RESERVED_FOLDER_NAMES: &[&str] = &[".git", ".scratch", ".obsidian", ".trash", "assets"];

fn validate_folder_path(path: &str) -> Result<(), String> {
    if path.contains('\\') {
        return Err("Invalid path: backslashes not allowed".to_string());
    }
    if path.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    let rel = Path::new(path);
    for component in rel.components() {
        match component {
            std::path::Component::ParentDir => {
                return Err("Path traversal not allowed".to_string());
            }
            std::path::Component::CurDir => {
                return Err("Invalid path: current directory references not allowed".to_string());
            }
            std::path::Component::RootDir | std::path::Component::Prefix(_) => {
                return Err("Invalid path: absolute paths not allowed".to_string());
            }
            std::path::Component::Normal(name) => {
                if let Some(name_str) = name.to_str() {
                    if RESERVED_FOLDER_NAMES.contains(&name_str) {
                        return Err(format!("'{}' is a reserved folder name", name_str));
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn list_folders(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;
    let folder_path = PathBuf::from(&folder);

    let ignored_dirs = {
        let settings = workspace.settings().read().expect("settings read lock");
        get_effective_ignored_dirs(&settings)
    };

    let fp = folder_path.clone();
    tokio::task::spawn_blocking(move || {
        let mut folders = Vec::new();
        use walkdir::WalkDir;
        for entry in WalkDir::new(&fp)
            .max_depth(10)
            .into_iter()
            .filter_entry(|e| is_visible_notes_entry(e, &ignored_dirs))
            .flatten()
        {
            if entry.file_type().is_dir() && entry.path() != fp {
                if let Ok(rel) = entry.path().strip_prefix(&fp) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    if !rel_str.is_empty() {
                        folders.push(rel_str);
                    }
                }
            }
        }
        folders.sort();
        folders
    })
    .await
    .map_err(|e| format!("Failed to list folders: {}", e))
}

#[tauri::command]
async fn create_folder(
    path: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let folder = state
        .workspace_for_window(window.label())?
        .notes_folder()?;

    validate_folder_path(&path)?;

    let target = PathBuf::from(&folder).join(path.replace('/', std::path::MAIN_SEPARATOR_STR));

    if !target.starts_with(&folder) {
        return Err("Invalid path: escapes notes folder".to_string());
    }

    fs::create_dir_all(&target)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn delete_folder(
    path: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;

    validate_folder_path(&path)?;

    let target = PathBuf::from(&folder).join(path.replace('/', std::path::MAIN_SEPARATOR_STR));

    if !target.starts_with(&folder) {
        return Err("Invalid path: escapes notes folder".to_string());
    }

    if !target.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    // Remove notes from search index
    {
        let index = workspace.search_index().lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            let cache = workspace.notes_cache().read().expect("cache read lock");
            let prefix = format!("{}/", path);
            for note_id in cache.keys() {
                if note_id.starts_with(&prefix) {
                    let _ = search_index.delete_note(note_id);
                }
            }
        }
    }

    // Remove notes from cache
    {
        let mut cache = workspace.notes_cache().write().expect("cache write lock");
        let prefix = format!("{}/", path);
        cache.retain(|id, _| !id.starts_with(&prefix));
    }

    fs::remove_dir_all(&target)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn rename_folder(
    old_path: String,
    new_name: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;

    validate_folder_path(&old_path)?;

    // Sanitize new name (no slashes allowed in the name itself)
    let sanitized_name = new_name
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-")
        .trim()
        .to_string();
    if sanitized_name.is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }

    let folder_root = PathBuf::from(&folder);
    let old_target = folder_root.join(old_path.replace('/', std::path::MAIN_SEPARATOR_STR));

    if !old_target.starts_with(&folder_root) {
        return Err("Invalid path: escapes notes folder".to_string());
    }
    if !old_target.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    // Build new path: same parent, new name
    let new_target = old_target
        .parent()
        .ok_or("Cannot determine parent directory")?
        .join(&sanitized_name);

    if new_target.exists() {
        return Err("A folder with that name already exists".to_string());
    }

    // Compute old and new path prefixes for updating IDs
    let old_prefix = format!("{}/", old_path);
    let new_path = if old_path.contains('/') {
        let parent = &old_path[..old_path.rfind('/').unwrap()];
        format!("{}/{}", parent, sanitized_name)
    } else {
        sanitized_name.clone()
    };
    let new_prefix = format!("{}/", new_path);

    // Rename on disk
    tokio::fs::rename(&old_target, &new_target)
        .await
        .map_err(|e| e.to_string())?;

    // Update pinned note IDs in settings
    {
        let mut settings = workspace.settings().write().expect("settings write lock");
        if let Some(ref mut pinned) = settings.pinned_note_ids {
            for id in pinned.iter_mut() {
                if id.starts_with(&old_prefix) {
                    *id = format!("{}{}", new_prefix, &id[old_prefix.len()..]);
                } else if *id == old_path {
                    *id = new_path.clone();
                }
            }
        }
        // Save settings
        let _ = save_settings(&folder, &settings);
    }

    // Update cache
    {
        let mut cache = workspace.notes_cache().write().expect("cache write lock");
        let updates: Vec<(String, String)> = cache
            .keys()
            .filter(|id| id.starts_with(&old_prefix))
            .map(|id| {
                let new_id = format!("{}{}", new_prefix, &id[old_prefix.len()..]);
                (id.clone(), new_id)
            })
            .collect();
        for (old_id, new_id) in updates {
            if let Some(mut meta) = cache.remove(&old_id) {
                meta.id = new_id.clone();
                cache.insert(new_id, meta);
            }
        }
    }

    // Rebuild search index for affected notes
    {
        let index = workspace.search_index().lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            let ignored_dirs = {
                let settings = workspace.settings().read().expect("settings read lock");
                get_effective_ignored_dirs(&settings)
            };
            let _ = search_index.rebuild_index(&folder_root, &ignored_dirs);
        }
    }

    Ok(())
}

#[tauri::command]
async fn move_note(
    app: AppHandle,
    id: String,
    target_folder: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;
    let folder_root = PathBuf::from(&folder);
    let source_path = abs_path_from_id(&folder_root, &id)?;

    if !source_path.exists() {
        return Err("Note not found".to_string());
    }

    // Extract the filename (leaf) from the note ID
    let leaf = id.rsplit('/').next().unwrap_or(&id);

    // Build new ID
    let new_id = if target_folder.is_empty() {
        leaf.to_string()
    } else {
        validate_folder_path(&target_folder)?;
        format!("{}/{}", target_folder, leaf)
    };

    if new_id == id {
        return Ok(id);
    }

    let dest_path = abs_path_from_id(&folder_root, &new_id)?;

    // Ensure target directory exists
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }

    // Handle collision
    if dest_path.exists() {
        return Err("A note with that name already exists in the target folder".to_string());
    }

    tokio::fs::rename(&source_path, &dest_path)
        .await
        .map_err(|e| e.to_string())?;

    // Update pinned note IDs
    {
        let mut settings = workspace.settings().write().expect("settings write lock");
        if let Some(ref mut pinned) = settings.pinned_note_ids {
            for pin_id in pinned.iter_mut() {
                if *pin_id == id {
                    *pin_id = new_id.clone();
                }
            }
        }
        let _ = save_settings(&folder, &settings);
    }

    // Update cache
    {
        let mut cache = workspace.notes_cache().write().expect("cache write lock");
        if let Some(mut meta) = cache.remove(&id) {
            meta.id = new_id.clone();
            cache.insert(new_id.clone(), meta);
        }
    }

    // Rebuild search index
    {
        let index = workspace.search_index().lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            let ignored_dirs = {
                let settings = workspace.settings().read().expect("settings read lock");
                get_effective_ignored_dirs(&settings)
            };
            let _ = search_index.rebuild_index(&folder_root, &ignored_dirs);
        }
    }

    let moved_note = {
        let moved_id = new_id.clone();
        let moved_path = dest_path.clone();
        tauri::async_runtime::spawn_blocking(move || read_note_from_path(moved_id, &moved_path))
            .await
            .map_err(|error| format!("Moved note read task failed: {error}"))??
    };

    emit_workspace_file_change(
        &app,
        &state,
        &dest_path,
        semantic_file_change_event(
            folder,
            "moved",
            Some(id),
            Some(&moved_note),
            Some(window.label().to_string()),
        ),
        Some(window.label()),
    );

    Ok(new_id)
}

#[tauri::command]
async fn move_folder(
    path: String,
    target_parent: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;

    validate_folder_path(&path)?;
    if !target_parent.is_empty() {
        validate_folder_path(&target_parent)?;
    }

    let folder_root = PathBuf::from(&folder);
    let source = folder_root.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));

    if !source.is_dir() {
        return Err("Source is not a directory".to_string());
    }

    // Get folder name
    let name = source
        .file_name()
        .ok_or("Cannot determine folder name")?
        .to_string_lossy()
        .to_string();

    let dest = if target_parent.is_empty() {
        folder_root.join(&name)
    } else {
        folder_root
            .join(target_parent.replace('/', std::path::MAIN_SEPARATOR_STR))
            .join(&name)
    };

    // Prevent moving into itself
    if dest.starts_with(&source) {
        return Err("Cannot move a folder into itself".to_string());
    }

    if dest.exists() {
        return Err("A folder with that name already exists in the target".to_string());
    }

    // Ensure target parent exists
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }

    // Compute old and new path prefixes for updating IDs
    let old_prefix = format!("{}/", path);
    let new_path = if target_parent.is_empty() {
        name.clone()
    } else {
        format!("{}/{}", target_parent, name)
    };
    let new_prefix = format!("{}/", new_path);

    tokio::fs::rename(&source, &dest)
        .await
        .map_err(|e| e.to_string())?;

    // Update pinned note IDs
    {
        let mut settings = workspace.settings().write().expect("settings write lock");
        if let Some(ref mut pinned) = settings.pinned_note_ids {
            for pin_id in pinned.iter_mut() {
                if pin_id.starts_with(&old_prefix) {
                    *pin_id = format!("{}{}", new_prefix, &pin_id[old_prefix.len()..]);
                }
            }
        }
        let _ = save_settings(&folder, &settings);
    }

    // Update cache
    {
        let mut cache = workspace.notes_cache().write().expect("cache write lock");
        let updates: Vec<(String, String)> = cache
            .keys()
            .filter(|id| id.starts_with(&old_prefix))
            .map(|id| {
                let new_id = format!("{}{}", new_prefix, &id[old_prefix.len()..]);
                (id.clone(), new_id)
            })
            .collect();
        for (old_id, new_id) in updates {
            if let Some(mut meta) = cache.remove(&old_id) {
                meta.id = new_id.clone();
                cache.insert(new_id, meta);
            }
        }
    }

    // Rebuild search index
    {
        let index = workspace.search_index().lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            let ignored_dirs = {
                let settings = workspace.settings().read().expect("settings read lock");
                get_effective_ignored_dirs(&settings)
            };
            let _ = search_index.rebuild_index(&folder_root, &ignored_dirs);
        }
    }

    Ok(())
}

#[tauri::command]
fn get_settings(window: WebviewWindow, state: State<AppState>) -> Settings {
    let workspace_settings = match state.workspace_for_window(window.label()) {
        Ok(workspace) => workspace
            .settings()
            .read()
            .expect("settings read lock")
            .clone(),
        Err(error) => {
            eprintln!(
                "Failed to resolve settings workspace for window {}: {}",
                window.label(),
                error,
            );
            WorkspaceSettings::default()
        }
    };
    let global_settings = state
        .app_config
        .read()
        .expect("app config read lock")
        .global_settings
        .clone()
        .unwrap_or_default();

    merge_settings(&global_settings, &workspace_settings)
}

fn emit_settings_changed(
    app: &AppHandle,
    state: &AppState,
    scope: SettingsChangeScope,
    workspace: Option<String>,
) {
    let payload = SettingsChangedPayload { scope, workspace };
    let targets = {
        let bindings = state
            .workspace_bindings
            .read()
            .expect("workspace bindings read lock");
        settings_change_targets(&bindings, scope, payload.workspace.as_deref())
    };

    match targets {
        SettingsChangeTargets::All => {
            let _ = app.emit("settings-changed", payload);
        }
        SettingsChangeTargets::Windows(labels) => {
            for label in labels {
                let _ = app.emit_to(&label, "settings-changed", payload.clone());
            }
        }
    }
}

#[tauri::command]
fn update_global_settings(
    patch: serde_json::Value,
    window: WebviewWindow,
    state: State<AppState>,
) -> Result<(), String> {
    {
        let mut config = state.app_config.write().expect("app config write lock");
        let current = config.global_settings.clone().unwrap_or_default();
        let updated = apply_settings_patch(&current, patch)?;
        let mut next_config = config.clone();
        next_config.global_settings = Some(updated);
        save_app_config(window.app_handle(), &next_config).map_err(|error| error.to_string())?;
        *config = next_config;
    }

    emit_settings_changed(
        window.app_handle(),
        &state,
        SettingsChangeScope::Global,
        None,
    );
    Ok(())
}

#[tauri::command]
fn update_workspace_settings(
    patch: serde_json::Value,
    window: WebviewWindow,
    state: State<AppState>,
) -> Result<(), String> {
    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;
    {
        let mut settings = workspace.settings().write().expect("settings write lock");
        let updated = apply_settings_patch(&*settings, patch)?;
        save_settings(&folder, &updated).map_err(|error| error.to_string())?;
        *settings = updated;
    }

    emit_settings_changed(
        window.app_handle(),
        &state,
        SettingsChangeScope::Workspace,
        Some(folder),
    );
    Ok(())
fn get_settings(state: State<AppState>) -> Settings {
    let folder = {
        let app_config = state.app_config.read().expect("settings read lock");
        app_config.notes_folder.clone()
    };
    let fallback = state.settings.read().expect("settings read lock").clone();
    match folder {
        Some(ref folder) => match load_settings(folder) {
            Ok(loaded) => loaded,
            Err(error) => {
                eprintln!("Failed to load workspace settings: {}", error);
                fallback
            }
        },
        None => fallback,
    }
}

#[tauri::command]
fn update_settings(
    new_settings: Settings,
    window: WebviewWindow,
    state: State<AppState>,
) -> Result<(), String> {
    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;
    let (global_settings, workspace_settings) = split_settings(new_settings);

    {
        // Compatibility full-replacement path. Keep both scope locks through
        // persistence so it cannot interleave with the atomic patch commands.
        let mut config = state.app_config.write().expect("app config write lock");
        let mut settings = workspace.settings().write().expect("settings write lock");
        let mut next = config.clone();
        next.global_settings = Some(global_settings);
        save_app_config(window.app_handle(), &next).map_err(|error| error.to_string())?;
        save_settings(&folder, &workspace_settings).map_err(|error| error.to_string())?;
        *config = next;
        *settings = workspace_settings;
    }

    emit_settings_changed(
        window.app_handle(),
        &state,
        SettingsChangeScope::Global,
        None,
    );
    emit_settings_changed(
        window.app_handle(),
        &state,
        SettingsChangeScope::Workspace,
        Some(folder),
    );

    Ok(())
}

#[tauri::command]
fn update_git_enabled(
    enabled: Option<bool>,
    expected_folder: String,
    window: WebviewWindow,
    state: State<AppState>,
) -> Result<(), String> {
    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;
    if folder != expected_folder {
        return Err("Notes folder changed".to_string());
    }

    let mut settings = workspace
        .settings()
        .write()
        .expect("settings write lock");
    let mut next = settings.clone();
    next.git_enabled = enabled;
    save_settings(&folder, &next).map_err(|e| e.to_string())?;
    *settings = next;

    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        let folder = app_config.notes_folder.clone().ok_or("Notes folder not set")?;

        if folder != expected_folder {
            return Err("Notes folder changed".to_string());
        }

        folder
    };

    let mut cloned_settings = {
        let settings = state.settings.read().expect("settings read lock");
        settings.clone()
    };
    cloned_settings.git_enabled = enabled;

    save_settings(&folder, &cloned_settings).map_err(|e| e.to_string())?;

    {
        let mut settings = state.settings.write().expect("settings write lock");
        *settings = cloned_settings;
    }

    Ok(())
}

#[tauri::command]
async fn write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    fs::write(&path, contents)
        .await
        .map_err(|_| "Failed to write file".to_string())
}

#[tauri::command]
fn preview_note_name(template: String) -> Result<String, String> {
    let expanded = expand_note_name_template(&template);
    let sanitized = sanitize_filename(&expanded);

    // Show first note name (with counter as 1 if present)
    let preview = if template.contains("{counter}") {
        sanitized.replace("{counter}", "1")
    } else {
        sanitized
    };

    Ok(preview)
}

// Preview mode: file content returned by read_file_direct / save_file_direct
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub title: String,
    pub modified: i64,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum FileSaveResult {
    Saved { file: FileContent },
    Conflict { current: Option<NoteConflictSnapshot> },
}

fn read_file_content_from_path(path: &Path) -> Result<FileContent, String> {
    let snapshot = persistence::read_snapshot(path)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "File not found".to_string())?;
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);

    Ok(FileContent {
        path: path.to_string_lossy().into_owned(),
        title: extract_title(&snapshot.content),
        content: snapshot.content,
        modified,
        revision: snapshot.revision.to_string(),
    })
}

fn save_file_content_to_path(
    path: &Path,
    content: String,
    expected_revision: String,
) -> Result<FileSaveResult, String> {
    let current = persistence::read_snapshot(path).map_err(|error| error.to_string())?;
    let expected = match current {
        Some(snapshot) if snapshot.revision.as_str() == expected_revision => snapshot.revision,
        current => {
            return Ok(FileSaveResult::Conflict {
                current: note_conflict_snapshot(current),
            });
        }
    };

    match persistence::save_if_revision(path, &content, Some(&expected))
        .map_err(|error| error.to_string())?
    {
        persistence::SaveResult::Saved { .. } => Ok(FileSaveResult::Saved {
            file: read_file_content_from_path(path)?,
        }),
        persistence::SaveResult::Conflict { current } => Ok(FileSaveResult::Conflict {
            current: note_conflict_snapshot(current),
        }),
    }
}

fn recreate_file_content_to_path(
    path: &Path,
    content: String,
) -> Result<FileSaveResult, String> {
    match persistence::save_if_revision(path, &content, None)
        .map_err(|error| error.to_string())?
    {
        persistence::SaveResult::Saved { .. } => Ok(FileSaveResult::Saved {
            file: read_file_content_from_path(path)?,
        }),
        persistence::SaveResult::Conflict { current } => Ok(FileSaveResult::Conflict {
            current: note_conflict_snapshot(current),
        }),
    }
}

/// Validate a file path for preview mode direct file operations.
/// Ensures the path is a markdown file and resolves symlinks.
fn validate_preview_path(path: &str) -> Result<PathBuf, String> {
    let file_path = PathBuf::from(path);

    // Must have a markdown extension
    match file_path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown") => {}
        _ => return Err("Only .md and .markdown files are allowed".to_string()),
    }

    // Resolve symlinks to get the real path
    let canonical = file_path
        .canonicalize()
        .map_err(|e| format!("Cannot resolve file path: {}", e))?;

    Ok(canonical)
}

/// Validate a missing direct-file target through its existing canonical parent.
/// The final component remains unresolved so create-only persistence can detect
/// a concurrent recreation without ever replacing it.
fn validate_preview_create_path(path: &str) -> Result<PathBuf, String> {
    let file_path = PathBuf::from(path);
    if !file_path.is_absolute() {
        return Err("Standalone recreation requires an absolute path".to_string());
    }
    if file_path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir | std::path::Component::CurDir
        )
    }) {
        return Err("Path traversal is not allowed".to_string());
    }
    match file_path.extension().and_then(|extension| extension.to_str()) {
        Some(extension)
            if extension.eq_ignore_ascii_case("md")
                || extension.eq_ignore_ascii_case("markdown") => {}
        _ => return Err("Only .md and .markdown files are allowed".to_string()),
    }

    let file_name = file_path
        .file_name()
        .ok_or_else(|| "Standalone recreation target has no file name".to_string())?;
    let parent = file_path
        .parent()
        .ok_or_else(|| "Standalone recreation target has no parent".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("Cannot resolve parent directory: {error}"))?;
    if !canonical_parent.is_dir() {
        return Err(format!("Not a directory: {}", parent.display()));
    }

    Ok(canonical_parent.join(file_name))
}

#[tauri::command]
async fn read_file_direct(path: String) -> Result<FileContent, String> {
    let canonical = validate_preview_path(&path)?;

    if !canonical.is_file() {
        return Err(format!("Not a file: {}", path));
    }

    tauri::async_runtime::spawn_blocking(move || read_file_content_from_path(&canonical))
        .await
        .map_err(|error| format!("Direct file read task failed: {error}"))?
}

#[tauri::command]
async fn save_file_direct(
    path: String,
    content: String,
    expected_revision: String,
) -> Result<FileSaveResult, String> {
    // For save, the file must already exist (we validate extension + path security)
    let canonical = validate_preview_path(&path)?;

    if !canonical.is_file() {
        return Err(format!("Not a file: {}", path));
    }

    tauri::async_runtime::spawn_blocking(move || {
        save_file_content_to_path(&canonical, content, expected_revision)
    })
    .await
    .map_err(|error| format!("Direct file save task failed: {error}"))?
}

#[tauri::command]
async fn recreate_file_direct(path: String, content: String) -> Result<FileSaveResult, String> {
    let create_path = validate_preview_create_path(&path)?;

    tauri::async_runtime::spawn_blocking(move || {
        recreate_file_content_to_path(&create_path, content)
    })
    .await
    .map_err(|error| format!("Direct file recreation task failed: {error}"))?
}

#[tauri::command]
async fn import_file_to_folder(
    app: AppHandle,
    path: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<NoteMetadata, String> {
    let source = validate_preview_path(&path)?;
    if !source.is_file() {
        return Err(format!("Not a file: {}", path));
    }

    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;
    let folder_path = PathBuf::from(&folder);

    // Read the source file content
    let content = fs::read_to_string(&source)
        .await
        .map_err(|_| "Failed to read source file".to_string())?;

    // Derive the note ID from the title (H1 heading), falling back to filename
    let extracted_title = extract_title(&content);
    let base_name = if extracted_title.trim().is_empty() {
        source
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string()
    } else {
        extracted_title.trim().to_string()
    };
    let base_id = sanitize_filename(&base_name);

    // Atomically create the file and write content via the handle
    let mut final_id = base_id.clone();
    let mut counter = 1;
    loop {
        let candidate = abs_path_from_id(&folder_path, &final_id)?;
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
            .await
        {
            Ok(mut file) => {
                if file.write_all(content.as_bytes()).await.is_err() {
                    // Clean up the empty file on write failure
                    let _ = fs::remove_file(&candidate).await;
                    return Err("Failed to write file".to_string());
                }
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                final_id = format!("{}-{}", base_id, counter);
                counter += 1;
            }
            Err(_) => return Err("Failed to create file".to_string()),
        }
    };

    let modified = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Update search index
    {
        let index = workspace.search_index().lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            let _ = search_index.index_note(&final_id, &extracted_title, &content, modified);
        }
    }

    let preview = content
        .lines()
        .skip(1)
        .filter(|l| !l.trim().is_empty())
        .take(3)
        .collect::<Vec<_>>()
        .join(" ");

    let metadata = NoteMetadata {
        id: final_id,
        title: extracted_title,
        preview,
        modified,
    };

    // Update notes cache so fallback search sees the imported note immediately
    {
        let mut cache = workspace.notes_cache().write().expect("cache write lock");
        cache.insert(metadata.id.clone(), metadata.clone());
    }

    // Tell the invoking window to select the imported note and focus it
    let _ = app.emit_to(window.label(), "select-note", &metadata.id);
    let _ = window.show();
    let _ = window.set_focus();

    Ok(metadata)
}

#[tauri::command]
async fn search_notes(
    query: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<SearchResult>, String> {
    let trimmed_query = query.trim().to_string();
    if trimmed_query.is_empty() {
        return Ok(vec![]);
    }
    let workspace = state.workspace_for_window(window.label())?;

    // Check if search index is available and use it (scoped to drop lock before await)
    let indexed_result = {
        let index = workspace.search_index().lock().expect("search index mutex");
        (*index).as_ref().map(|search_index| {
            search_index.search(&trimmed_query, 20).map_err(|e| e.to_string())
        })
    };

    match indexed_result {
        Some(Ok(results)) if !results.is_empty() => Ok(results),
        Some(Ok(_)) => {
            // Tantivy can miss partial/fuzzy matches; fall back to substring search.
            fallback_search(&trimmed_query, &workspace).await
        }
        Some(Err(e)) => {
            eprintln!("Tantivy search error, falling back to substring search: {}", e);
            fallback_search(&trimmed_query, &workspace).await
        }
        None => {
            // Fallback to simple search if index not available
            fallback_search(&trimmed_query, &workspace).await
        }
    }
}

// Fallback search when Tantivy index isn't available - searches title and full content
async fn fallback_search(
    query: &str,
    workspace: &WorkspaceRuntime<'_>,
) -> Result<Vec<SearchResult>, String> {
    let folder = workspace.notes_folder()?;

    // Collect cache data upfront to avoid holding lock during async operations
    let cache_data: Vec<(String, String, String, i64)> = {
        let cache = workspace.notes_cache().read().expect("cache read lock");
        cache
            .values()
            .map(|note| {
                (
                    note.id.clone(),
                    note.title.clone(),
                    note.preview.clone(),
                    note.modified,
                )
            })
            .collect()
    };

    let folder_path = PathBuf::from(&folder);
    let query_lower = query.to_lowercase();
    let mut results: Vec<SearchResult> = Vec::new();

    for (id, title, preview, modified) in cache_data {
        let title_lower = title.to_lowercase();

        let mut score = 0.0f32;
        if title_lower.contains(&query_lower) {
            score += 50.0;
        }

        // Read file content asynchronously and search in it
        let file_path = match abs_path_from_id(&folder_path, &id) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if let Ok(content) = tokio::fs::read_to_string(&file_path).await {
            let content_lower = content.to_lowercase();
            if content_lower.contains(&query_lower) {
                // Higher score if in title, lower if only in content
                if score == 0.0 {
                    score += 10.0;
                } else {
                    score += 5.0;
                }
            }
        }

        if score > 0.0 {
            results.push(SearchResult {
                id,
                title,
                preview,
                modified,
                score,
            });
        }
    }

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(20);

    Ok(results)
}

// File watcher event payload
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct FileChangeEvent {
    workspace: String,
    kind: String,
    path: String,
    changed_ids: Vec<String>,
    revision: Option<String>,
    origin_window: Option<String>,
    previous_id: Option<String>,
    current_id: Option<String>,
}

fn semantic_file_change_event(
    workspace: String,
    kind: &str,
    previous_id: Option<String>,
    current_note: Option<&Note>,
    origin_window: Option<String>,
) -> FileChangeEvent {
    let current_id = current_note.map(|note| note.id.clone());
    let mut changed_ids = Vec::new();
    if let Some(id) = previous_id.as_ref() {
        changed_ids.push(id.clone());
    }
    if let Some(id) = current_id.as_ref() {
        if !changed_ids.contains(id) {
            changed_ids.push(id.clone());
        }
    }

    let path = current_note.map(|note| note.path.clone()).unwrap_or_else(|| {
        let id = previous_id.as_deref().unwrap_or_default();
        PathBuf::from(&workspace)
            .join(format!("{id}.md"))
            .to_string_lossy()
            .into_owned()
    });

    FileChangeEvent {
        workspace,
        kind: kind.to_string(),
        path,
        changed_ids,
        revision: current_note.map(|note| note.revision.clone()),
        origin_window,
        previous_id,
        current_id,
    }
}

fn emit_workspace_file_change(
    app: &AppHandle,
    state: &AppState,
    note_path: &Path,
    payload: FileChangeEvent,
    origin_window: Option<&str>,
) {
    let labels = {
        let bindings = state
            .workspace_bindings
            .read()
            .expect("workspace bindings read lock");
        note_change_targets(&bindings, note_path, origin_window)
    };
    for label in labels {
        let _ = app.emit_to(&label, "file-change", payload.clone());
    }
}

fn process_external_note_change(
    app_handle: AppHandle,
    workspace_path: String,
    legacy_main_runtime: bool,
    path: PathBuf,
    note_id: String,
    kind: String,
) {
    if let Some(state) = app_handle.try_state::<AppState>() {
        let workspace = if legacy_main_runtime {
            Some(WorkspaceRuntime::Main(state.inner()))
        } else {
            state
                .workspace_session_for_path(&workspace_path)
                .map(WorkspaceRuntime::Session)
        };
        if let Some(workspace) = workspace {
            let index = workspace.search_index().lock().expect("search index mutex");
            if let Some(ref search_index) = *index {
                match kind.as_str() {
                    "created" | "modified" => match std::fs::read_to_string(&path) {
                        Ok(content) => {
                            let title = extract_title(&content);
                            let modified = std::fs::metadata(&path)
                                .ok()
                                .and_then(|metadata| metadata.modified().ok())
                                .and_then(|time| {
                                    time.duration_since(std::time::UNIX_EPOCH).ok()
                                })
                                .map(|duration| duration.as_secs() as i64)
                                .unwrap_or(0);
                            let _ = search_index.index_note(
                                &note_id,
                                &title,
                                &content,
                                modified,
                            );
                        }
                        Err(_) if !path.exists() => {
                            let _ = search_index.delete_note(&note_id);
                        }
                        Err(_) => {}
                    },
                    "deleted" => {
                        let _ = search_index.delete_note(&note_id);
                    }
                    _ => {}
                }
            }
        }
    }

    let effective_kind = if kind == "modified" && !path.exists() {
        "deleted"
    } else {
        kind.as_str()
    };
    let revision = std::fs::read_to_string(&path)
        .ok()
        .map(|content| persistence::content_revision(&content).to_string());
    let payload = FileChangeEvent {
        workspace: workspace_path,
        kind: effective_kind.to_string(),
        path: path.to_string_lossy().into_owned(),
        changed_ids: vec![note_id.clone()],
        revision,
        origin_window: None,
        previous_id: (effective_kind == "deleted").then_some(note_id.clone()),
        current_id: (effective_kind != "deleted").then_some(note_id),
    };
    if let Some(state) = app_handle.try_state::<AppState>() {
        emit_workspace_file_change(&app_handle, &state, &path, payload, None);
    }
}

fn setup_file_watcher(
    app: AppHandle,
    notes_folder: &str,
    legacy_main_runtime: bool,
    debounce_map: Arc<Mutex<WatcherDebounce>>,
) -> Result<FileWatcherState, String> {
    let folder_path = PathBuf::from(notes_folder);
    let notes_root = folder_path.clone();
    let workspace_path = notes_folder.to_string();
    let app_handle = app.clone();

    let watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                for path in event.paths.iter() {
                    // Read current ignored patterns from settings
                    let ignored_dirs = if let Some(state) = app_handle.try_state::<AppState>() {
                        let workspace = if legacy_main_runtime {
                            Some(WorkspaceRuntime::Main(state.inner()))
                        } else {
                            state
                                .workspace_session_for_path(&workspace_path)
                                .map(WorkspaceRuntime::Session)
                        };
                        workspace
                            .map(|workspace| {
                                let settings =
                                    workspace.settings().read().expect("settings read lock");
                                get_effective_ignored_dirs(&settings)
                            })
                            .unwrap_or_else(|| {
                                DEFAULT_IGNORED_DIRS.iter().map(|s| s.to_string()).collect()
                            })
                    } else {
                        DEFAULT_IGNORED_DIRS.iter().map(|s| s.to_string()).collect()
                    };

                    let note_id = match id_from_abs_path(&notes_root, path, &ignored_dirs) {
                        Some(id) => id,
                        None => continue,
                    };

                    let kind = match event.kind {
                        notify::EventKind::Create(_) => "created",
                        notify::EventKind::Modify(_) => "modified",
                        notify::EventKind::Remove(_) => "deleted",
                        // Some backends emit Any for renames or unclassified changes
                        notify::EventKind::Any => "modified",
                        _ => continue,
                    };
                    let path = path.clone();
                    let token = debounce_map
                        .lock()
                        .expect("debounce map mutex")
                        .schedule(path.clone());
                    let pending = Arc::clone(&debounce_map);
                    let task_app = app_handle.clone();
                    let task_workspace = workspace_path.clone();
                    let kind = kind.to_string();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(WATCHER_DEBOUNCE_WINDOW).await;
                        let is_latest = pending
                            .lock()
                            .expect("debounce map mutex")
                            .take_if_latest(&path, token);
                        if !is_latest {
                            return;
                        }
                        let _ = tauri::async_runtime::spawn_blocking(move || {
                            process_external_note_change(
                                task_app,
                                task_workspace,
                                legacy_main_runtime,
                                path,
                                note_id,
                                kind,
                            );
                        })
                        .await;
                    });
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    let mut watcher = watcher;

    // Watch the notes folder recursively for .md files in subfolders
    watcher
        .watch(&folder_path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    Ok(FileWatcherState { watcher })
}

#[tauri::command]
fn start_file_watcher(
    app: AppHandle,
    window: WebviewWindow,
    state: State<AppState>,
) -> Result<(), String> {
    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;
    let legacy_main_runtime = matches!(&workspace, WorkspaceRuntime::Main(_));

    ensure_shared_resource(workspace.file_watcher(), || {
        setup_file_watcher(
            app,
            &folder,
            legacy_main_runtime,
            Arc::clone(workspace.debounce_map()),
        )
    })?;

    Ok(())
}

#[tauri::command]
fn copy_to_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_clipboard_image(
    base64_data: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Guard against empty clipboard payload
    if base64_data.trim().is_empty() {
        return Err("Clipboard data is empty".to_string());
    }

    let folder = state
        .workspace_for_window(window.label())?
        .notes_folder()?;

    // Decode base64
    let image_data = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|_| "Failed to decode base64 image data".to_string())?;

    // Guard against zero-byte files
    if image_data.is_empty() {
        return Err("Decoded image data is empty".to_string());
    }

    // Create assets folder path
    let assets_dir = PathBuf::from(&folder).join("assets");
    fs::create_dir_all(&assets_dir)
        .await
        .map_err(|e| e.to_string())?;

    // Generate unique filename with timestamp
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut target_name = format!("screenshot-{}.png", timestamp);
    let mut counter = 1;
    let mut target_path = assets_dir.join(&target_name);

    while target_path.exists() {
        target_name = format!("screenshot-{}-{}.png", timestamp, counter);
        target_path = assets_dir.join(&target_name);
        counter += 1;
    }

    // Write the file
    fs::write(&target_path, &image_data)
        .await
        .map_err(|_| "Failed to write image".to_string())?;

    // Return relative path
    Ok(format!("assets/{}", target_name))
}

#[tauri::command]
async fn copy_image_to_assets(
    source_path: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let folder = state
        .workspace_for_window(window.label())?
        .notes_folder()?;

    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err("Source image file does not exist".to_string());
    }

    // Get file extension
    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .ok_or("Invalid file extension")?;

    const ALLOWED_IMAGE_EXTENSIONS: &[&str] = &[
        "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tiff", "tif", "ico", "avif",
    ];
    let ext_lower = extension.to_lowercase();
    if !ALLOWED_IMAGE_EXTENSIONS.contains(&ext_lower.as_str()) {
        return Err("Only image files can be copied to assets".to_string());
    }

    // Get original filename (without extension)
    let original_name = source
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("image");

    // Sanitize the filename
    let sanitized_name = sanitize_filename(original_name);

    // Create assets folder path
    let assets_dir = PathBuf::from(&folder).join("assets");
    fs::create_dir_all(&assets_dir)
        .await
        .map_err(|e| e.to_string())?;

    // Generate unique filename
    let mut target_name = format!("{}.{}", sanitized_name, extension);
    let mut counter = 1;
    let mut target_path = assets_dir.join(&target_name);

    while target_path.exists() {
        target_name = format!("{}-{}.{}", sanitized_name, counter, extension);
        target_path = assets_dir.join(&target_name);
        counter += 1;
    }

    // Copy the file
    fs::copy(&source, &target_path)
        .await
        .map_err(|_| "Failed to copy image".to_string())?;

    // Return both relative path and filename for frontend to construct the URL
    Ok(format!("assets/{}", target_name))
}

#[tauri::command]
fn rebuild_search_index(
    window: WebviewWindow,
    state: State<AppState>,
) -> Result<(), String> {
    let workspace = state.workspace_for_window(window.label())?;
    let folder = workspace.notes_folder()?;

    let ignored_dirs = {
        let settings = workspace.settings().read().expect("settings read lock");
        get_effective_ignored_dirs(&settings)
    };

    let index = workspace.search_index().lock().expect("search index mutex");
    match index.as_ref() {
        Some(search_index) => search_index
            .rebuild_index(&PathBuf::from(&folder), &ignored_dirs)
            .map_err(|e| e.to_string()),
        None => Err("Search index not initialized".to_string()),
    }
}

#[tauri::command]
fn get_default_ignored_patterns() -> Vec<String> {
    DEFAULT_IGNORED_DIRS.iter().map(|s| s.to_string()).collect()
}

#[tauri::command]
async fn open_folder_dialog(
    app: AppHandle,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    // Run blocking dialog on a separate thread to avoid blocking the async runtime
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut builder = app.dialog().file().set_can_create_directories(true);

        if let Some(path) = default_path {
            builder = builder.set_directory(path);
        }

        builder.blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("Dialog task failed: {}", e))?;

    Ok(result.map(|p| p.to_string()))
}

#[tauri::command]
async fn open_in_file_manager(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() || !path_buf.is_dir() {
        return Err("Path does not exist or is not a directory".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        let windows_path = path.replace("/", "\\");
        std::process::Command::new("explorer")
            .arg(&windows_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        return Err("Unsupported platform".to_string());
    }

    Ok(())
}

#[tauri::command]
async fn open_url_safe(url: String) -> Result<(), String> {
    // Validate URL scheme - only allow http, https, mailto
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    match parsed.scheme() {
        "http" | "https" | "mailto" => {}
        scheme => {
            return Err(format!(
                "URL scheme '{}' is not allowed. Only http, https, and mailto are permitted.",
                scheme
            ))
        }
    }

    // Use system opener
    open::that(&url).map_err(|e| format!("Failed to open URL: {}", e))
}

// Git commands - run blocking git operations off the main thread

#[tauri::command]
async fn git_is_available() -> bool {
    tauri::async_runtime::spawn_blocking(git::is_available)
        .await
        .unwrap_or(false)
}

#[tauri::command]
async fn git_get_status(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<git::GitStatus, String> {
    let folder = state
        .workspace_for_window(window.label())
        .ok()
        .and_then(|workspace| workspace.notes_folder().ok());

    match folder {
        Some(path) => {
            tauri::async_runtime::spawn_blocking(move || {
                git::get_status(&PathBuf::from(path))
            })
            .await
            .map_err(|e| e.to_string())
        }
        None => Ok(git::GitStatus::default()),
    }
}

#[tauri::command]
async fn git_init_repo(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let folder = state
        .workspace_for_window(window.label())?
        .notes_folder()?;

    tauri::async_runtime::spawn_blocking(move || {
        git::git_init(&PathBuf::from(folder))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_commit(
    message: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<git::GitResult, String> {
    let folder = state
        .workspace_for_window(window.label())
        .ok()
        .and_then(|workspace| workspace.notes_folder().ok());

    match folder {
        Some(path) => {
            tauri::async_runtime::spawn_blocking(move || {
                git::commit_all(&PathBuf::from(path), &message)
            })
            .await
            .map_err(|e| e.to_string())
        }
        None => Ok(git::GitResult {
            success: false,
            message: None,
            error: Some("Notes folder not set".to_string()),
        }),
    }
}

#[tauri::command]
async fn git_push(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<git::GitResult, String> {
    let folder = state
        .workspace_for_window(window.label())
        .ok()
        .and_then(|workspace| workspace.notes_folder().ok());

    match folder {
        Some(path) => {
            tauri::async_runtime::spawn_blocking(move || {
                git::push(&PathBuf::from(path))
            })
            .await
            .map_err(|e| e.to_string())
        }
        None => Ok(git::GitResult {
            success: false,
            message: None,
            error: Some("Notes folder not set".to_string()),
        }),
    }
}

#[tauri::command]
async fn git_fetch(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<git::GitResult, String> {
    let folder = state
        .workspace_for_window(window.label())
        .ok()
        .and_then(|workspace| workspace.notes_folder().ok());

    match folder {
        Some(path) => {
            tauri::async_runtime::spawn_blocking(move || {
                git::fetch(&PathBuf::from(path))
            })
            .await
            .map_err(|e| e.to_string())
        }
        None => Ok(git::GitResult {
            success: false,
            message: None,
            error: Some("Notes folder not set".to_string()),
        }),
    }
}

#[tauri::command]
async fn git_pull(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<git::GitResult, String> {
    let folder = state
        .workspace_for_window(window.label())
        .ok()
        .and_then(|workspace| workspace.notes_folder().ok());

    match folder {
        Some(path) => {
            tauri::async_runtime::spawn_blocking(move || {
                git::pull(&PathBuf::from(path))
            })
            .await
            .map_err(|e| e.to_string())
        }
        None => Ok(git::GitResult {
            success: false,
            message: None,
            error: Some("Notes folder not set".to_string()),
        }),
    }
}

#[tauri::command]
async fn git_add_remote(
    url: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<git::GitResult, String> {
    let folder = state
        .workspace_for_window(window.label())
        .ok()
        .and_then(|workspace| workspace.notes_folder().ok());

    match folder {
        Some(path) => {
            tauri::async_runtime::spawn_blocking(move || {
                git::add_remote(&PathBuf::from(path), &url)
            })
            .await
            .map_err(|e| e.to_string())
        }
        None => Ok(git::GitResult {
            success: false,
            message: None,
            error: Some("Notes folder not set".to_string()),
        }),
    }
}

#[tauri::command]
async fn git_set_remote_url(
    url: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<git::GitResult, String> {
    let folder = state
        .workspace_for_window(window.label())
        .ok()
        .and_then(|workspace| workspace.notes_folder().ok());

    match folder {
        Some(path) => {
            tauri::async_runtime::spawn_blocking(move || {
                git::set_remote_url(&PathBuf::from(path), &url)
            })
            .await
            .map_err(|e| e.to_string())
        }
        None => Ok(git::GitResult {
            success: false,
            message: None,
            error: Some("Notes folder not set".to_string()),
        }),
    }
}

#[tauri::command]
async fn git_remove_remote(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<git::GitResult, String> {
    let folder = state
        .workspace_for_window(window.label())
        .ok()
        .and_then(|workspace| workspace.notes_folder().ok());

    match folder {
        Some(path) => {
            tauri::async_runtime::spawn_blocking(move || {
                git::remove_remote(&PathBuf::from(path))
            })
            .await
            .map_err(|e| e.to_string())
        }
        None => Ok(git::GitResult {
            success: false,
            message: None,
            error: Some("Notes folder not set".to_string()),
        }),
    }
}

#[tauri::command]
async fn git_push_with_upstream(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<git::GitResult, String> {
    let folder = state
        .workspace_for_window(window.label())
        .ok()
        .and_then(|workspace| workspace.notes_folder().ok());

    match folder {
        Some(path) => {
            tauri::async_runtime::spawn_blocking(move || {
                // Get current branch first
                let status = git::get_status(&PathBuf::from(&path));
                match status.current_branch {
                    Some(branch) => {
                        if !branch
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
                        {
                            return git::GitResult {
                                success: false,
                                message: None,
                                error: Some("Invalid branch name".to_string()),
                            };
                        }
                        git::push_with_upstream(&PathBuf::from(&path), &branch)
                    }
                    None => git::GitResult {
                        success: false,
                        message: None,
                        error: Some("No current branch found".to_string()),
                    },
                }
            })
            .await
            .map_err(|e| e.to_string())
        }
        None => Ok(git::GitResult {
            success: false,
            message: None,
            error: Some("Notes folder not set".to_string()),
        }),
    }
}

// Check if Claude CLI is installed
fn get_expanded_path() -> String {
    let system_path = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_else(|_| String::new());

    if home.is_empty() {
        return system_path;
    }

    // Common locations for node-installed CLIs (nvm, volta, fnm, mise, homebrew, global npm)
    let candidate_dirs = vec![
        format!("{home}/.nvm/versions/node"),
        format!("{home}/.fnm/node-versions"),
        format!("{home}/.local/share/mise/installs/node"),
    ];
    let static_dirs = vec![
        format!("{home}/.bun/bin"),
        format!("{home}/.volta/bin"),
        format!("{home}/.local/bin"),
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
    ];

    let mut expanded = Vec::new();

    // Prefer well-known static locations (e.g. ~/.local/bin for native CLI installs)
    for dir in static_dirs {
        expanded.push(dir);
    }

    // Then scan nvm/fnm node version dirs containing a bin/ folder
    for base in &candidate_dirs {
        if let Ok(entries) = std::fs::read_dir(base) {
            for entry in entries.flatten() {
                let bin_path = entry.path().join("bin");
                if bin_path.exists() {
                    expanded.push(bin_path.to_string_lossy().to_string());
                }
            }
        }
    }

    expanded.push(system_path);
    expanded.join(":")
}

/// Create a `Command` that hides the console window on Windows.
fn no_window_cmd(program: &str) -> std::process::Command {
    let cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = cmd;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        cmd
    }
}

fn check_cli_exists(command_name: &str, path: &str) -> Result<bool, String> {
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let check_output = no_window_cmd(which_cmd)
        .arg(command_name)
        .env("PATH", path)
        .output()
        .map_err(|e| format!("Failed to check for {} CLI: {}", command_name, e))?;

    Ok(check_output.status.success())
}

/// Marker comment embedded in CLI wrapper scripts installed by Scratch.
/// Used to identify and validate our own wrapper before modifying or removing it.
#[cfg(target_os = "macos")]
const SCRATCH_CLI_MARKER: &str = "# SCRATCH_CLI_WRAPPER";

/// Returns the path where the CLI script should be installed (macOS only).
/// Checks PATH for Homebrew bin first, then falls back to architecture detection.
/// Apple Silicon: /opt/homebrew/bin/scratch
/// Intel: /usr/local/bin/scratch
#[cfg(target_os = "macos")]
fn cli_target_path() -> PathBuf {
    // Check if the user's PATH contains /opt/homebrew/bin (Homebrew on Apple Silicon)
    if let Ok(path_var) = std::env::var("PATH") {
        if path_var.split(':').any(|p| p == "/opt/homebrew/bin") {
            return PathBuf::from("/opt/homebrew/bin/scratch");
        }
    }
    // Fall back to architecture detection
    if std::env::consts::ARCH == "aarch64" {
        return PathBuf::from("/opt/homebrew/bin/scratch");
    }
    PathBuf::from("/usr/local/bin/scratch")
}

#[tauri::command]
fn get_cli_status() -> Result<CliStatus, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(CliStatus { supported: false, installed: false, path: None });

    #[cfg(target_os = "macos")]
    {
        let target = cli_target_path();
        if !target.exists() && target.symlink_metadata().is_err() {
            return Ok(CliStatus { supported: true, installed: false, path: None });
        }
        // Verify this is our wrapper (has marker) and points to the current binary
        let content = std::fs::read_to_string(&target).unwrap_or_default();
        if !content.contains(SCRATCH_CLI_MARKER) {
            // Foreign binary at this path — don't claim it as ours
            return Ok(CliStatus { supported: true, installed: false, path: None });
        }
        let current_exe = std::env::current_exe()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !current_exe.is_empty() && !content.contains(&current_exe) {
            // Our wrapper but points to a moved/deleted binary — needs reinstall
            return Ok(CliStatus { supported: true, installed: false, path: None });
        }
        Ok(CliStatus {
            supported: true,
            installed: true,
            path: Some(target.to_string_lossy().into_owned()),
        })
    }
}

#[tauri::command]
fn install_cli() -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    return Err("CLI install is only supported on macOS".to_string());

    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::PermissionsExt;

        let target = cli_target_path();

        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
        }

        if target.exists() || target.symlink_metadata().is_ok() {
            // Only remove if it's our wrapper (contains marker)
            let content = std::fs::read_to_string(&target).unwrap_or_default();
            if !content.contains(SCRATCH_CLI_MARKER) {
                return Err(format!(
                    "A different 'scratch' command already exists at {}. Remove it manually to install the Scratch CLI.",
                    target.display()
                ));
            }
            std::fs::remove_file(&target)
                .map_err(|e| format!("Failed to remove existing file: {}", e))?;
        }

        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Cannot find exe path: {}", e))?;

        // Shell-escape the exe path using single quotes to prevent
        // interpretation of $, `, ", and other metacharacters.
        let exe_str = exe_path.to_string_lossy();
        let escaped_exe = format!("'{}'", exe_str.replace('\'', "'\\''"));

        // Write a wrapper script that launches the binary in the background so
        // the terminal is not blocked waiting for the GUI app to exit.
        let script = format!(
            "#!/bin/sh\n{}\nnohup {} \"$@\" >/dev/null 2>&1 &\n",
            SCRATCH_CLI_MARKER,
            escaped_exe
        );
        std::fs::write(&target, script.as_bytes())
            .map_err(|e| format!("Failed to write CLI script: {}", e))?;

        let mut perms = std::fs::metadata(&target)
            .map_err(|e| format!("Failed to read permissions: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&target, perms)
            .map_err(|e| format!("Failed to set permissions: {}", e))?;

        Ok(target.to_string_lossy().into_owned())
    }
}

#[tauri::command]
fn uninstall_cli() -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(());

    #[cfg(target_os = "macos")]
    {
        let target = cli_target_path();
        if target.exists() || target.symlink_metadata().is_ok() {
            let content = std::fs::read_to_string(&target).unwrap_or_default();
            if !content.contains(SCRATCH_CLI_MARKER) {
                return Err(format!(
                    "File at {} was not installed by Scratch. Refusing to remove.",
                    target.display()
                ));
            }
            std::fs::remove_file(&target)
                .map_err(|e| format!("Failed to remove CLI script: {}", e))?;
        }
        Ok(())
    }
}

#[tauri::command]
async fn ai_check_claude_cli() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = get_expanded_path();
        check_cli_exists("claude", &path)
    })
    .await
    .map_err(|e| format!("Failed to check Claude CLI: {}", e))?
}

#[tauri::command]
async fn ai_check_codex_cli() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = get_expanded_path();
        check_cli_exists("codex", &path)
    })
    .await
    .map_err(|e| format!("Failed to check Codex CLI: {}", e))?
}

#[tauri::command]
async fn ai_check_opencode_cli() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = get_expanded_path();
        check_cli_exists("opencode", &path)
    })
    .await
    .map_err(|e| format!("Failed to check OpenCode CLI: {}", e))?
}

/// Shared AI CLI execution: spawns `command` with `args`, writes `stdin_input` to stdin,
/// and returns the result with a 5-minute timeout.
async fn execute_ai_cli(
    cli_name: &str,
    command: String,
    args: Vec<String>,
    stdin_input: String,
    not_found_msg: String,
    current_dir: Option<String>,
    extra_env: Option<Vec<(String, String)>>,
) -> Result<AiExecutionResult, String> {
    use std::io::Write;
    use std::process::{Child, Stdio};

    let cli_name = cli_name.to_string();
    let timeout_duration = std::time::Duration::from_secs(300);
    let shared_child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let child_for_task = Arc::clone(&shared_child);
    let cli_name_task = cli_name.clone();

    let mut task = tauri::async_runtime::spawn_blocking(move || {
        // Blocking I/O: expand PATH and check CLI exists
        let path = get_expanded_path();
        match check_cli_exists(&command, &path) {
            Ok(false) => {
                return AiExecutionResult {
                    success: false,
                    output: String::new(),
                    error: Some(not_found_msg),
                };
            }
            Err(e) => {
                return AiExecutionResult {
                    success: false,
                    output: String::new(),
                    error: Some(e),
                };
            }
            Ok(true) => {}
        }

        let mut cmd = no_window_cmd(&command);
        cmd.env("PATH", &path);
        if let Some(dir) = &current_dir {
            cmd.current_dir(dir);
        }
        if let Some(env_pairs) = &extra_env {
            for (key, value) in env_pairs {
                cmd.env(key, value);
            }
        }
        for arg in &args {
            cmd.arg(arg);
        }
        let process = match cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(p) => p,
            Err(e) => {
                return AiExecutionResult {
                    success: false,
                    output: String::new(),
                    error: Some(format!("Failed to execute {}: {}", cli_name_task, e)),
                };
            }
        };

        // Store process in shared state so the timeout handler can kill it.
        // We only take individual I/O handles below — the Child stays in the
        // mutex so it remains reachable for kill().
        if let Ok(mut guard) = child_for_task.lock() {
            *guard = Some(process);
        } else {
            return AiExecutionResult {
                success: false,
                output: String::new(),
                error: Some(format!("Failed to lock {} process handle", cli_name_task)),
            };
        }

        // Take stdin handle (briefly locks then releases)
        let stdin_handle = child_for_task
            .lock()
            .ok()
            .and_then(|mut g| g.as_mut().and_then(|p| p.stdin.take()));

        if let Some(mut stdin) = stdin_handle {
            if let Err(e) = stdin.write_all(stdin_input.as_bytes()) {
                if let Ok(mut g) = child_for_task.lock() {
                    if let Some(ref mut p) = *g {
                        let _ = p.kill();
                        let _ = p.wait();
                    }
                }
                return AiExecutionResult {
                    success: false,
                    output: String::new(),
                    error: Some(format!("Failed to write to {} stdin: {}", cli_name_task, e)),
                };
            }
            // stdin dropped here — closes the pipe
        } else {
            if let Ok(mut g) = child_for_task.lock() {
                if let Some(ref mut p) = *g {
                    let _ = p.kill();
                    let _ = p.wait();
                }
            }
            return AiExecutionResult {
                success: false,
                output: String::new(),
                error: Some(format!("Failed to open stdin for {}", cli_name_task)),
            };
        }

        // Take stdout/stderr handles so we can read without holding the lock.
        // This allows the timeout handler to lock the mutex and kill the process.
        let stdout_handle = child_for_task
            .lock()
            .ok()
            .and_then(|mut g| g.as_mut().and_then(|p| p.stdout.take()));
        let stderr_handle = child_for_task
            .lock()
            .ok()
            .and_then(|mut g| g.as_mut().and_then(|p| p.stderr.take()));

        use std::io::Read;

        let mut stdout_str = String::new();
        if let Some(mut out) = stdout_handle {
            let _ = out.read_to_string(&mut stdout_str);
        }

        let mut stderr_str = String::new();
        if let Some(mut err) = stderr_handle {
            let _ = err.read_to_string(&mut stderr_str);
        }

        // Collect exit status — process has exited after stdout/stderr close
        let success = child_for_task
            .lock()
            .ok()
            .and_then(|mut g| g.as_mut().and_then(|p| p.wait().ok()))
            .map(|s| s.success())
            .unwrap_or(false);

        // Strip ANSI escape sequences from output (e.g. Ollama progress spinners)
        let ansi_re = regex::Regex::new(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\].*?\x07").unwrap();
        let stdout_clean = ansi_re.replace_all(&stdout_str, "").to_string();
        let stderr_clean = ansi_re.replace_all(&stderr_str, "").trim().to_string();

        if success {
            AiExecutionResult {
                success: true,
                output: stdout_clean,
                error: None,
            }
        } else {
            AiExecutionResult {
                success: false,
                output: stdout_clean,
                error: Some(stderr_clean),
            }
        }
    });

    let result = match tokio::time::timeout(timeout_duration, &mut task).await {
        Ok(join_result) => {
            join_result.map_err(|e| format!("Failed to join {} blocking task: {}", cli_name, e))?
        }
        Err(_) => {
            // Kill through the shared handle — the Child is still in the mutex
            // because the blocking task only takes I/O handles, not the Child.
            // This sends SIGKILL, which closes the pipes and unblocks the reads.
            if let Ok(mut guard) = shared_child.lock() {
                if let Some(ref mut process) = *guard {
                    let _ = process.kill();
                }
            }

            match tokio::time::timeout(std::time::Duration::from_secs(5), task).await {
                Ok(join_result) => {
                    if let Err(e) = join_result {
                        return Err(format!(
                            "Failed to join {} blocking task after timeout: {}",
                            cli_name, e
                        ));
                    }
                }
                Err(_) => {
                    return Err(format!(
                        "{} CLI timed out and failed to exit after kill signal",
                        cli_name
                    ));
                }
            }

            AiExecutionResult {
                success: false,
                output: String::new(),
                error: Some(format!("{} CLI timed out after 5 minutes", cli_name)),
            }
        }
    };

    Ok(result)
}

#[tauri::command]
async fn ai_execute_claude(
    file_path: String,
    prompt: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<AiExecutionResult, String> {
    let folder = state
        .workspace_for_window(window.label())?
        .notes_folder()?;
    let path = PathBuf::from(&file_path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !ext.eq_ignore_ascii_case("md") && !ext.eq_ignore_ascii_case("markdown") {
        return Err("AI editing is only supported for markdown files".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "Invalid file path".to_string())?;
    let notes_root = PathBuf::from(&folder)
        .canonicalize()
        .map_err(|_| "Invalid notes folder".to_string())?;
    if !canonical.starts_with(&notes_root) {
        return Err("File must be within notes folder".to_string());
    }

    execute_ai_cli(
        "Claude",
        "claude".to_string(),
        vec![
            canonical.to_string_lossy().to_string(),
            "--dangerously-skip-permissions".to_string(),
            "--print".to_string(),
        ],
        prompt,
        "Claude CLI not found. Please install it from https://claude.ai/code".to_string(),
        None,
        None,
    )
    .await
}

#[tauri::command]
async fn ai_execute_codex(file_path: String, prompt: String) -> Result<AiExecutionResult, String> {
    let stdin_input = format!(
        "Edit only this markdown file: {file_path}\n\
         Apply the user's instructions below directly to that file.\n\
         Do not create, delete, rename, or modify any other files.\n\
         User instructions:\n\
         {prompt}"
    );

    execute_ai_cli(
        "Codex",
        "codex".to_string(),
        vec![
            "exec".to_string(),
            "--skip-git-repo-check".to_string(),
            "--dangerously-bypass-approvals-and-sandbox".to_string(),
            "-".to_string(),
        ],
        stdin_input,
        "Codex CLI not found. Please install it from https://github.com/openai/codex".to_string(),
        None,
        None,
    )
    .await
}

#[tauri::command]
async fn ai_execute_opencode(
    file_path: String,
    prompt: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<AiExecutionResult, String> {
    let folder = state
        .workspace_for_window(window.label())?
        .notes_folder()?;
    let path = PathBuf::from(&file_path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !ext.eq_ignore_ascii_case("md") && !ext.eq_ignore_ascii_case("markdown") {
        return Err("AI editing is only supported for markdown files".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "Invalid file path".to_string())?;
    let notes_root = PathBuf::from(&folder)
        .canonicalize()
        .map_err(|_| "Invalid notes folder".to_string())?;
    if !canonical.starts_with(&notes_root) {
        return Err("File must be within notes folder".to_string());
    }

    let run_prompt = format!(
        "Edit the attached markdown file in place.\n\
         Do not create, delete, rename, or modify any other files.\n\
         User instructions:\n\
         {}",
        prompt
    );

    execute_ai_cli(
        "OpenCode",
        "opencode".to_string(),
        vec![
            "run".to_string(),
            "--file".to_string(),
            canonical.to_string_lossy().to_string(),
            "--".to_string(),
            run_prompt,
        ],
        String::new(),
        "OpenCode CLI not found. Please install it from https://opencode.ai".to_string(),
        Some(notes_root.to_string_lossy().to_string()),
        Some(vec![
            (
                "OPENCODE_PERMISSION".to_string(),
                r#"{"*":"allow","bash":"deny","task":"deny","webfetch":"deny","websearch":"deny","codesearch":"deny","skill":"deny","external_directory":"deny","doom_loop":"deny"}"#.to_string(),
            ),
        ]),
    )
    .await
}

#[tauri::command]
async fn ai_check_ollama_cli() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = get_expanded_path();
        check_cli_exists("ollama", &path)
    })
    .await
    .map_err(|e| format!("Failed to check Ollama CLI: {}", e))?
}

#[tauri::command]
async fn ai_execute_ollama(
    file_path: String,
    prompt: String,
    model: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<AiExecutionResult, String> {
    let folder = state
        .workspace_for_window(window.label())?
        .notes_folder()?;
    let path = PathBuf::from(&file_path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !ext.eq_ignore_ascii_case("md") && !ext.eq_ignore_ascii_case("markdown") {
        return Err("AI editing is only supported for markdown files".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "Invalid file path".to_string())?;
    let notes_root = PathBuf::from(&folder)
        .canonicalize()
        .map_err(|_| "Invalid notes folder".to_string())?;
    if !canonical.starts_with(&notes_root) {
        return Err("File must be within notes folder".to_string());
    }

    // Read the current file content
    let file_content = tokio::fs::read_to_string(&canonical)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let stdin_input = format!(
        "You are a markdown editor. Edit the markdown content below according to the user's instructions.\n\
         Return ONLY the complete edited markdown content.\n\
         Do NOT include any explanation, commentary, or code fences around the output.\n\
         Do NOT add ```markdown or ``` wrappers.\n\n\
         Current markdown content:\n{file_content}\n\n\
         User instructions:\n{prompt}"
    );

    // Use the model provided (frontend reads from settings, defaults to "qwen3:8b")
    let trimmed = model.trim();
    let model_name = if trimmed.is_empty() {
        "qwen3:8b".to_string()
    } else {
        trimmed.to_string()
    };

    // Check if the model is available locally before running (skip for cloud models)
    if !model_name.contains("cloud") {
        let mn = model_name.clone();
        let available = tauri::async_runtime::spawn_blocking(move || {
            let path = get_expanded_path();
            let mut cmd = no_window_cmd("ollama");
            cmd.env("PATH", &path);
            cmd.args(["show", &mn]);
            cmd.stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            match cmd.status() {
                Ok(status) => status.success(),
                Err(_) => false,
            }
        })
        .await
        .unwrap_or(false);

        if !available {
            return Ok(AiExecutionResult {
                success: false,
                output: String::new(),
                error: Some(format!(
                    "Model '{}' is not installed. Run: ollama pull {}",
                    model_name, model_name
                )),
            });
        }
    }

    let result = execute_ai_cli(
        "Ollama",
        "ollama".to_string(),
        vec!["run".to_string(), model_name.clone()],
        stdin_input,
        "Ollama CLI not found. Please install it from https://ollama.com".to_string(),
        None,
        None,
    )
    .await?;

    // Improve error messages for common Ollama failures
    if !result.success {
        if let Some(ref err) = result.error {
            let err_lower = err.to_lowercase();
            if err_lower.contains("file does not exist")
                || err_lower.contains("pull model manifest")
                || err_lower.contains("model not found")
                || err_lower.contains("model does not exist")
            {
                return Ok(AiExecutionResult {
                    success: false,
                    output: String::new(),
                    error: Some(format!(
                        "Model '{}' not found. Run `ollama pull {}` in your terminal to download it.",
                        model_name, model_name
                    )),
                });
            }
            if err.contains("401") || err.contains("Unauthorized") {
                return Ok(AiExecutionResult {
                    success: false,
                    output: String::new(),
                    error: Some("Authentication required. Run `ollama login` in your terminal to sign in.".to_string()),
                });
            }
        }
    }

    // If successful, write the output back to the file
    if result.success {
        let edited_content = result.output.trim().to_string();
        if edited_content.is_empty() {
            return Ok(AiExecutionResult {
                success: false,
                output: String::new(),
                error: Some("Ollama returned empty output. Please try again.".to_string()),
            });
        }
        tokio::fs::write(&canonical, edited_content.as_bytes())
            .await
            .map_err(|e| format!("Failed to write edited file: {}", e))?;

        Ok(AiExecutionResult {
            success: true,
            output: "Note edited successfully with Ollama.".to_string(),
            error: None,
        })
    } else {
        Ok(result)
    }
}

/// Check if a markdown file belongs to any open workspace.
/// If so, select it in the owning window and focus that window.
/// Returns false on any failure so callers can fall back to create_preview_window.
fn try_select_in_notes_folder(app: &AppHandle, path: &Path) -> bool {
    let state = match app.try_state::<AppState>() {
        Some(s) => s,
        None => return false,
    };

    let canonical_file = match path.canonicalize() {
        Ok(path) => path,
        Err(_) => return false,
    };
    let window_label = state
        .workspace_bindings
        .read()
        .expect("workspace bindings read lock")
        .window_for_note_path(&canonical_file)
        .map(str::to_string);
    let window_label = match window_label {
        Some(label) => label,
        None => return false,
    };
    let workspace = match state.workspace_for_window(&window_label) {
        Ok(workspace) => workspace,
        Err(_) => return false,
    };
    let canonical_folder = match workspace
        .notes_folder()
        .ok()
        .and_then(|folder| PathBuf::from(folder).canonicalize().ok())
    {
        Some(folder) => folder,
        None => return false,
    };

    if !canonical_file.starts_with(&canonical_folder) {
        return false;
    }

    let ignored_dirs = {
        let settings = workspace.settings().read().expect("settings read lock");
        get_effective_ignored_dirs(&settings)
    };

    let note_id = match id_from_abs_path(&canonical_folder, &canonical_file, &ignored_dirs) {
        Some(id) => id,
        None => return false,
    };

    let _ = app.emit_to(&window_label, "select-note", note_id);
    if let Some(workspace_window) = app.get_webview_window(&window_label) {
        let _ = workspace_window.show();
        let _ = workspace_window.set_focus();
    }
    true
}

/// Check if a file extension is a supported markdown extension.
fn is_markdown_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| {
            let lower = s.to_ascii_lowercase();
            lower == "md" || lower == "markdown"
        })
        .unwrap_or(false)
}

fn should_hide_main_window_for_standalone_preview(
    opened_preview: bool,
    has_notes_folder: bool,
) -> bool {
    opened_preview && has_notes_folder
}

fn should_defer_open_request(app_state_ready: bool) -> bool {
    !app_state_ready
}

fn defer_single_instance_open_if_needed(
    app: &AppHandle,
    args: Vec<String>,
    cwd: String,
) -> Option<PendingOpenRequest> {
    let mut pending = PENDING_SINGLE_INSTANCE_OPENS
        .lock()
        .expect("pending single-instance opens mutex");

    let app_state_ready = app.try_state::<AppState>().is_some();
    if !should_defer_open_request(app_state_ready) {
        return Some((args, cwd));
    }

    pending.push((args, cwd));
    None
}

fn take_pending_single_instance_opens() -> Vec<PendingOpenRequest> {
    let mut pending = PENDING_SINGLE_INSTANCE_OPENS
        .lock()
        .expect("pending single-instance opens mutex");
    std::mem::take(&mut *pending)
}

fn defer_opened_markdown_paths_if_needed(
    app: &AppHandle,
    paths: Vec<PathBuf>,
) -> Option<Vec<PathBuf>> {
    let mut pending = PENDING_OPENED_MARKDOWN_PATHS
        .lock()
        .expect("pending opened markdown paths mutex");

    let app_state_ready = app.try_state::<AppState>().is_some();
    if !should_defer_open_request(app_state_ready) {
        return Some(paths);
    }

    pending.extend(paths);
    None
}

fn take_pending_opened_markdown_paths() -> Vec<PathBuf> {
    let mut pending = PENDING_OPENED_MARKDOWN_PATHS
        .lock()
        .expect("pending opened markdown paths mutex");
    std::mem::take(&mut *pending)
}

fn has_configured_notes_folder(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<AppState>() else {
        return false;
    };

    let has_notes_folder = state
        .app_config
        .read()
        .expect("app_config read lock")
        .notes_folder
        .is_some();

    has_notes_folder
}

fn hide_main_window_for_standalone_preview(app: &AppHandle, opened_preview: bool) -> bool {
    let has_notes_folder = has_configured_notes_folder(app);
    let should_hide =
        should_hide_main_window_for_standalone_preview(opened_preview, has_notes_folder);

    if should_hide {
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.hide();
        }
    }

    should_hide
}

fn should_show_main_window(main_window_hidden: bool) -> bool {
    !main_window_hidden
}

fn runtime_window_config_from_template(
    template: &tauri::utils::config::WindowConfig,
    label: &str,
    url: WebviewUrl,
) -> tauri::utils::config::WindowConfig {
    let mut runtime = template.clone();
    runtime.label = label.to_string();
    runtime.url = url;
    runtime.create = false;
    runtime.visible = true;
    runtime
}

fn create_preferences_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("preferences") {
        let _ = window.show();
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let runtime_config = runtime_window_config_from_template(
        &app.config().app.windows[0],
        "preferences",
        WebviewUrl::App("index.html?mode=preferences".into()),
    );
    let window = WebviewWindowBuilder::from_config(app, &runtime_config)
        .map_err(|error| format!("Failed to configure Preferences window: {error}"))?
        .title("Preferences")
        .inner_size(900.0, 650.0)
        .min_inner_size(720.0, 500.0)
        .resizable(true)
        .decorations(true)
        .center()
        .build()
        .map_err(|error| format!("Failed to create Preferences window: {error}"))?;
    let _ = window.show();
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_preferences_window(app: AppHandle) -> Result<(), String> {
    create_preferences_window(&app)
}

// Preview mode: create a lightweight window for editing a single file
fn create_preview_window(app: &AppHandle, file_path: &str) -> Result<(), String> {
    let label = format!("preview-{}", crate::hashing::sha256_hex(file_path.as_bytes()));

    // If window already exists for this file, focus it
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Extract filename for the window title
    let filename = PathBuf::from(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Preview".to_string());

    let encoded_path = urlencoding::encode(file_path);
    let url = format!("index.html?mode=preview&file={}", encoded_path);

    let runtime_config = runtime_window_config_from_template(
        &app.config().app.windows[0],
        &label,
        WebviewUrl::App(url.into()),
    );
    let builder = WebviewWindowBuilder::from_config(app, &runtime_config)
        .map_err(|e| format!("Failed to configure preview window: {e}"))?
        .title(format!("{} — Scratch", filename))
        .inner_size(800.0, 600.0)
        .min_inner_size(400.0, 300.0)
        .resizable(true)
        .decorations(true);

    let window = builder
        .build()
        .map_err(|e| format!("Failed to create preview window: {}", e))?;

    // Focus the preview window so it appears on top of the main window.
    // Use a short delay because during cold start the main window may steal
    // focus after its WebView finishes loading.
    let win = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let _ = win.set_focus();
    });

    Ok(())
}

#[tauri::command]
fn open_file_preview(app: AppHandle, path: String) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    if !try_select_in_notes_folder(&app, &file_path) {
        create_preview_window(&app, &path)?;
    }
    Ok(())
}

fn open_markdown_file(app: &AppHandle, path: &Path) -> bool {
    is_markdown_extension(path)
        && path.is_file()
        && !try_select_in_notes_folder(app, path)
        && create_preview_window(app, &path.to_string_lossy()).is_ok()
}

// Handle CLI arguments: open .md files in preview mode.
// Returns true if a standalone preview window was created (file outside notes folder).
fn handle_cli_args(app: &AppHandle, args: &[String], cwd: &str) -> bool {
    let mut opened_file = false;
    let mut opened_preview = false;

    for arg in args.iter().skip(1) {
        // Skip flags
        if arg.starts_with('-') {
            continue;
        }

        let path = if PathBuf::from(arg).is_absolute() {
            PathBuf::from(arg)
        } else {
            PathBuf::from(cwd).join(arg)
        };

        if is_markdown_extension(&path) && path.is_file() {
            opened_file = true;
            opened_preview |= open_markdown_file(app, &path);
        } else if path.is_dir() {
            let canonical = path.canonicalize().unwrap_or(path.clone());
            let state = app.state::<AppState>();
            // Full initialization: directory creation, write-access check,
            // asset-scope update, config/settings persist, and search-index rebuild
            match initialize_notes_folder(app, &canonical, &state) {
                Ok(normalized_path) => {
                    // Emit event for when app is already running (single-instance)
                    let _ = app.emit_to("main", "set-notes-folder", normalized_path);
                    opened_file = true;
                }
                Err(e) => {
                    eprintln!("Failed to initialize notes folder {:?}: {}", canonical, e);
                }
            }
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.show();
                let _ = main_window.set_focus();
            }
        }
    }

    // If no files were opened, show and focus the main window
    if !opened_file {
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.show();
            let _ = main_window.set_focus();
        }
    }

    opened_preview
}

// On macOS, WKWebView reads per-app preferences from NSUserDefaults to decide
// whether to show the spelling underline and apply auto-correct in contenteditable
// regions. These keys default to off for new bundle IDs, which is why a fresh
// Tauri app gets neither the red underline nor auto-replace even when the HTML
// `spellcheck`/`autocorrect` attributes are set. Seed missing WebKit preferences
// before the webview is constructed; existing user-toggled values still win.
#[cfg(target_os = "macos")]
fn enable_webview_spellcheck_defaults() {
    use objc2_foundation::{NSString, NSUserDefaults};

    let keys = [
        "WebContinuousSpellCheckingEnabled",
        "WebGrammarCheckingEnabled",
        "WebAutomaticSpellingCorrectionEnabled",
    ];

    let defaults = NSUserDefaults::standardUserDefaults();
    for key in keys {
        let key = NSString::from_str(key);
        if defaults.objectForKey(&key).is_none() {
            defaults.setBool_forKey(true, &key);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    enable_webview_spellcheck_defaults();

    let app = tauri::Builder::default()
        // Single-instance: forward CLI args from subsequent launches to the running instance
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some((args, cwd)) = defer_single_instance_open_if_needed(app, args, cwd) {
                let opened_preview = handle_cli_args(app, &args, &cwd);
                if opened_preview {
                    request_full_window_closure_for_preview(app);
                }
                hide_main_window_for_standalone_preview(app, opened_preview);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .menu(build_application_menu)
        .on_menu_event(|app, event| {
            if event.id() == native_new_window_menu_spec().id {
                emit_native_new_window_request(app);
            } else if event.id() == native_open_folder_menu_spec().id {
                emit_native_open_folder_request(app);
            } else if event.id() == native_preferences_menu_spec().id {
                if let Err(error) = create_preferences_window(app) {
                    eprintln!("Failed to open Preferences: {error}");
                }
            }
        })
        .setup(|app| {
            // Load app config on startup (contains notes folder path)
            let mut app_config = load_app_config(app.handle());

            // Normalize legacy/invalid saved paths (e.g. file:// URI from older builds)
            if let Some(saved_path) = app_config.notes_folder.clone() {
                match normalize_notes_folder_path(&saved_path) {
                    Ok(normalized) if normalized.is_dir() => {
                        let normalized_str = normalized.to_string_lossy().into_owned();
                        if normalized_str != saved_path {
                            app_config.notes_folder = Some(normalized_str);
                            let _ = save_app_config(app.handle(), &app_config);
                        }
                    }
                    Ok(normalized) => {
                        // Path is structurally valid but not currently a directory
                        // (e.g., unmounted drive). Preserve the user's preference.
                        eprintln!("Notes folder not found (may be temporarily unavailable): {:?}", normalized);
                    }
                    Err(_) => {
                        app_config.notes_folder = None;
                        let _ = save_app_config(app.handle(), &app_config);
                    }
                }
            }

            if let Some(default_workspace) = app_config.notes_folder.clone() {
                let previous_workspace_count = app_config.workspaces.len();
                remember_workspace(&mut app_config, default_workspace);
                if app_config.workspaces.len() != previous_workspace_count {
                    let _ = save_app_config(app.handle(), &app_config);
                }
            }

            // Load per-folder settings if notes folder is set
            let settings = if let Some(ref folder) = app_config.notes_folder {
                load_settings(folder).unwrap_or_default()
            } else {
                Settings::default()
            };

            // Initialize search index if notes folder is set
            let ignored_dirs = get_effective_ignored_dirs(&settings);
            let search_index = if let Some(ref folder) = app_config.notes_folder {
                if let Ok(index_path) = get_search_index_path(app.handle()) {
                    SearchIndex::new(&index_path).ok().inspect(|idx| {
                        let _ = idx.rebuild_index(&PathBuf::from(folder), &ignored_dirs);
                    })
                } else {
                    None
                }
            }

            let default_workspace = app_config.notes_folder.clone();
            if app_config.global_settings.is_none() {
                if let Some(default_workspace) = default_workspace.as_deref() {
                    let legacy_settings = load_legacy_settings(default_workspace);
                    if let Some(workspace_settings) =
                        migrate_legacy_settings(&mut app_config, legacy_settings)
                    {
                        if let Err(error) = save_app_config(app.handle(), &app_config) {
                            eprintln!("Failed to persist global settings migration: {error}");
                            app_config.global_settings = None;
                        } else if let Err(error) =
                            save_settings(default_workspace, &workspace_settings)
                        {
                            eprintln!("Failed to clean migrated workspace settings: {error}");
                        }
                    }
                }
            }

            let state = AppState {
                app_config: RwLock::new(app_config),
                settings: RwLock::new(WorkspaceSettings::default()),
                notes_cache: RwLock::new(HashMap::new()),
                file_watcher: Mutex::new(None),
                search_index: Mutex::new(None),
                debounce_map: Arc::new(Mutex::new(WatcherDebounce::default())),
                workspace_sessions: RwLock::new(HashMap::new()),
                workspace_initializers: Mutex::new(HashMap::new()),
                workspace_bindings: RwLock::new(WorkspaceBindings::default()),
                is_quitting: AtomicBool::new(false),
                preserve_session_labels: Mutex::new(HashSet::new()),
            };
            app.manage(state);

            // Add notes folder to asset protocol scope so images can be served
            if let Some(ref folder) = app.state::<AppState>().app_config.read().expect("app_config read lock").notes_folder.clone() {
                let _ = app.asset_protocol_scope().allow_directory(folder, true);
            }

            // Handle CLI args on first launch; determine whether to show the main window.
            // When a standalone preview is opened (file outside the notes folder) and the
            // notes folder is already configured, the main window is hidden so users only
            // see the preview. When no notes folder is configured yet, the main window is
            // always shown so new users can complete onboarding via the FolderPicker.
            let mut opened_preview = false;
            for path in take_pending_opened_markdown_paths() {
                opened_preview |= open_markdown_file(app.handle(), &path);
            }

            for (args, cwd) in take_pending_single_instance_opens() {
                let pending_opened_preview = handle_cli_args(app.handle(), &args, &cwd);
                opened_preview |= pending_opened_preview;
            }

            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let cwd = std::env::current_dir()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                opened_preview |= handle_cli_args(app.handle(), &args, &cwd);
            }
            if opened_preview {
                request_full_window_closure_for_preview(app.handle());
            }

            let app_state = app.state::<AppState>();
            let mut config_snapshot = app_state
                .app_config
                .read()
                .expect("app config read lock")
                .clone();
            let had_main_preference = config_snapshot.records.contains_key("main");
            if !opened_preview && !had_main_preference {
                if let Some(default_workspace) = default_workspace
                    .as_ref()
                    .filter(|workspace| Path::new(workspace).is_dir())
                {
                    let mut next = config_snapshot.clone();
                    upsert_window_session_workspace(
                        &mut next,
                        "main",
                        default_workspace.clone(),
                    );
                    if save_app_config(app.handle(), &next).is_ok() {
                        *app_state
                            .app_config
                            .write()
                            .expect("app config write lock") = next.clone();
                        config_snapshot = next;
                    }
                }
            }

            let restore_candidates = restorable_window_sessions(
                &config_snapshot,
                opened_preview,
                |workspace| Path::new(workspace).is_dir(),
            );
            let mut main_restored = false;
            for (label, record) in restore_candidates {
                match restore_window_session(app.handle(), &app_state, &label, &record) {
                    Ok(()) => main_restored |= label == "main",
                    Err(error) => eprintln!("Window session restore skipped for {label}: {error}"),
                }
            }
            if let Some(fallback) = fallback_main_session(
                &config_snapshot,
                default_workspace.as_deref(),
                opened_preview,
                main_restored,
                |workspace| Path::new(workspace).is_dir(),
            ) {
                match restore_window_session(app.handle(), &app_state, "main", &fallback) {
                    Ok(()) => {}
                    Err(error) => {
                        eprintln!("Fallback main window session restore skipped: {error}")
                    }
                }
            }

            let main_window_hidden =
                hide_main_window_for_standalone_preview(app.handle(), opened_preview);

            if should_show_main_window(main_window_hidden) {
                if let Some(main_window) = app.get_webview_window("main") {
                    // Show the main window when:
                    // - No standalone preview was opened (normal launch), OR
                    // - No notes folder is configured yet (new user needs FolderPicker
                    //   for onboarding, even if a preview is also showing).
                    let _ = main_window.show();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                handle_window_destroyed(window.app_handle(), window.label());
                return;
            }

            // Handle drag-and-drop of .md files onto any window
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let app = window.app_handle();
                for path in paths {
                    if is_markdown_extension(path)
                        && path.is_file()
                        && !try_select_in_notes_folder(app, path)
                    {
                        let _ = create_preview_window(app, &path.to_string_lossy());
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_notes_folder,
            get_window_session,
            close_window_after_save,
            update_window_session,
            clear_window_session,
            set_notes_folder,
            list_workspaces,
            remove_workspace_from_list,
            switch_workspace,
            open_workspace_window,
            open_preferences_window,
            list_notes,
            read_note,
            save_note,
            persist_recovery_snapshot,
            write_draft_checkpoint,
            get_draft_checkpoint,
            clear_draft_checkpoint,
            list_draft_checkpoints,
            delete_note,
            create_note,
            duplicate_note,
            list_folders,
            create_folder,
            delete_folder,
            rename_folder,
            move_note,
            move_folder,
            get_settings,
            update_global_settings,
            update_workspace_settings,
            update_settings,
            update_git_enabled,
            preview_note_name,
            write_file,
            search_notes,
            start_file_watcher,
            rebuild_search_index,
            get_default_ignored_patterns,
            copy_to_clipboard,
            copy_image_to_assets,
            save_clipboard_image,
            open_folder_dialog,
            open_in_file_manager,
            open_url_safe,
            git_is_available,
            git_get_status,
            git_init_repo,
            git_commit,
            git_push,
            git_fetch,
            git_pull,
            git_add_remote,
            git_set_remote_url,
            git_remove_remote,
            git_push_with_upstream,
            ai_check_claude_cli,
            ai_check_codex_cli,
            ai_check_opencode_cli,
            ai_check_ollama_cli,
            ai_execute_claude,
            ai_execute_codex,
            ai_execute_opencode,
            ai_execute_ollama,
            read_file_direct,
            save_file_direct,
            recreate_file_direct,
            import_file_to_folder,
            open_file_preview,
            install_cli,
            uninstall_cli,
            get_cli_status,
            set_title_bar_theme,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Use .run() callback to handle macOS "Open With" file events
    // RunEvent::Opened is macOS-only in Tauri v2
    app.run(|_app_handle, _event| {
        if matches!(&_event, tauri::RunEvent::ExitRequested { .. }) {
            if let Some(state) = _app_handle.try_state::<AppState>() {
                state.is_quitting.store(true, Ordering::SeqCst);
            }
        }

        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .collect::<Vec<_>>();

            if let Some(paths) = defer_opened_markdown_paths_if_needed(_app_handle, paths) {
                let mut opened_preview = false;
                for path in paths {
                    opened_preview |= open_markdown_file(_app_handle, &path);
                }

                if opened_preview {
                    request_full_window_closure_for_preview(_app_handle);
                }
                hide_main_window_for_standalone_preview(_app_handle, opened_preview);
            }
        }
    });
}

#[cfg(target_os = "windows")]
mod windows_title_bar {
    use tauri::WebviewWindow;

    #[allow(non_snake_case)]
    mod dwm {
        pub const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
        pub const DWMWA_CAPTION_COLOR: u32 = 35;
        pub const DWMWA_BORDER_COLOR: u32 = 34;

        extern "system" {
            pub fn DwmSetWindowAttribute(
                hwnd: isize,
                attr: u32,
                value: *const std::ffi::c_void,
                size: u32,
            ) -> i32;
        }
    }

    pub fn apply_title_bar_theme(window: &WebviewWindow, is_dark: bool, rgb: (u8, u8, u8)) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let hwnd = hwnd.0 as isize;

        // Windows COLORREF is little-endian 0x00BBGGRR
        let (r, g, b) = rgb;
        let caption_color: u32 =
            ((b as u32) << 16) | ((g as u32) << 8) | (r as u32);

        unsafe {
            let set_attr = |attr: u32, value: *const std::ffi::c_void, size: u32| {
                let _ = dwm::DwmSetWindowAttribute(hwnd, attr, value, size);
            };

            let dark_mode: i32 = if is_dark { 1 } else { 0 };
            set_attr(
                dwm::DWMWA_USE_IMMERSIVE_DARK_MODE,
                &dark_mode as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<i32>() as u32,
            );
            set_attr(
                dwm::DWMWA_CAPTION_COLOR,
                &caption_color as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            );
            set_attr(
                dwm::DWMWA_BORDER_COLOR,
                &caption_color as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}

#[tauri::command]
fn set_title_bar_theme(
    window: WebviewWindow,
    is_dark: bool,
    r: u8,
    g: u8,
    b: u8,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_title_bar::apply_title_bar_theme(&window, is_dark, (r, g, b));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, is_dark, r, g, b);
    }
    Ok(())
}

#[cfg(test)]
mod settings_tests {
    use super::{
        merge_settings, migrate_legacy_settings, settings_change_targets, split_settings,
        apply_settings_patch, AppConfig, GlobalSettings, Settings, SettingsChangedPayload,
        SettingsChangeScope, SettingsChangeTargets, WorkspaceBindings, WorkspaceSettings,
    };

    #[test]
    fn settings_preserve_sidebar_note_sort_order() {
        let settings: Settings = serde_json::from_str(
            r#"{"theme":{"mode":"system"},"sidebarSortOrder":"oldest"}"#,
        )
        .expect("settings should deserialize");

        assert_eq!(settings.sidebar_sort_order.as_deref(), Some("oldest"));

        let serialized = serde_json::to_value(settings).expect("settings should serialize");
        assert_eq!(serialized["sidebarSortOrder"], "oldest");
    }

    #[test]
    fn split_and_merge_keep_theme_global_and_pins_workspace_scoped() {
        let settings: Settings = serde_json::from_str(
            r#"{
                "theme":{"mode":"dark"},
                "editorWidth":"wide",
                "gitEnabled":true,
                "pinnedNoteIds":["Plans/Roadmap"],
                "foldersEnabled":true
            }"#,
        )
        .expect("settings should deserialize");

        let (global, workspace) = split_settings(settings.clone());
        let global_json = serde_json::to_value(&global).expect("global settings serialize");
        let workspace_json =
            serde_json::to_value(&workspace).expect("workspace settings serialize");

        assert_eq!(global_json["theme"]["mode"], "dark");
        assert_eq!(global_json["editorWidth"], "wide");
        assert!(global_json.get("pinnedNoteIds").is_none());
        assert!(global_json.get("gitEnabled").is_none());
        assert_eq!(workspace_json["pinnedNoteIds"][0], "Plans/Roadmap");
        assert_eq!(workspace_json["gitEnabled"], true);
        assert!(workspace_json.get("theme").is_none());
        assert!(workspace_json.get("editorWidth").is_none());

        let merged = merge_settings(&global, &workspace);
        assert_eq!(merged.theme.mode, "dark");
        assert_eq!(merged.editor_width.as_deref(), Some("wide"));
        assert_eq!(
            merged.pinned_note_ids.as_deref(),
            Some(["Plans/Roadmap".to_string()].as_slice())
        );
        assert_eq!(merged.git_enabled, Some(true));
    }

    #[test]
    fn legacy_default_workspace_settings_migrate_only_once() {
        let mut config: AppConfig = serde_json::from_str(
            r#"{"notes_folder":"/notes/main","workspaces":["/notes/main"]}"#,
        )
        .expect("legacy config should deserialize");
        let legacy: Settings = serde_json::from_str(
            r#"{"theme":{"mode":"dark"},"pinnedNoteIds":["Main"]}"#,
        )
        .expect("legacy settings should deserialize");

        let workspace = migrate_legacy_settings(&mut config, legacy)
            .expect("missing global config should trigger migration");

        assert_eq!(
            config
                .global_settings
                .as_ref()
                .expect("global settings persisted in config")
                .theme
                .mode,
            "dark"
        );
        assert_eq!(workspace.pinned_note_ids, Some(vec!["Main".to_string()]));
        let config_json = serde_json::to_value(&config).expect("migrated config should serialize");
        assert_eq!(config_json["global_settings"]["theme"]["mode"], "dark");
        assert!(config_json["global_settings"].get("pinnedNoteIds").is_none());

        let later_legacy: Settings = serde_json::from_str(
            r#"{"theme":{"mode":"light"},"pinnedNoteIds":["Other"]}"#,
        )
        .expect("later legacy settings should deserialize");
        assert!(migrate_legacy_settings(&mut config, later_legacy).is_none());
        assert_eq!(
            config.global_settings.as_ref().unwrap().theme.mode,
            "dark",
            "an existing global config is the migration marker"
        );
    }

    #[test]
    fn global_settings_changes_target_every_application_window() {
        let mut bindings = WorkspaceBindings::default();
        bindings.bind("main", "/notes/shared");
        bindings.bind("workspace-copy", "/notes/shared");
        bindings.bind("workspace-other", "/notes/other");

        assert_eq!(
            settings_change_targets(&bindings, SettingsChangeScope::Global, None),
            SettingsChangeTargets::All
        );
    }

    #[test]
    fn workspace_settings_changes_target_only_windows_with_same_binding() {
        let mut bindings = WorkspaceBindings::default();
        bindings.bind("main", "/notes/shared");
        bindings.bind("workspace-copy", "/notes/shared");
        bindings.bind("workspace-other", "/notes/other");

        assert_eq!(
            settings_change_targets(
                &bindings,
                SettingsChangeScope::Workspace,
                Some("/notes/shared"),
            ),
            SettingsChangeTargets::Windows(vec![
                "main".to_string(),
                "workspace-copy".to_string(),
            ])
        );
    }

    #[test]
    fn settings_changed_payload_matches_the_frontend_contract() {
        let global = serde_json::to_value(SettingsChangedPayload {
            scope: SettingsChangeScope::Global,
            workspace: None,
        })
        .expect("global payload should serialize");
        let workspace = serde_json::to_value(SettingsChangedPayload {
            scope: SettingsChangeScope::Workspace,
            workspace: Some("/notes/shared".to_string()),
        })
        .expect("workspace payload should serialize");

        assert_eq!(global, serde_json::json!({"scope":"global","workspace":null}));
        assert_eq!(
            workspace,
            serde_json::json!({"scope":"workspace","workspace":"/notes/shared"})
        );
    }

    #[test]
    fn global_patch_preserves_unmentioned_global_fields() {
        let current: GlobalSettings = serde_json::from_str(
            r#"{"theme":{"mode":"dark"},"editorWidth":"wide"}"#,
        )
        .expect("current global settings should deserialize");

        let updated = apply_settings_patch(
            &current,
            serde_json::json!({"editorWidth":"narrow"}),
        )
        .expect("global patch should apply");

        assert_eq!(updated.theme.mode, "dark");
        assert_eq!(updated.editor_width.as_deref(), Some("narrow"));
    }

    #[test]
    fn workspace_patch_preserves_unmentioned_workspace_fields() {
        let current: WorkspaceSettings = serde_json::from_str(
            r#"{"gitEnabled":true,"pinnedNoteIds":["Roadmap"]}"#,
        )
        .expect("current workspace settings should deserialize");

        let updated = apply_settings_patch(
            &current,
            serde_json::json!({"pinnedNoteIds":["Roadmap","Inbox"]}),
        )
        .expect("workspace patch should apply");

        assert_eq!(updated.git_enabled, Some(true));
        assert_eq!(
            updated.pinned_note_ids,
            Some(vec!["Roadmap".to_string(), "Inbox".to_string()])
        );
    }
}

#[cfg(test)]
mod window_session_tests {
    use super::{
        apply_settings_patch, remove_window_session_on_destroy, restorable_window_sessions,
        fallback_main_session, upsert_window_session_workspace, AppConfig, WindowGeometry,
        WindowSession,
    };

    #[test]
    fn legacy_app_config_deserializes_with_no_window_records() {
        let config: AppConfig = serde_json::from_str(
            r#"{"notes_folder":"/notes/main","workspaces":["/notes/main"]}"#,
        )
        .expect("legacy config should deserialize");

        assert!(config.records.is_empty());
    }

    #[test]
    fn partial_window_patch_preserves_workspace_sidebar_and_geometry() {
        let current = WindowSession {
            workspace: "/notes/client".to_string(),
            selected_note_id: Some("Inbox".to_string()),
            sidebar_visible: true,
            focus_mode: false,
            geometry: Some(WindowGeometry {
                x: 80,
                y: 120,
                width: 1080,
                height: 720,
            }),
        };

        let updated = apply_settings_patch(
            &current,
            serde_json::json!({"selectedNoteId":"Roadmap","focusMode":true}),
        )
        .expect("window patch should apply");

        assert_eq!(updated.workspace, "/notes/client");
        assert_eq!(updated.selected_note_id.as_deref(), Some("Roadmap"));
        assert!(updated.sidebar_visible);
        assert!(updated.focus_mode);
        assert_eq!(updated.geometry, current.geometry);
    }

    #[test]
    fn window_geometry_uses_frontend_camel_case_contract() {
        let session = WindowSession {
            workspace: "/notes/client".to_string(),
            selected_note_id: None,
            sidebar_visible: false,
            focus_mode: true,
            geometry: Some(WindowGeometry {
                x: -20,
                y: 40,
                width: 900,
                height: 640,
            }),
        };

        let json = serde_json::to_value(session).expect("session should serialize");
        assert_eq!(json["workspace"], "/notes/client");
        assert_eq!(json["selectedNoteId"], serde_json::Value::Null);
        assert_eq!(json["sidebarVisible"], false);
        assert_eq!(json["focusMode"], true);
        assert_eq!(
            json["geometry"],
            serde_json::json!({"x":-20,"y":40,"width":900,"height":640})
        );
    }

    #[test]
    fn standalone_preview_bypasses_all_full_window_restoration() {
        let mut config = AppConfig::default();
        upsert_window_session_workspace(&mut config, "main", "/notes/main".to_string());
        upsert_window_session_workspace(
            &mut config,
            "workspace-client",
            "/notes/client".to_string(),
        );

        let restored = restorable_window_sessions(&config, true, |_| true);

        assert!(restored.is_empty());
        assert_eq!(config.records.len(), 2, "preview bypass must not delete preferences");
    }

    #[test]
    fn inaccessible_workspace_is_filtered_without_deleting_its_record() {
        let mut config = AppConfig::default();
        upsert_window_session_workspace(&mut config, "main", "/notes/main".to_string());
        upsert_window_session_workspace(
            &mut config,
            "workspace-missing",
            "/notes/missing".to_string(),
        );

        let restored = restorable_window_sessions(&config, false, |path| path != "/notes/missing");

        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].0, "main");
        assert!(config.records.contains_key("workspace-missing"));
    }

    #[test]
    fn inaccessible_main_record_falls_back_to_valid_default_without_erasing_preference() {
        let mut config = AppConfig::default();
        upsert_window_session_workspace(&mut config, "main", "/notes/missing".to_string());

        let fallback = fallback_main_session(
            &config,
            Some("/notes/default"),
            false,
            false,
            |path| path == "/notes/default",
        )
        .expect("valid default should keep a normal launch visible");

        assert_eq!(fallback.workspace, "/notes/default");
        assert_eq!(config.records["main"].workspace, "/notes/missing");
    }

    #[test]
    fn individual_close_removes_record_but_quit_preserves_open_records() {
        let mut config = AppConfig::default();
        upsert_window_session_workspace(&mut config, "main", "/notes/main".to_string());
        upsert_window_session_workspace(
            &mut config,
            "workspace-client",
            "/notes/client".to_string(),
        );

        assert!(remove_window_session_on_destroy(
            &mut config,
            "workspace-client",
            false,
            false,
        ));
        assert!(!config.records.contains_key("workspace-client"));
        assert!(!remove_window_session_on_destroy(
            &mut config,
            "main",
            true,
            false,
        ));
        assert!(config.records.contains_key("main"));

        assert!(!remove_window_session_on_destroy(
            &mut config,
            "main",
            false,
            true,
        ));
        assert!(config.records.contains_key("main"));
    }

    #[test]
    fn workspace_rebind_updates_record_without_losing_ui_state() {
        let mut config = AppConfig::default();
        config.records.insert(
            "main".to_string(),
            WindowSession {
                workspace: "/notes/old".to_string(),
                selected_note_id: Some("Roadmap".to_string()),
                sidebar_visible: false,
                focus_mode: true,
                geometry: None,
            },
        );

        upsert_window_session_workspace(&mut config, "main", "/notes/new".to_string());

        let session = config.records.get("main").unwrap();
        assert_eq!(session.workspace, "/notes/new");
        assert_eq!(session.selected_note_id.as_deref(), Some("Roadmap"));
        assert!(!session.sidebar_visible);
        assert!(session.focus_mode);
    }

    #[test]
    fn opening_workspace_window_creates_initial_record() {
        let mut config = AppConfig::default();

        upsert_window_session_workspace(
            &mut config,
            "workspace-client",
            "/notes/client".to_string(),
        );

        assert_eq!(
            config.records["workspace-client"],
            WindowSession::for_workspace("/notes/client".to_string())
        );
    }

    #[test]
    fn fallback_main_session_clears_selected_note_when_workspace_changes() {
        let mut config = AppConfig::default();
        config.records.insert(
            "main".to_string(),
            WindowSession {
                workspace: "/notes/old".to_string(),
                selected_note_id: Some("Roadmap".to_string()),
                sidebar_visible: true,
                focus_mode: false,
                geometry: None,
            },
        );

        let fallback = fallback_main_session(
            &config,
            Some("/notes/new"),
            false,
            false,
            |path| path == "/notes/new",
        )
        .expect("valid default should produce a fallback");

        assert_eq!(fallback.workspace, "/notes/new");
        assert_eq!(fallback.selected_note_id, None);
        assert_eq!(config.records["main"].selected_note_id, Some("Roadmap".to_string()));
    }

    #[test]
    fn fallback_main_session_preserves_selected_note_when_workspace_matches() {
        let mut config = AppConfig::default();
        config.records.insert(
            "main".to_string(),
            WindowSession {
                workspace: "/notes/default".to_string(),
                selected_note_id: Some("Roadmap".to_string()),
                sidebar_visible: true,
                focus_mode: false,
                geometry: None,
            },
        );

        let fallback = fallback_main_session(
            &config,
            Some("/notes/default"),
            false,
            false,
            |path| path == "/notes/default",
        )
        .expect("matching default should produce a fallback");

        assert_eq!(fallback.workspace, "/notes/default");
        assert_eq!(fallback.selected_note_id, Some("Roadmap".to_string()));
    }
}

#[cfg(test)]
mod standalone_window_tests {
    use super::{
        should_defer_open_request,
        should_hide_main_window_for_standalone_preview,
        should_show_main_window,
    };

    #[test]
    fn hides_main_window_for_a_standalone_preview_when_notes_are_configured() {
        assert!(should_hide_main_window_for_standalone_preview(true, true));
    }

    #[test]
    fn keeps_main_window_for_onboarding_without_a_notes_folder() {
        assert!(!should_hide_main_window_for_standalone_preview(true, false));
    }

    #[test]
    fn keeps_main_window_for_a_normal_launch() {
        assert!(!should_hide_main_window_for_standalone_preview(false, true));
    }

    #[test]
    fn defers_file_open_requests_until_app_state_is_ready() {
        assert!(should_defer_open_request(false));
        assert!(!should_defer_open_request(true));
    }

    #[test]
    fn normal_launch_shows_main_even_when_no_workspace_can_be_restored() {
        assert!(should_show_main_window(false));
        assert!(!should_show_main_window(true));
    }
}

#[cfg(test)]
mod window_chrome_tests {
    use super::{runtime_window_config_from_template, WebviewUrl};

    #[test]
    fn release_config_uses_the_canonical_scratch_identity() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri config should deserialize");

        assert_eq!(config["productName"].as_str(), Some("Scratch"));
        assert_eq!(config["identifier"].as_str(), Some("com.scratch.app"));
    }

    #[test]
    fn every_macos_window_uses_the_requested_traffic_light_geometry() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri config should deserialize");
        let main_window = &config["app"]["windows"][0];

        let configured_position = &main_window["trafficLightPosition"];
        assert_eq!(configured_position["x"].as_f64(), Some(16.0));
        assert_eq!(configured_position["y"].as_f64(), Some(24.0));
        let template: tauri::utils::config::WindowConfig =
            serde_json::from_value(main_window.clone()).expect("main window config should parse");
        let runtime = runtime_window_config_from_template(
            &template,
            "preview-alignment-test",
            WebviewUrl::App("index.html?mode=preview".into()),
        );

        assert_eq!(
            runtime.traffic_light_position,
            template.traffic_light_position
        );
        assert_eq!(runtime.title_bar_style, template.title_bar_style);
        assert_eq!(runtime.hidden_title, template.hidden_title);
        assert!(runtime.visible, "runtime windows must still be shown");
    }
}

#[cfg(test)]
mod native_new_window_menu_tests {
    use super::{
        focused_window_target, native_new_window_menu_spec, native_open_folder_menu_spec,
        native_preferences_menu_spec, new_window_event_target, is_full_editor_window,
    };

    #[test]
    fn file_menu_exposes_new_window_with_the_requested_shortcut() {
        let spec = native_new_window_menu_spec();

        assert_eq!(spec.parent_menu, "File");
        assert_eq!(spec.id, "new-window");
        assert_eq!(spec.label, "New Window");
        assert_eq!(spec.accelerator, "CmdOrCtrl+Shift+N");
    }

    #[test]
    fn native_menus_expose_open_folder_and_preferences() {
        let open_folder = native_open_folder_menu_spec();
        assert_eq!(open_folder.parent_menu, "File");
        assert_eq!(open_folder.id, "open-folder");
        assert_eq!(open_folder.label, "Open Folder…");
        assert_eq!(open_folder.accelerator, "CmdOrCtrl+O");

        let preferences = native_preferences_menu_spec();
        assert_eq!(preferences.id, "preferences");
        assert_eq!(preferences.label, "Preferences…");
        assert_eq!(preferences.accelerator, "CmdOrCtrl+,");
    }

    #[test]
    fn native_new_window_action_targets_one_full_editor_window() {
        let windows = [
            ("main", false),
            ("workspace-client", true),
            ("preview-note", false),
        ];
        assert_eq!(
            new_window_event_target(windows.iter().copied()),
            Some("workspace-client")
        );

        let preview_focused = [("main", false), ("preview-note", true)];
        assert_eq!(
            new_window_event_target(preview_focused.iter().copied()),
            Some("main")
        );
    }

    #[test]
    fn open_folder_targets_the_focused_window_including_standalone_preview() {
        let windows = [("main", false), ("preview-note", true)];
        assert_eq!(focused_window_target(windows.iter().copied()), Some("preview-note"));
    }

    #[test]
    fn is_full_editor_window_targets_only_main_and_workspace_windows() {
        assert!(is_full_editor_window("main"));
        assert!(is_full_editor_window("workspace-alpha"));
        assert!(is_full_editor_window("workspace-123"));
        assert!(!is_full_editor_window("preview-note"));
        assert!(!is_full_editor_window("preferences"));
        assert!(!is_full_editor_window("other"));
    }
}

#[cfg(test)]
mod workspace_registry_tests {
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier, Mutex, RwLock};

    use super::{
        build_workspace_infos, ensure_shared_resource, get_or_initialize_shared,
        forget_workspace, remember_workspace, workspace_is_remembered,
        uses_default_workspace_fallback,
        note_change_targets, save_note_in_workspace, semantic_file_change_event,
        workspace_window_label,
        AppConfig, AppState, WorkspaceBindings, WorkspaceSession,
        WindowSession, WorkspaceRuntime, persistence, abs_path_from_id,
    };

    #[test]
    fn legacy_app_config_deserializes_without_workspaces() {
        let config: AppConfig = serde_json::from_str(r#"{"notes_folder":"/notes/main"}"#)
            .expect("legacy config should deserialize");

        assert_eq!(config.notes_folder.as_deref(), Some("/notes/main"));
        assert!(config.workspaces.is_empty());
    }

    #[test]
    fn remembering_an_additional_workspace_preserves_the_default_folder() {
        let mut config = AppConfig {
            notes_folder: Some("/notes/main".to_string()),
            workspaces: vec!["/notes/main".to_string()],
            global_settings: None,
            records: Default::default(),
        };

        remember_workspace(&mut config, "/notes/client".to_string());
        remember_workspace(&mut config, "/notes/client".to_string());

        assert_eq!(config.notes_folder.as_deref(), Some("/notes/main"));
        assert_eq!(
            config.workspaces,
            vec!["/notes/main".to_string(), "/notes/client".to_string()]
        );
    }

    #[test]
    fn forgetting_a_workspace_removes_restore_records_without_touching_other_folders() {
        let mut config = AppConfig {
            notes_folder: Some("/notes/main".to_string()),
            workspaces: vec!["/notes/main".to_string(), "/notes/client".to_string()],
            global_settings: None,
            records: HashMap::from([
                ("main".to_string(), WindowSession::for_workspace("/notes/main".to_string())),
                ("client".to_string(), WindowSession::for_workspace("/notes/client".to_string())),
            ]),
        };

        assert!(forget_workspace(&mut config, "/notes/main"));
        assert_eq!(config.notes_folder.as_deref(), Some("/notes/client"));
        assert_eq!(config.workspaces, vec!["/notes/client".to_string()]);
        assert!(!config.records.contains_key("main"));
        assert!(config.records.contains_key("client"));
        assert!(!workspace_is_remembered(&config, "/notes/main"));
        assert!(workspace_is_remembered(&config, "/notes/client"));
    }

    #[test]
    fn preferences_and_preview_use_the_default_workspace_settings_fallback() {
        assert!(uses_default_workspace_fallback("main"));
        assert!(uses_default_workspace_fallback("preview-note"));
        assert!(uses_default_workspace_fallback("preferences"));
        assert!(!uses_default_workspace_fallback("workspace-client"));
    }

    #[test]
    fn explicit_workspace_window_labels_are_unique_and_path_scoped() {
        let first = workspace_window_label(Path::new("/notes/client-a"), 1);
        let same_path_second_window = workspace_window_label(Path::new("/notes/client-a"), 2);
        let other = workspace_window_label(Path::new("/notes/client-b"), 1);

        assert_ne!(first, same_path_second_window);
        assert_ne!(first, other);
        assert!(first.starts_with("workspace-"));
        assert!(first
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-'));
    }

    #[test]
    fn explicit_windows_can_bind_the_same_workspace() {
        let mut bindings = WorkspaceBindings::default();
        bindings.bind("main", "/notes/shared");
        bindings.bind("workspace-copy", "/notes/shared");

        assert_eq!(bindings.path_for_window("main"), Some("/notes/shared"));
        assert_eq!(
            bindings.path_for_window("workspace-copy"),
            Some("/notes/shared")
        );
        assert_eq!(
            bindings.windows_for_path("/notes/shared"),
            vec!["main".to_string(), "workspace-copy".to_string()]
        );
    }

    #[test]
    fn workspace_change_targets_every_window_bound_to_the_note_path() {
        let mut bindings = WorkspaceBindings::default();
        bindings.bind("main", "/notes/shared");
        bindings.bind("workspace-copy", "/notes/shared");
        bindings.bind("workspace-other", "/notes/other");

        assert_eq!(
            bindings.windows_for_note_path(Path::new("/notes/shared/a.md")),
            vec!["main".to_string(), "workspace-copy".to_string()]
        );
    }

    #[test]
    fn semantic_save_event_targets_every_peer_but_not_its_origin_window() {
        let mut bindings = WorkspaceBindings::default();
        bindings.bind("main", "/notes/shared");
        bindings.bind("workspace-copy", "/notes/shared");
        bindings.bind("workspace-other", "/notes/other");

        assert_eq!(
            note_change_targets(
                &bindings,
                Path::new("/notes/shared/a.md"),
                Some("main"),
            ),
            vec!["workspace-copy".to_string()]
        );
    }

    #[test]
    fn semantic_rename_event_carries_both_ids_and_new_revision() {
        let note = super::Note {
            id: "Archive/Plan".to_string(),
            title: "Plan".to_string(),
            content: "# Plan".to_string(),
            path: "/notes/Archive/Plan.md".to_string(),
            modified: 1,
            revision: "revision-2".to_string(),
        };

        let event = semantic_file_change_event(
            "/notes".to_string(),
            "renamed",
            Some("Projects/Plan".to_string()),
            Some(&note),
            Some("main".to_string()),
        );

        assert_eq!(event.changed_ids, vec!["Projects/Plan", "Archive/Plan"]);
        assert_eq!(event.previous_id.as_deref(), Some("Projects/Plan"));
        assert_eq!(event.current_id.as_deref(), Some("Archive/Plan"));
        assert_eq!(event.revision.as_deref(), Some("revision-2"));
        assert_eq!(event.path, "/notes/Archive/Plan.md");
    }

    #[test]
    fn semantic_delete_event_has_no_current_id_or_revision() {
        let event = semantic_file_change_event(
            "/notes".to_string(),
            "deleted",
            Some("Plan".to_string()),
            None,
            Some("main".to_string()),
        );

        assert_eq!(event.changed_ids, vec!["Plan"]);
        assert_eq!(event.previous_id.as_deref(), Some("Plan"));
        assert_eq!(event.current_id, None);
        assert_eq!(event.revision, None);
        assert_eq!(event.path, "/notes/Plan.md");
    }

    #[test]
    fn starting_one_shared_workspace_resource_twice_runs_factory_once() {
        let slot = Mutex::new(None);
        let factory_calls = AtomicUsize::new(0);

        assert!(ensure_shared_resource(&slot, || {
            factory_calls.fetch_add(1, Ordering::Relaxed);
            Ok::<_, String>("watcher")
        })
        .unwrap());
        assert!(!ensure_shared_resource(&slot, || {
            factory_calls.fetch_add(1, Ordering::Relaxed);
            Ok::<_, String>("replacement")
        })
        .unwrap());

        assert_eq!(factory_calls.load(Ordering::Relaxed), 1);
        assert_eq!(*slot.lock().unwrap(), Some("watcher"));
    }

    #[test]
    fn concurrent_workspace_acquisition_initializes_one_shared_runtime() {
        let registry = Arc::new(RwLock::new(HashMap::<String, Arc<usize>>::new()));
        let initializers = Arc::new(Mutex::new(HashMap::new()));
        let barrier = Arc::new(Barrier::new(2));
        let factory_calls = Arc::new(AtomicUsize::new(0));

        let handles = (0..2)
            .map(|_| {
                let registry = Arc::clone(&registry);
                let initializers = Arc::clone(&initializers);
                let barrier = Arc::clone(&barrier);
                let factory_calls = Arc::clone(&factory_calls);
                std::thread::spawn(move || {
                    barrier.wait();
                    get_or_initialize_shared(
                        &registry,
                        &initializers,
                        "workspace-a".to_string(),
                        || {
                            factory_calls.fetch_add(1, Ordering::SeqCst);
                            std::thread::sleep(std::time::Duration::from_millis(20));
                            Ok::<usize, String>(42)
                        },
                    )
                    .expect("shared workspace")
                })
            })
            .collect::<Vec<_>>();

        let first = handles[0].thread().id();
        let sessions = handles
            .into_iter()
            .map(|handle| handle.join().expect("workspace acquisition thread"))
            .collect::<Vec<_>>();

        assert_ne!(first, std::thread::current().id());
        assert_eq!(factory_calls.load(Ordering::SeqCst), 1);
        assert!(Arc::ptr_eq(&sessions[0], &sessions[1]));
        assert_eq!(*sessions[0], 42);
    }

    #[test]
    fn window_bindings_keep_identical_note_ids_in_separate_workspaces() {
        let mut bindings = WorkspaceBindings::default();
        bindings.bind("main", "/notes/main");
        bindings.bind("workspace-client", "/notes/client");

        assert_eq!(bindings.path_for_window("main"), Some("/notes/main"));
        assert_eq!(
            bindings.path_for_window("workspace-client"),
            Some("/notes/client")
        );
        assert_eq!(bindings.window_for_path("/notes/main"), Some("main"));
        assert_eq!(
            bindings.window_for_path("/notes/client"),
            Some("workspace-client")
        );
    }

    #[test]
    fn note_paths_resolve_to_the_most_specific_open_workspace() {
        let mut bindings = WorkspaceBindings::default();
        bindings.bind("main", "/notes");
        bindings.bind("workspace-client", "/notes/client");

        assert_eq!(
            bindings.window_for_note_path(Path::new("/notes/client/shared.md")),
            Some("workspace-client")
        );
        assert_eq!(
            bindings.window_for_note_path(Path::new("/notes/general.md")),
            Some("main")
        );
        assert_eq!(
            bindings.window_for_note_path(Path::new("/outside/note.md")),
            None
        );
    }

    #[test]
    fn multiple_windows_bound_to_one_workspace_are_not_a_conflict() {
        let mut bindings = WorkspaceBindings::default();
        bindings.bind("main", "/notes/main");
        bindings.bind("workspace-client", "/notes/client");
        bindings.bind("workspace-client-copy", "/notes/client");

        assert_eq!(
            bindings.windows_for_path("/notes/client"),
            vec![
                "workspace-client".to_string(),
                "workspace-client-copy".to_string(),
            ]
        );
    }

    #[test]
    fn removing_one_window_binding_preserves_other_workspaces() {
        let mut bindings = WorkspaceBindings::default();
        bindings.bind("main", "/notes/main");
        bindings.bind("workspace-client", "/notes/client");

        assert_eq!(
            bindings.unbind("workspace-client"),
            Some("/notes/client".to_string())
        );
        assert_eq!(bindings.path_for_window("workspace-client"), None);
        assert_eq!(bindings.path_for_window("main"), Some("/notes/main"));
    }

    #[test]
    fn workspace_sessions_keep_settings_and_cache_isolated() {
        let first = WorkspaceSession::empty("/notes/client-a".to_string());
        let second = WorkspaceSession::empty("/notes/client-b".to_string());

        first
            .settings
            .write()
            .expect("first settings write lock")
            .git_enabled = Some(true);
        first
            .notes_cache
            .write()
            .expect("first cache write lock")
            .insert(
                "shared-id".to_string(),
                super::NoteMetadata {
                    id: "shared-id".to_string(),
                    title: "Client A".to_string(),
                    preview: String::new(),
                    modified: 0,
                },
            );

        assert_eq!(first.notes_folder, "/notes/client-a");
        assert_eq!(second.notes_folder, "/notes/client-b");
        assert_eq!(
            second
                .settings
                .read()
                .expect("second settings read lock")
                .git_enabled,
            None
        );
        assert!(second
            .notes_cache
            .read()
            .expect("second cache read lock")
            .is_empty());
    }

    #[test]
    fn app_state_resolves_sessions_by_window_without_cross_talk() {
        let state = AppState::default();
        state.register_workspace_session(
            "workspace-a",
            WorkspaceSession::empty("/notes/client-a".to_string()),
        );
        state.register_workspace_session(
            "workspace-b",
            WorkspaceSession::empty("/notes/client-b".to_string()),
        );

        assert_eq!(
            state
                .workspace_session("workspace-a")
                .expect("workspace A session")
                .notes_folder,
            "/notes/client-a"
        );
        assert_eq!(
            state
                .workspace_session("workspace-b")
                .expect("workspace B session")
                .notes_folder,
            "/notes/client-b"
        );

        state.remove_workspace_session("workspace-a");

        assert!(state.workspace_session("workspace-a").is_none());
        assert!(state.workspace_session("workspace-b").is_some());
    }

    #[test]
    fn windows_on_the_same_workspace_share_one_runtime_until_the_last_close() {
        let state = AppState::default();
        state.register_workspace_session(
            "workspace-a",
            WorkspaceSession::empty("/notes/shared".to_string()),
        );
        state.register_workspace_session(
            "workspace-b",
            WorkspaceSession::empty("/notes/shared".to_string()),
        );

        let first = state
            .workspace_session("workspace-a")
            .expect("first window session");
        let second = state
            .workspace_session("workspace-b")
            .expect("second window session");
        assert!(std::sync::Arc::ptr_eq(&first, &second));
        assert_eq!(state.workspace_session_count(), 1);

        state.remove_workspace_session("workspace-a");
        assert!(state.workspace_session("workspace-b").is_some());
        assert_eq!(state.workspace_session_count(), 1);

        state.remove_workspace_session("workspace-b");
        assert_eq!(state.workspace_session_count(), 0);
    }

    #[test]
    fn twenty_windows_share_one_runtime_and_release_it_after_the_last_close() {
        let state = AppState::default();
        for index in 0..20 {
            state.register_workspace_session(
                format!("workspace-{index}"),
                WorkspaceSession::empty("/notes/shared".to_string()),
            );
        }

        assert_eq!(state.workspace_session_count(), 1);
        for index in 0..19 {
            state.remove_workspace_session(&format!("workspace-{index}"));
            assert_eq!(state.workspace_session_count(), 1);
        }
        state.remove_workspace_session("workspace-19");
        assert_eq!(state.workspace_session_count(), 0);
    }

    #[test]
    fn main_and_secondary_window_share_the_same_canonical_runtime() {
        let state = AppState::default();
        let main_session = state.register_workspace_session(
            "main",
            WorkspaceSession::empty("/notes/shared".to_string()),
        );
        let copy_session = state
            .bind_existing_workspace_session("workspace-copy", "/notes/shared")
            .expect("bind second window to main workspace");

        let main_runtime = state
            .workspace_for_window("main")
            .expect("main runtime");
        let copy_runtime = state
            .workspace_for_window("workspace-copy")
            .expect("copy runtime");
        let (WorkspaceRuntime::Session(main_from_router), WorkspaceRuntime::Session(copy_from_router)) =
            (main_runtime, copy_runtime)
        else {
            panic!("all full editor windows must route through canonical sessions");
        };

        assert!(std::sync::Arc::ptr_eq(&main_session, &copy_session));
        assert!(std::sync::Arc::ptr_eq(
            &main_from_router,
            &copy_from_router,
        ));
        assert_eq!(state.workspace_session_count(), 1);
    }

    #[test]
    fn rebinding_the_last_window_releases_its_previous_runtime() {
        let state = AppState::default();
        state.register_workspace_session(
            "workspace-window",
            WorkspaceSession::empty("/notes/old".to_string()),
        );

        state.register_workspace_session(
            "workspace-window",
            WorkspaceSession::empty("/notes/new".to_string()),
        );

        assert!(state.workspace_session_for_path("/notes/old").is_none());
        assert!(state.workspace_session_for_path("/notes/new").is_some());
        assert_eq!(state.workspace_session_count(), 1);
    }

    #[test]
    fn workspace_resolution_uses_main_default_and_additional_session_roots() {
        let state = AppState::default();
        state
            .app_config
            .write()
            .expect("app config write lock")
            .notes_folder = Some("/notes/main".to_string());
        state.register_workspace_session(
            "workspace-client",
            WorkspaceSession::empty("/notes/client".to_string()),
        );

        let main = state
            .workspace_for_window("main")
            .expect("main workspace should resolve");
        let client = state
            .workspace_for_window("workspace-client")
            .expect("client workspace should resolve");

        assert_eq!(main.notes_folder().unwrap(), "/notes/main");
        assert_eq!(client.notes_folder().unwrap(), "/notes/client");
        assert!(state.workspace_for_window("missing-window").is_err());
    }

    #[test]
    fn main_window_binding_can_change_without_mutating_the_default_workspace() {
        let state = AppState::default();
        state
            .app_config
            .write()
            .expect("app config write lock")
            .notes_folder = Some("/notes/default".to_string());
        state
            .workspace_bindings
            .write()
            .expect("workspace bindings write lock")
            .bind("main", "/notes/client");

        let main = state
            .workspace_for_window("main")
            .expect("main workspace should resolve from its current binding");

        assert_eq!(main.notes_folder().unwrap(), "/notes/client");
        assert_eq!(
            state
                .app_config
                .read()
                .expect("app config read lock")
                .notes_folder
                .as_deref(),
            Some("/notes/default")
        );
    }

    #[test]
    fn workspace_resolution_isolates_same_relative_note_path() {
        let state = AppState::default();
        state
            .app_config
            .write()
            .expect("app config write lock")
            .notes_folder = Some("/notes/main".to_string());
        state.register_workspace_session(
            "workspace-client",
            WorkspaceSession::empty("/notes/client".to_string()),
        );

        let main_root = state
            .workspace_for_window("main")
            .unwrap()
            .note_path("shared")
            .unwrap();
        let client_root = state
            .workspace_for_window("workspace-client")
            .unwrap()
            .note_path("shared")
            .unwrap();

        assert_eq!(main_root, Path::new("/notes/main/shared.md"));
        assert_eq!(client_root, Path::new("/notes/client/shared.md"));
        assert_ne!(main_root, client_root);
    }

    #[test]
    fn workspace_infos_identify_current_default_and_open_windows() {
        let config = AppConfig {
            notes_folder: Some("/notes/main".to_string()),
            workspaces: vec![
                "/notes/main".to_string(),
                "/notes/client".to_string(),
                "/notes/archive".to_string(),
            ],
            global_settings: None,
            records: Default::default(),
        };
        let mut bindings = WorkspaceBindings::default();
        bindings.bind("main", "/notes/main");
        bindings.bind("workspace-client", "/notes/client");

        let infos = build_workspace_infos(&config, &bindings, "workspace-client");

        assert_eq!(infos.len(), 3);
        assert_eq!(infos[0].name, "main");
        assert!(infos[0].is_default);
        assert!(infos[0].is_open);
        assert!(!infos[0].is_current);
        assert_eq!(infos[1].name, "client");
        assert!(!infos[1].is_default);
        assert!(infos[1].is_open);
        assert!(infos[1].is_current);
        assert_eq!(infos[2].name, "archive");
        assert!(!infos[2].is_open);
        assert!(!infos[2].is_current);
    }

    #[test]
    fn desktop_capability_uses_interceptable_close_without_force_destroy() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json"))
                .expect("desktop capability should deserialize");
        let windows = capability["windows"]
            .as_array()
            .expect("desktop capability windows");

        assert!(windows.iter().any(|window| window == "workspace-*"));

        let permissions = capability["permissions"]
            .as_array()
            .expect("desktop capability permissions");
        assert!(permissions
            .iter()
            .any(|permission| permission == "core:window:allow-close"));
        assert!(!permissions
            .iter()
            .any(|permission| permission == "core:window:allow-destroy"));
    }

    #[test]
    fn preferences_window_has_titlebar_dragging_capability() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json"))
                .expect("desktop capability should deserialize");
        let windows = capability["windows"]
            .as_array()
            .expect("desktop capability windows");
        let permissions = capability["permissions"]
            .as_array()
            .expect("desktop capability permissions");

        assert!(
            windows.iter().any(|window| window == "preferences"),
            "the dedicated Preferences window must receive the drag permission"
        );
        assert!(permissions
            .iter()
            .any(|permission| permission == "core:window:allow-start-dragging"));
    }

    #[test]
    fn same_note_id_saves_to_each_workspace_without_cross_talk() {
        let root = std::env::temp_dir().join(format!(
            "scratch-workspace-save-test-{}",
            std::process::id()
        ));
        let alpha_root = root.join("alpha");
        let beta_root = root.join("beta");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&alpha_root).expect("create alpha workspace");
        std::fs::create_dir_all(&beta_root).expect("create beta workspace");
        let initial = "# shared\n\nInitial.\n";
        std::fs::write(alpha_root.join("shared.md"), initial).expect("seed alpha note");
        std::fs::write(beta_root.join("shared.md"), initial).expect("seed beta note");
        let initial_revision = super::persistence::content_revision(initial).to_string();

        let state = AppState::default();
        state.register_workspace_session(
            "workspace-alpha",
            WorkspaceSession::empty(alpha_root.to_string_lossy().into_owned()),
        );
        state.register_workspace_session(
            "workspace-beta",
            WorkspaceSession::empty(beta_root.to_string_lossy().into_owned()),
        );

        tauri::async_runtime::block_on(async {
            let alpha = state.workspace_for_window("workspace-alpha").unwrap();
            save_note_in_workspace(
                Some("shared".to_string()),
                "# shared\n\nAlpha window edit.\n".to_string(),
                Some(initial_revision.clone()),
                &alpha,
            )
            .await
            .expect("save alpha note");

            let beta = state.workspace_for_window("workspace-beta").unwrap();
            save_note_in_workspace(
                Some("shared".to_string()),
                "# shared\n\nBeta window edit.\n".to_string(),
                Some(initial_revision),
                &beta,
            )
            .await
            .expect("save beta note");
        });

        assert_eq!(
            std::fs::read_to_string(alpha_root.join("shared.md")).unwrap(),
            "# shared\n\nAlpha window edit.\n"
        );
        assert_eq!(
            std::fs::read_to_string(beta_root.join("shared.md")).unwrap(),
            "# shared\n\nBeta window edit.\n"
        );

        std::fs::remove_dir_all(root).expect("remove workspace save test");
    }

    #[test]
    fn create_note_persists_content_with_create_only_loop() {
        let root = std::env::temp_dir().join(format!(
            "scratch-create-note-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create test root");

        let folder = root.to_string_lossy().into_owned();
        let folder_path = PathBuf::from(&folder);
        let sanitized = "Untitled".to_string();
        let file_path = abs_path_from_id(&folder_path, &sanitized).expect("resolve note path");

        std::fs::create_dir_all(file_path.parent().expect("note has parent"))
            .expect("create parent dirs");

        let content = "# Untitled\n\n";
        let result = persistence::save_if_revision(&file_path, &content, None)
            .expect("atomic create succeeds");
        assert!(matches!(result, persistence::SaveResult::Saved { .. }));
        assert!(file_path.exists());
        assert_eq!(std::fs::read_to_string(&file_path).unwrap(), content);

        std::fs::remove_dir_all(root).expect("cleanup create note test");
    }

    #[test]
    fn create_note_retries_on_create_conflict() {
        let root = std::env::temp_dir().join(format!(
            "scratch-create-conflict-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create test root");

        let folder = root.to_string_lossy().into_owned();
        let folder_path = PathBuf::from(&folder);
        let sanitized = "Untitled".to_string();
        let file_path = abs_path_from_id(&folder_path, &sanitized).expect("resolve note path");

        std::fs::create_dir_all(file_path.parent().expect("note has parent"))
            .expect("create parent dirs");

        std::fs::write(&file_path, "existing content").expect("seed existing file");

        let content = "# Untitled\n\n";
        let result = persistence::save_if_revision(&file_path, &content, None)
            .expect("conflict is typed");
        assert!(matches!(result, persistence::SaveResult::Conflict { .. }));
        assert_eq!(std::fs::read_to_string(&file_path).unwrap(), "existing content");

        std::fs::remove_dir_all(root).expect("cleanup create conflict test");
    }
}
