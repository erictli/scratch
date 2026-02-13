use anyhow::Result;
use base64::Engine;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::*;
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio::fs;

mod git;

// Note metadata for list display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMetadata {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub modified: i64,
}

// Full note content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub path: String,
    pub modified: i64,
}

// Theme color customization
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EditorFontSettings {
    pub base_font_family: Option<String>, // "system-sans" | "serif" | "monospace"
    pub base_font_size: Option<f32>,      // in px, default 16
    pub bold_weight: Option<i32>,         // 600, 700, 800 for headings and bold
    pub line_height: Option<f32>,         // default 1.6
}

// App config (stored in app data directory - just the notes folder path)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub notes_folder: Option<String>,
}

// Per-folder settings (stored in .scratch/settings.json within notes folder)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    pub theme: ThemeSettings,
    #[serde(rename = "editorFont")]
    pub editor_font: Option<EditorFontSettings>,
    #[serde(rename = "gitEnabled")]
    pub git_enabled: Option<bool>,
    #[serde(rename = "pinnedNoteIds")]
    pub pinned_note_ids: Option<Vec<String>>,
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

    fn rebuild_index(&self, notes_folder: &PathBuf) -> Result<()> {
        let mut writer = self.writer.lock().expect("search writer mutex");
        writer.delete_all_documents()?;

        if notes_folder.exists() {
            for entry in std::fs::read_dir(notes_folder)?.flatten() {
                let file_path = entry.path();
                if file_path.extension().is_some_and(|ext| ext == "md") {
                    if let Ok(content) = std::fs::read_to_string(&file_path) {
                        let metadata = entry.metadata()?;
                        let modified = metadata
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0);

                        let id = file_path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("unknown");

                        let title = extract_title(&content);

                        writer.add_document(doc!(
                            self.id_field => id,
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

// App state with improved structure
pub struct AppState {
    pub app_config: RwLock<AppConfig>,  // notes_folder path (stored in app data)
    pub settings: RwLock<Settings>,      // per-folder settings (stored in .scratch/)
    pub notes_cache: RwLock<HashMap<String, NoteMetadata>>,
    pub file_watcher: Mutex<Option<FileWatcherState>>,
    pub search_index: Mutex<Option<SearchIndex>>,
    pub debounce_map: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            app_config: RwLock::new(AppConfig::default()),
            settings: RwLock::new(Settings::default()),
            notes_cache: RwLock::new(HashMap::new()),
            file_watcher: Mutex::new(None),
            search_index: Mutex::new(None),
            debounce_map: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

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
        "untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

// Utility: Check if a string is effectively empty
fn is_effectively_empty(s: &str) -> bool {
    s.chars()
        .all(|c| c.is_whitespace() || c == '\u{00A0}' || c == '\u{FEFF}')
}

// Utility: Extract title from markdown content
fn extract_title(content: &str) -> String {
    for line in content.lines() {
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
    // Skip the first line (title), find first non-empty line
    for line in content.lines().skip(1) {
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

// Get search index path
fn get_search_index_path(app: &AppHandle) -> Result<PathBuf> {
    let app_data = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_data)?;
    Ok(app_data.join("search_index"))
}

// Load app config from disk (notes folder path)
fn load_app_config(app: &AppHandle) -> AppConfig {
    let path = match get_app_config_path(app) {
        Ok(p) => p,
        Err(_) => return AppConfig::default(),
    };

    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    } else {
        AppConfig::default()
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
fn load_settings(notes_folder: &str) -> Settings {
    let path = get_settings_path(notes_folder);

    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    } else {
        Settings::default()
    }
}

// Save per-folder settings to disk
fn save_settings(notes_folder: &str, settings: &Settings) -> Result<()> {
    let path = get_settings_path(notes_folder);
    let content = serde_json::to_string_pretty(settings)?;
    std::fs::write(path, content)?;
    Ok(())
}

// Clean up old entries from debounce map (entries older than 5 seconds)
fn cleanup_debounce_map(map: &Mutex<HashMap<PathBuf, Instant>>) {
    let mut map = map.lock().expect("debounce map mutex");
    let now = Instant::now();
    map.retain(|_, last| now.duration_since(*last) < Duration::from_secs(5));
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

// TAURI COMMANDS

#[tauri::command]
fn get_notes_folder(state: State<AppState>) -> Option<String> {
    state
        .app_config
        .read()
        .expect("app_config read lock")
        .notes_folder
        .clone()
}

#[tauri::command]
fn set_notes_folder(app: AppHandle, path: String, state: State<AppState>) -> Result<(), String> {
    let path_buf = normalize_notes_folder_path(&path)?;
    let normalized_path = path_buf.to_string_lossy().into_owned();

    // Verify it's a valid directory
    if !path_buf.exists() {
        std::fs::create_dir_all(&path_buf).map_err(|e| e.to_string())?;
    }

    // Create assets folder
    let assets = path_buf.join("assets");
    std::fs::create_dir_all(&assets).map_err(|e| e.to_string())?;

    // Create .scratch config folder
    let scratch_dir = path_buf.join(".scratch");
    std::fs::create_dir_all(&scratch_dir).map_err(|e| e.to_string())?;

    // Verify write access early to avoid later silent failures
    let write_test_path = scratch_dir.join(".write-test");
    std::fs::write(&write_test_path, b"ok")
        .map_err(|e| format!("Notes folder is not writable: {}", e))?;
    let _ = std::fs::remove_file(&write_test_path);

    // Load per-folder settings (starts fresh with defaults if none exist)
    let settings = load_settings(&normalized_path);

    // Update app config
    {
        let mut app_config = state.app_config.write().expect("app_config write lock");
        app_config.notes_folder = Some(normalized_path.clone());
    }

    // Update settings in memory
    {
        let mut current_settings = state.settings.write().expect("settings write lock");
        *current_settings = settings;
    }

    // Save app config to disk
    {
        let app_config = state.app_config.read().expect("app_config read lock");
        save_app_config(&app, &app_config).map_err(|e| e.to_string())?;
    }

    // Initialize search index
    if let Ok(index_path) = get_search_index_path(&app) {
        if let Ok(search_index) = SearchIndex::new(&index_path) {
            let _ = search_index.rebuild_index(&path_buf);
            let mut index = state.search_index.lock().expect("search index mutex");
            *index = Some(search_index);
        }
    }

    Ok(())
}

#[tauri::command]
async fn list_notes(state: State<'_, AppState>) -> Result<Vec<NoteMetadata>, String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config
            .notes_folder
            .clone()
            .ok_or("Notes folder not set")?
    };

    let path = PathBuf::from(&folder);
    if !path.exists() {
        return Ok(vec![]);
    }

    let mut notes: Vec<NoteMetadata> = Vec::new();

    // Use tokio for async file reading
    let mut entries = fs::read_dir(&path).await.map_err(|e| e.to_string())?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let file_path = entry.path();
        if file_path.extension().is_some_and(|ext| ext == "md") {
            // Get metadata first (single syscall)
            if let Ok(metadata) = entry.metadata().await {
                if let Ok(content) = fs::read_to_string(&file_path).await {
                    let modified = metadata
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);

                    let id = file_path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("unknown")
                        .to_string();

                    notes.push(NoteMetadata {
                        id,
                        title: extract_title(&content),
                        preview: generate_preview(&content),
                        modified,
                    });
                }
            }
        }
    }

    // Load pinned note IDs from settings
    let pinned_ids: HashSet<String> = {
        let settings = state.settings.read().expect("settings read lock");
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
        let mut cache = state.notes_cache.write().expect("cache write lock");
        cache.clear();
        for note in &notes {
            cache.insert(note.id.clone(), note.clone());
        }
    }

    Ok(notes)
}

#[tauri::command]
async fn read_note(id: String, state: State<'_, AppState>) -> Result<Note, String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config
            .notes_folder
            .clone()
            .ok_or("Notes folder not set")?
    };

    let file_path = PathBuf::from(&folder).join(format!("{}.md", id));
    if !file_path.exists() {
        return Err("Note not found".to_string());
    }

    let content = fs::read_to_string(&file_path)
        .await
        .map_err(|e| e.to_string())?;
    let metadata = fs::metadata(&file_path)
        .await
        .map_err(|e| e.to_string())?;

    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    Ok(Note {
        id,
        title: extract_title(&content),
        content,
        path: file_path.to_string_lossy().into_owned(),
        modified,
    })
}

#[tauri::command]
async fn save_note(
    id: Option<String>,
    content: String,
    state: State<'_, AppState>,
) -> Result<Note, String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config
            .notes_folder
            .clone()
            .ok_or("Notes folder not set")?
    };
    let folder_path = PathBuf::from(&folder);

    let title = extract_title(&content);
    let desired_id = sanitize_filename(&title);

    // Determine the file ID and path, handling renames
    let (final_id, file_path, old_id) = if let Some(existing_id) = id {
        let old_file_path = folder_path.join(format!("{}.md", existing_id));

        // Check if we should rename the file
        if existing_id != desired_id {
            // Find a unique name for the new ID
            let mut new_id = desired_id.clone();
            let mut counter = 1;

            while new_id != existing_id && folder_path.join(format!("{}.md", new_id)).exists() {
                new_id = format!("{}-{}", desired_id, counter);
                counter += 1;
            }

            let new_file_path = folder_path.join(format!("{}.md", new_id));
            // Track old_file_path for cleanup after successful write
            (new_id, new_file_path, Some((existing_id, old_file_path)))
        } else {
            (existing_id, old_file_path, None)
        }
    } else {
        // New note - generate unique ID from title
        let mut new_id = desired_id.clone();
        let mut counter = 1;

        while folder_path.join(format!("{}.md", new_id)).exists() {
            new_id = format!("{}-{}", desired_id, counter);
            counter += 1;
        }

        (new_id.clone(), folder_path.join(format!("{}.md", new_id)), None)
    };

    // Write the file to the new path
    fs::write(&file_path, &content)
        .await
        .map_err(|e| e.to_string())?;

    // Delete old file AFTER successful write (to prevent data loss)
    if let Some((_, ref old_file_path)) = old_id {
        if old_file_path.exists() && *old_file_path != file_path {
            let _ = fs::remove_file(old_file_path).await;
        }
    }

    let metadata = fs::metadata(&file_path)
        .await
        .map_err(|e| e.to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Update search index (delete old entry if renamed, then add new)
    {
        let index = state.search_index.lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            if let Some((ref old_id_str, _)) = old_id {
                let _ = search_index.delete_note(old_id_str);
            }
            let _ = search_index.index_note(&final_id, &title, &content, modified);
        }
    }

    // Update cache (remove old entry if renamed)
    if let Some((ref old_id_str, _)) = old_id {
        let mut cache = state.notes_cache.write().expect("cache write lock");
        cache.remove(old_id_str);
    }

    Ok(Note {
        id: final_id,
        title,
        content,
        path: file_path.to_string_lossy().into_owned(),
        modified,
    })
}

#[tauri::command]
async fn delete_note(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config
            .notes_folder
            .clone()
            .ok_or("Notes folder not set")?
    };

    let file_path = PathBuf::from(&folder).join(format!("{}.md", id));
    if file_path.exists() {
        fs::remove_file(&file_path)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Update search index
    {
        let index = state.search_index.lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            let _ = search_index.delete_note(&id);
        }
    }

    // Remove from cache
    {
        let mut cache = state.notes_cache.write().expect("cache write lock");
        cache.remove(&id);
    }

    Ok(())
}

#[tauri::command]
async fn create_note(state: State<'_, AppState>) -> Result<Note, String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config
            .notes_folder
            .clone()
            .ok_or("Notes folder not set")?
    };
    let folder_path = PathBuf::from(&folder);

    // Generate unique ID
    let base_id = "untitled";
    let mut final_id = base_id.to_string();
    let mut counter = 1;

    while folder_path.join(format!("{}.md", final_id)).exists() {
        final_id = format!("{}-{}", base_id, counter);
        counter += 1;
    }

    let content = "# Untitled\n\n".to_string();
    let file_path = folder_path.join(format!("{}.md", &final_id));

    fs::write(&file_path, &content)
        .await
        .map_err(|e| e.to_string())?;

    let modified = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Update search index
    {
        let index = state.search_index.lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            let _ = search_index.index_note(&final_id, "Untitled", &content, modified);
        }
    }

    Ok(Note {
        id: final_id,
        title: "Untitled".to_string(),
        content,
        path: file_path.to_string_lossy().into_owned(),
        modified,
    })
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings.read().expect("settings read lock").clone()
}

#[tauri::command]
fn update_settings(
    new_settings: Settings,
    state: State<AppState>,
) -> Result<(), String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config.notes_folder.clone().ok_or("Notes folder not set")?
    };

    {
        let mut settings = state.settings.write().expect("settings write lock");
        *settings = new_settings;
    }

    let settings = state.settings.read().expect("settings read lock");
    save_settings(&folder, &settings).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn search_notes(query: String, state: State<'_, AppState>) -> Result<Vec<SearchResult>, String> {
    let trimmed_query = query.trim().to_string();
    if trimmed_query.is_empty() {
        return Ok(vec![]);
    }

    // Check if search index is available and use it (scoped to drop lock before await)
    let indexed_result = {
        let index = state.search_index.lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            Some(search_index.search(&trimmed_query, 20).map_err(|e| e.to_string()))
        } else {
            None
        }
    };

    match indexed_result {
        Some(Ok(results)) if !results.is_empty() => Ok(results),
        Some(Ok(_)) => {
            // Tantivy can miss partial/fuzzy matches; fall back to substring search.
            fallback_search(&trimmed_query, &state).await
        }
        Some(Err(e)) => Err(e),
        None => {
            // Fallback to simple search if index not available
            fallback_search(&trimmed_query, &state).await
        }
    }
}

