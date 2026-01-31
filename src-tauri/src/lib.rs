use anyhow::Result;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::*;
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::fs;

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

// App settings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    pub notes_folder: Option<String>,
    pub theme: String,
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
                if file_path.extension().map_or(false, |ext| ext == "md") {
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
    pub settings: RwLock<Settings>,
    pub notes_cache: RwLock<HashMap<String, NoteMetadata>>,
    pub file_watcher: Mutex<Option<FileWatcherState>>,
    pub search_index: Mutex<Option<SearchIndex>>,
    pub debounce_map: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: RwLock::new(Settings {
                notes_folder: None,
                theme: "system".to_string(),
            }),
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

// Utility: Generate preview from content
fn generate_preview(content: &str) -> String {
    for line in content.lines().skip(1) {
        let trimmed = line.trim();
        if !trimmed.is_empty() && !trimmed.starts_with('#') {
            return trimmed.chars().take(100).collect();
        }
    }
    String::new()
}

// Get settings file path
fn get_settings_path(app: &AppHandle) -> Result<PathBuf> {
    let app_data = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_data)?;
    Ok(app_data.join("settings.json"))
}

// Get search index path
fn get_search_index_path(app: &AppHandle) -> Result<PathBuf> {
    let app_data = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_data)?;
    Ok(app_data.join("search_index"))
}

// Load settings from disk
fn load_settings(app: &AppHandle) -> Settings {
    let path = match get_settings_path(app) {
        Ok(p) => p,
        Err(_) => return Settings::default(),
    };

    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    } else {
        Settings::default()
    }
}

// Save settings to disk
fn save_settings(app: &AppHandle, settings: &Settings) -> Result<()> {
    let path = get_settings_path(app)?;
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

// TAURI COMMANDS

#[tauri::command]
fn get_notes_folder(state: State<AppState>) -> Option<String> {
    state
        .settings
        .read()
        .expect("settings read lock")
        .notes_folder
        .clone()
}

#[tauri::command]
fn set_notes_folder(app: AppHandle, path: String, state: State<AppState>) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    // Verify it's a valid directory
    if !path_buf.exists() {
        std::fs::create_dir_all(&path_buf).map_err(|e| e.to_string())?;
    }

    // Create assets folder
    let assets = path_buf.join("assets");
    std::fs::create_dir_all(&assets).map_err(|e| e.to_string())?;

    // Update settings
    {
        let mut settings = state.settings.write().expect("settings write lock");
        settings.notes_folder = Some(path.clone());
    }

    // Save to disk
    {
        let settings = state.settings.read().expect("settings read lock");
        save_settings(&app, &settings).map_err(|e| e.to_string())?;
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
        let settings = state.settings.read().expect("settings read lock");
        settings
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
        if file_path.extension().map_or(false, |ext| ext == "md") {
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

    // Sort by modified date, newest first
    notes.sort_by(|a, b| b.modified.cmp(&a.modified));

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
        let settings = state.settings.read().expect("settings read lock");
        settings
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
        let settings = state.settings.read().expect("settings read lock");
        settings
            .notes_folder
            .clone()
            .ok_or("Notes folder not set")?
    };
    let folder_path = PathBuf::from(&folder);

    let title = extract_title(&content);

    // Determine the file ID and path
    let (note_id, file_path) = if let Some(existing_id) = id {
        (
            existing_id.clone(),
            folder_path.join(format!("{}.md", existing_id)),
        )
    } else {
        // Generate new ID from title
        let base_id = sanitize_filename(&title);
        let mut final_id = base_id.clone();
        let mut counter = 1;

        while folder_path.join(format!("{}.md", final_id)).exists() {
            final_id = format!("{}-{}", base_id, counter);
            counter += 1;
        }

        (final_id.clone(), folder_path.join(format!("{}.md", final_id)))
    };

    // Write the file
    fs::write(&file_path, &content)
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

    // Update search index
    {
        let index = state.search_index.lock().expect("search index mutex");
        if let Some(ref search_index) = *index {
            let _ = search_index.index_note(&note_id, &title, &content, modified);
        }
    }

    Ok(Note {
        id: note_id,
        title,
        content,
        path: file_path.to_string_lossy().into_owned(),
        modified,
    })
}

#[tauri::command]
async fn delete_note(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = {
        let settings = state.settings.read().expect("settings read lock");
        settings
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
        let settings = state.settings.read().expect("settings read lock");
        settings
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
    app: AppHandle,
    new_settings: Settings,
    state: State<AppState>,
) -> Result<(), String> {
    {
        let mut settings = state.settings.write().expect("settings write lock");
        *settings = new_settings;
    }

    let settings = state.settings.read().expect("settings read lock");
    save_settings(&app, &settings).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn search_notes(query: String, state: State<AppState>) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let index = state.search_index.lock().expect("search index mutex");
    if let Some(ref search_index) = *index {
        search_index.search(&query, 20).map_err(|e| e.to_string())
    } else {
        // Fallback to simple search if index not available
        fallback_search(&query, &state)
    }
}

// Fallback search when Tantivy index isn't available
fn fallback_search(query: &str, state: &State<AppState>) -> Result<Vec<SearchResult>, String> {
    let cache = state.notes_cache.read().expect("cache read lock");
    let query_lower = query.to_lowercase();

    let mut results: Vec<SearchResult> = cache
        .values()
        .filter_map(|note| {
            let title_lower = note.title.to_lowercase();
            let preview_lower = note.preview.to_lowercase();

            let mut score = 0.0f32;
            if title_lower.contains(&query_lower) {
                score += 50.0;
            }
            if preview_lower.contains(&query_lower) {
                score += 10.0;
            }

            if score > 0.0 {
                Some(SearchResult {
                    id: note.id.clone(),
                    title: note.title.clone(),
                    preview: note.preview.clone(),
                    modified: note.modified,
                    score,
                })
            } else {
                None
            }
        })
        .collect();

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(20);

    Ok(results)
}

// File watcher event payload
#[derive(Clone, Serialize)]
struct FileChangeEvent {
    kind: String,
    path: String,
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
                    if path.extension().map_or(false, |ext| ext == "md") {
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

                        let _ = app_handle.emit(
                            "file-change",
                            FileChangeEvent {
                                kind: kind.to_string(),
                                path: path.to_string_lossy().into_owned(),
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
    watcher
        .watch(&folder_path, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    Ok(FileWatcherState { watcher })
}

#[tauri::command]
fn start_file_watcher(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let folder = {
        let settings = state.settings.read().expect("settings read lock");
        settings
            .notes_folder
            .clone()
            .ok_or("Notes folder not set")?
    };

    // Clean up debounce map before starting
    cleanup_debounce_map(&state.debounce_map);

    let watcher_state = setup_file_watcher(app, &folder, Arc::clone(&state.debounce_map))?;

    let mut file_watcher = state.file_watcher.lock().expect("file watcher mutex");
    *file_watcher = Some(watcher_state);

    Ok(())
}

#[tauri::command]
fn rebuild_search_index(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let folder = {
        let settings = state.settings.read().expect("settings read lock");
        settings
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Load settings on startup
            let settings = load_settings(app.handle());

            // Initialize search index if notes folder is set
            let search_index = if let Some(ref folder) = settings.notes_folder {
                if let Ok(index_path) = get_search_index_path(app.handle()) {
                    SearchIndex::new(&index_path)
                        .ok()
                        .map(|idx| {
                            let _ = idx.rebuild_index(&PathBuf::from(folder));
                            idx
                        })
                } else {
                    None
                }
            } else {
                None
            };

            let state = AppState {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