// Fallback search when Tantivy index isn't available - searches title and full content
async fn fallback_search(query: &str, state: &State<'_, AppState>) -> Result<Vec<SearchResult>, String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config.notes_folder.clone()
    };

    let folder = match folder {
        Some(f) => f,
        None => return Ok(vec![]),
    };

    // Collect cache data upfront to avoid holding lock during async operations
    let cache_data: Vec<(String, String, String, i64)> = {
        let cache = state.notes_cache.read().expect("cache read lock");
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

    let query_lower = query.to_lowercase();
    let mut results: Vec<SearchResult> = Vec::new();

    for (id, title, preview, modified) in cache_data {
        let title_lower = title.to_lowercase();

        let mut score = 0.0f32;
        if title_lower.contains(&query_lower) {
            score += 50.0;
        }

        // Read file content asynchronously and search in it
        let file_path = PathBuf::from(&folder).join(format!("{}.md", &id));
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
#[derive(Clone, Serialize)]
struct FileChangeEvent {
    kind: String,
    path: String,
    changed_ids: Vec<String>,
}

fn setup_file_watcher(
    app: AppHandle,
    notes_folder: &str,
    debounce_map: Arc<Mutex<HashMap<PathBuf, Instant>>>,
) -> Result<FileWatcherState, String> {
    let folder_path = PathBuf::from(notes_folder);
    let app_handle = app.clone();

    let watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                for path in event.paths.iter() {
                    // Handle .md files
                    if path.extension().is_some_and(|ext| ext == "md") {
                        // Debounce with cleanup
                        {
                            let mut map = debounce_map.lock().expect("debounce map mutex");
                            let now = Instant::now();

                            // Clean up old entries periodically
                            if map.len() > 100 {
                                map.retain(|_, last| now.duration_since(*last) < Duration::from_secs(5));
                            }

                            if let Some(last) = map.get(path) {
                                if now.duration_since(*last) < Duration::from_millis(500) {
                                    continue;
                                }
                            }
                            map.insert(path.clone(), now);
                        }

                        let kind = match event.kind {
                            notify::EventKind::Create(_) => "created",
                            notify::EventKind::Modify(_) => "modified",
                            notify::EventKind::Remove(_) => "deleted",
                            _ => continue,
                        };

                        // Extract note ID from filename
                        let note_id = path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .map(|s| s.to_string())
                            .unwrap_or_default();

                        // Update search index for external file changes
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            let index = state.search_index.lock().expect("search index mutex");
                            if let Some(ref search_index) = *index {
                                match kind {
                                    "created" | "modified" => {
                                        // Read file and index it
                                        if let Ok(content) = std::fs::read_to_string(path) {
                                            let title = extract_title(&content);
                                            let modified = std::fs::metadata(path)
                                                .ok()
                                                .and_then(|m| m.modified().ok())
                                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                                .map(|d| d.as_secs() as i64)
                                                .unwrap_or(0);
                                            let _ = search_index.index_note(&note_id, &title, &content, modified);
                                        }
                                    }
                                    "deleted" => {
                                        let _ = search_index.delete_note(&note_id);
                                    }
                                    _ => {}
                                }
                            }
                        }

                        let _ = app_handle.emit(
                            "file-change",
                            FileChangeEvent {
                                kind: kind.to_string(),
                                path: path.to_string_lossy().into_owned(),
                                changed_ids: vec![note_id.clone()],
                            },
                        );
                    }
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    let mut watcher = watcher;

    // Watch the notes folder for .md files
    watcher
        .watch(&folder_path, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    Ok(FileWatcherState { watcher })
}

#[tauri::command]
fn start_file_watcher(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config
            .notes_folder
            .clone()
            .ok_or("Notes folder not set")?
    };

    // Clean up debounce map before starting
    cleanup_debounce_map(&state.debounce_map);

    let watcher_state = setup_file_watcher(
        app,
        &folder,
        Arc::clone(&state.debounce_map),
    )?;

    let mut file_watcher = state.file_watcher.lock().expect("file watcher mutex");
    *file_watcher = Some(watcher_state);

    Ok(())
}

#[tauri::command]
fn copy_to_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_clipboard_image(
    base64_data: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Guard against empty clipboard payload
    if base64_data.trim().is_empty() {
        return Err("Clipboard data is empty".to_string());
    }

    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config
            .notes_folder
            .clone()
            .ok_or("Notes folder not set")?
    };

    // Decode base64
    let image_data = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

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
        .map_err(|e| format!("Failed to write image: {}", e))?;

    // Return relative path
    Ok(format!("assets/{}", target_name))
}

#[tauri::command]
async fn copy_image_to_assets(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config
            .notes_folder
            .clone()
            .ok_or("Notes folder not set")?
    };

    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err("Source image file does not exist".to_string());
    }

    // Get file extension
    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .ok_or("Invalid file extension")?;

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
        .map_err(|e| format!("Failed to copy image: {}", e))?;

    // Return both relative path and filename for frontend to construct the URL
    Ok(format!("assets/{}", target_name))
}

#[tauri::command]
fn rebuild_search_index(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config
            .notes_folder
            .clone()
            .ok_or("Notes folder not set")?
    };

    let index_path = get_search_index_path(&app).map_err(|e| e.to_string())?;

    // Create new index
    let search_index = SearchIndex::new(&index_path).map_err(|e| e.to_string())?;
    search_index
        .rebuild_index(&PathBuf::from(&folder))
        .map_err(|e| e.to_string())?;

    let mut index = state.search_index.lock().expect("search index mutex");
    *index = Some(search_index);

    Ok(())
}

// UI helper commands - wrap Tauri plugins for consistent invoke-based API

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
async fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err("Path does not exist".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        // Windows explorer /select requires backslashes
        let windows_path = path.replace("/", "\\");
        std::process::Command::new("explorer")
            .args(["/select,", &windows_path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: open containing directory (most file managers don't support selecting)
        let parent = path_buf
            .parent()
            .ok_or_else(|| "Cannot determine parent directory".to_string())?;
        let parent_str = parent
            .to_str()
            .ok_or_else(|| "Path contains invalid UTF-8".to_string())?;
        std::process::Command::new("xdg-open")
            .arg(parent_str)
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
async fn git_get_status(state: State<'_, AppState>) -> Result<git::GitStatus, String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config.notes_folder.clone()
    };

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
async fn git_init_repo(state: State<'_, AppState>) -> Result<(), String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config.notes_folder.clone().ok_or("Notes folder not set")?
    };

    tauri::async_runtime::spawn_blocking(move || {
        git::git_init(&PathBuf::from(folder))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_commit(message: String, state: State<'_, AppState>) -> Result<git::GitResult, String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config.notes_folder.clone()
    };

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
async fn git_push(state: State<'_, AppState>) -> Result<git::GitResult, String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config.notes_folder.clone()
    };

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
async fn git_add_remote(url: String, state: State<'_, AppState>) -> Result<git::GitResult, String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config.notes_folder.clone()
    };

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
async fn git_push_with_upstream(state: State<'_, AppState>) -> Result<git::GitResult, String> {
    let folder = {
        let app_config = state.app_config.read().expect("app_config read lock");
        app_config.notes_folder.clone()
    };

    match folder {
        Some(path) => {
            tauri::async_runtime::spawn_blocking(move || {
                // Get current branch first
                let status = git::get_status(&PathBuf::from(&path));
                match status.current_branch {
                    Some(branch) => git::push_with_upstream(&PathBuf::from(&path), &branch),
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

    // Common locations for node-installed CLIs (nvm, volta, fnm, homebrew, global npm)
    let candidate_dirs = vec![
        format!("{home}/.nvm/versions/node"),
        format!("{home}/.fnm/node-versions"),
    ];
    let static_dirs = vec![
        format!("{home}/.volta/bin"),
        format!("{home}/.local/bin"),
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
    ];

    let mut expanded = Vec::new();

    // For nvm/fnm, scan for node version dirs containing a bin/ folder
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

    for dir in static_dirs {
        expanded.push(dir);
    }

    expanded.push(system_path);
    expanded.join(":")
}

#[tauri::command]
async fn ai_check_claude_cli() -> Result<bool, String> {
    use std::process::Command;

    let path = get_expanded_path();
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let check_output = Command::new(which_cmd)
        .arg("claude")
        .env("PATH", &path)
        .output()
        .map_err(|e| format!("Failed to check for claude CLI: {}", e))?;

    Ok(check_output.status.success())
}

// AI execute command
#[tauri::command]
async fn ai_execute_claude(
    file_path: String,
    prompt: String,
) -> Result<AiExecutionResult, String> {
    use std::process::{Child, Command, Stdio};
    use std::io::Write;

    // Check if claude CLI exists
    let path = get_expanded_path();
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let check_output = Command::new(which_cmd)
        .arg("claude")
        .env("PATH", &path)
        .output()
        .map_err(|e| format!("Failed to check for claude CLI: {}", e))?;

    if !check_output.status.success() {
        return Ok(AiExecutionResult {
            success: false,
            output: String::new(),
            error: Some(
                "Claude CLI not found. Please install it from https://claude.ai/code".to_string(),
            ),
        });
    }

    // Execute: echo "prompt" | claude <file> --permission-mode bypassPermissions --print
    let timeout_duration = std::time::Duration::from_secs(300); // 5 minute timeout
    let shared_child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let child_for_task = Arc::clone(&shared_child);
    let mut task = tauri::async_runtime::spawn_blocking(move || {
        let child = Command::new("claude")
            .env("PATH", &path)
            .arg(&file_path)
            .arg("--permission-mode")
            .arg("bypassPermissions")
            .arg("--print")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        match child {
            Ok(process) => {
                if let Ok(mut child_guard) = child_for_task.lock() {
                    *child_guard = Some(process);
                } else {
                    return AiExecutionResult {
                        success: false,
                        output: String::new(),
                        error: Some("Failed to lock claude child process handle".to_string()),
                    };
                }

                // Work with the process by taking it from the shared handle.
                let mut process = match child_for_task.lock() {
                    Ok(mut child_guard) => match child_guard.take() {
                        Some(process) => process,
                        None => {
                            return AiExecutionResult {
                                success: false,
                                output: String::new(),
                                error: Some("Claude process handle was unexpectedly missing".to_string()),
                            };
                        }
                    },
                    Err(_) => {
                        return AiExecutionResult {
                            success: false,
                            output: String::new(),
                            error: Some("Failed to lock claude child process handle".to_string()),
                        };
                    }
                };

                // Write prompt to stdin, surfacing errors
                if let Some(mut stdin) = process.stdin.take() {
                    if let Err(e) = stdin.write_all(prompt.as_bytes()) {
                        let _ = process.kill();
                        let _ = process.wait();
                        return AiExecutionResult {
                            success: false,
                            output: String::new(),
                            error: Some(format!("Failed to write prompt to claude stdin: {}", e)),
                        };
                    }
                } else {
                    let _ = process.kill();
                    let _ = process.wait();
                    return AiExecutionResult {
                        success: false,
                        output: String::new(),
                        error: Some("Failed to open stdin for claude process".to_string()),
                    };
                }

                // Wait for completion and get output
                match process.wait_with_output() {
                    Ok(output) => {
                        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

                        if output.status.success() {
                            AiExecutionResult {
                                success: true,
                                output: stdout,
                                error: None,
                            }
                        } else {
                            AiExecutionResult {
                                success: false,
                                output: stdout,
                                error: Some(stderr),
                            }
                        }
                    }
                    Err(e) => {
                        AiExecutionResult {
                            success: false,
                            output: String::new(),
                            error: Some(format!("Failed to wait for claude: {}", e)),
                        }
                    }
                }
            }
            Err(e) => {
                AiExecutionResult {
                    success: false,
                    output: String::new(),
                    error: Some(format!("Failed to execute claude: {}", e)),
                }
            }
        }
    });

    let result = match tokio::time::timeout(timeout_duration, &mut task).await {
        Ok(join_result) => {
            join_result.map_err(|e| format!("Failed to join Claude blocking task: {}", e))?
        }
        Err(_) => {
            if let Ok(mut child_guard) = shared_child.lock() {
                if let Some(mut process) = child_guard.take() {
                    let _ = process.kill();
                    let _ = process.wait();
                }
            }

            match tokio::time::timeout(std::time::Duration::from_secs(5), task).await {
                Ok(join_result) => {
                    if let Err(e) = join_result {
                        return Err(format!(
                            "Failed to join Claude blocking task after timeout: {}",
                            e
                        ));
                    }
                }
                Err(_) => {
                    return Err(
                        "Claude CLI timed out and failed to exit after kill signal".to_string()
                    );
                }
            }

            AiExecutionResult {
                success: false,
                output: String::new(),
                error: Some("Claude CLI timed out after 5 minutes".to_string()),
            }
        }
    };

    Ok(result)
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
                    Ok(_) => {
                        // Normalized path is not a valid directory; clear it
                        app_config.notes_folder = None;
                        let _ = save_app_config(app.handle(), &app_config);
                    }
                    Err(_) => {
                        app_config.notes_folder = None;
                        let _ = save_app_config(app.handle(), &app_config);
                    }
                }
            }

            // Load per-folder settings if notes folder is set
            let settings = if let Some(ref folder) = app_config.notes_folder {
                load_settings(folder)
            } else {
                Settings::default()
            };

            // Initialize search index if notes folder is set
            let search_index = if let Some(ref folder) = app_config.notes_folder {
                if let Ok(index_path) = get_search_index_path(app.handle()) {
                    SearchIndex::new(&index_path)
                        .ok()
                        .inspect(|idx| {
                            let _ = idx.rebuild_index(&PathBuf::from(folder));
                        })
                } else {
                    None
                }
            } else {
                None
            };

            let state = AppState {
                app_config: RwLock::new(app_config),
                settings: RwLock::new(settings),
                notes_cache: RwLock::new(HashMap::new()),
                file_watcher: Mutex::new(None),
                search_index: Mutex::new(search_index),
                debounce_map: Arc::new(Mutex::new(HashMap::new())),
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_notes_folder,
            set_notes_folder,
            list_notes,
            read_note,
            save_note,
            delete_note,
            create_note,
            get_settings,
            update_settings,
            search_notes,
            start_file_watcher,
            rebuild_search_index,
            copy_to_clipboard,
            copy_image_to_assets,
            save_clipboard_image,
            open_folder_dialog,
            reveal_in_file_manager,
            open_url_safe,
            git_is_available,
            git_get_status,
            git_init_repo,
            git_commit,
            git_push,
            git_add_remote,
            git_push_with_upstream,
            ai_check_claude_cli,
            ai_execute_claude,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
