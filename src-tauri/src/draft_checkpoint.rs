use crate::hashing::sha256_hex;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub const CHECKPOINT_DIRECTORY_NAME: &str = "draft-checkpoints";

static NEXT_TEMPORARY_FILE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftCheckpointKey {
    pub window_label: String,
    pub note_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftCheckpointMetadata {
    pub source_path: String,
    pub base_revision: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftCheckpoint {
    pub key: DraftCheckpointKey,
    pub markdown: String,
    pub metadata: DraftCheckpointMetadata,
}

#[derive(Debug)]
pub enum DraftCheckpointError {
    Io(io::Error),
    Json(serde_json::Error),
    IdentityMismatch { path: PathBuf },
}

impl fmt::Display for DraftCheckpointError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "draft checkpoint I/O failed: {error}"),
            Self::Json(error) => write!(formatter, "draft checkpoint JSON is invalid: {error}"),
            Self::IdentityMismatch { path } => write!(
                formatter,
                "draft checkpoint identity does not match its hashed file name: {}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for DraftCheckpointError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Json(error) => Some(error),
            Self::IdentityMismatch { .. } => None,
        }
    }
}

impl From<io::Error> for DraftCheckpointError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for DraftCheckpointError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

/// Atomically creates or replaces only the checkpoint identified by `checkpoint.key`.
/// All filesystem writes remain below the supplied application-data directory.
pub fn write_checkpoint(
    app_data_directory: impl AsRef<Path>,
    checkpoint: &DraftCheckpoint,
) -> Result<(), DraftCheckpointError> {
    let checkpoint_directory = checkpoint_directory(app_data_directory.as_ref());
    fs::create_dir_all(&checkpoint_directory)?;
    let path = checkpoint_path(&checkpoint_directory, &checkpoint.key);
    let serialized = serde_json::to_vec(checkpoint)?;
    atomic_write(&path, &serialized)?;
    Ok(())
}

pub fn read_checkpoint(
    app_data_directory: impl AsRef<Path>,
    key: &DraftCheckpointKey,
) -> Result<Option<DraftCheckpoint>, DraftCheckpointError> {
    let checkpoint_directory = checkpoint_directory(app_data_directory.as_ref());
    let path = checkpoint_path(&checkpoint_directory, key);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let checkpoint: DraftCheckpoint = serde_json::from_slice(&bytes)?;
    ensure_identity_matches(&path, &checkpoint)?;
    Ok(Some(checkpoint))
}

/// Lists checkpoints newest first. Equal timestamps use identity ordering for stability.
pub fn list_checkpoints(
    app_data_directory: impl AsRef<Path>,
) -> Result<Vec<DraftCheckpoint>, DraftCheckpointError> {
    let checkpoint_directory = checkpoint_directory(app_data_directory.as_ref());
    let entries = match fs::read_dir(&checkpoint_directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut checkpoints = Vec::new();

    for entry in entries {
        let path = match entry {
            Ok(entry) => entry.path(),
            Err(_) => continue,
        };
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let checkpoint: DraftCheckpoint = match serde_json::from_slice(&bytes) {
            Ok(checkpoint) => checkpoint,
            Err(_) => continue,
        };
        if ensure_identity_matches(&path, &checkpoint).is_err() {
            continue;
        }
        checkpoints.push(checkpoint);
    }

    checkpoints.sort_by(|left, right| {
        right
            .metadata
            .updated_at
            .cmp(&left.metadata.updated_at)
            .then_with(|| left.key.window_label.cmp(&right.key.window_label))
            .then_with(|| left.key.note_id.cmp(&right.key.note_id))
    });
    Ok(checkpoints)
}

/// Idempotently removes only the selected checkpoint.
pub fn clear_checkpoint(
    app_data_directory: impl AsRef<Path>,
    key: &DraftCheckpointKey,
) -> Result<(), DraftCheckpointError> {
    let checkpoint_directory = checkpoint_directory(app_data_directory.as_ref());
    let path = checkpoint_path(&checkpoint_directory, key);
    match fs::remove_file(path) {
        Ok(()) => {
            sync_parent_directory(&checkpoint_directory)?;
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn checkpoint_directory(app_data_directory: &Path) -> PathBuf {
    app_data_directory.join(CHECKPOINT_DIRECTORY_NAME)
}

fn checkpoint_path(directory: &Path, key: &DraftCheckpointKey) -> PathBuf {
    directory.join(checkpoint_file_name(key))
}

fn checkpoint_file_name(key: &DraftCheckpointKey) -> String {
    let mut identity = Vec::with_capacity(key.window_label.len() + key.note_id.len() + 16);
    identity.extend_from_slice(&(key.window_label.len() as u64).to_be_bytes());
    identity.extend_from_slice(key.window_label.as_bytes());
    identity.extend_from_slice(&(key.note_id.len() as u64).to_be_bytes());
    identity.extend_from_slice(key.note_id.as_bytes());
    format!("{}.json", sha256_hex(&identity))
}

fn ensure_identity_matches(
    path: &Path,
    checkpoint: &DraftCheckpoint,
) -> Result<(), DraftCheckpointError> {
    let actual = path.file_name().and_then(|name| name.to_str());
    if actual == Some(&checkpoint_file_name(&checkpoint.key)) {
        return Ok(());
    }
    Err(DraftCheckpointError::IdentityMismatch {
        path: path.to_path_buf(),
    })
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "draft checkpoint target has no parent directory",
        )
    })?;
    let (mut temporary_file, mut temporary_path) = create_temporary_file(path, parent)?;
    temporary_file.write_all(bytes)?;
    temporary_file.flush()?;
    temporary_file.sync_all()?;
    drop(temporary_file);

    replace_file(temporary_path.path(), path)?;
    temporary_path.commit();
    sync_parent_directory(parent)
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn create_temporary_file(path: &Path, parent: &Path) -> io::Result<(File, TemporaryPath)> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("checkpoint.json");
    loop {
        let sequence = NEXT_TEMPORARY_FILE.fetch_add(1, Ordering::Relaxed);
        let temporary_path = parent.join(format!(
            ".{file_name}.scratch-checkpoint-{}-{sequence}.tmp",
            std::process::id()
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
        {
            Ok(file) => return Ok((file, TemporaryPath::new(temporary_path))),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
}

struct TemporaryPath {
    path: PathBuf,
    committed: bool,
}

impl TemporaryPath {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            committed: false,
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn commit(&mut self) {
        self.committed = true;
    }
}

impl Drop for TemporaryPath {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(unix)]
fn sync_parent_directory(parent: &Path) -> io::Result<()> {
    File::open(parent)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) -> io::Result<()> {
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory {
        path: PathBuf,
    }

    impl TestDirectory {
        fn new(test_name: &str) -> Self {
            let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "scratch-draft-checkpoint-{test_name}-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create test directory");
            Self { path }
        }

        fn app_data_dir(&self) -> PathBuf {
            self.path.clone()
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn write_valid_checkpoint(dir: &PathBuf, window_label: &str, note_id: &str, content: &str) {
        let checkpoint = DraftCheckpoint {
            key: DraftCheckpointKey {
                window_label: window_label.to_string(),
                note_id: note_id.to_string(),
            },
            markdown: content.to_string(),
            metadata: DraftCheckpointMetadata {
                source_path: format!("/notes/{note_id}.md"),
                base_revision: Some("abc123".to_string()),
                updated_at: "2024-01-01T00:00:00Z".to_string(),
            },
        };
        write_checkpoint(dir, &checkpoint).expect("write checkpoint");
    }

    #[test]
    fn list_checkpoints_returns_valid_checkpoint() {
        let directory = TestDirectory::new("list-valid");
        let app_data = directory.app_data_dir();
        write_valid_checkpoint(&app_data, "main", "note1", "valid content");

        let checkpoints = list_checkpoints(&app_data).expect("list checkpoints");
        assert_eq!(checkpoints.len(), 1);
        assert_eq!(checkpoints[0].key.window_label, "main");
        assert_eq!(checkpoints[0].key.note_id, "note1");
        assert_eq!(checkpoints[0].markdown, "valid content");
    }

    #[test]
    fn list_checkpoints_skips_truncated_json() {
        let directory = TestDirectory::new("list-truncated");
        let app_data = directory.app_data_dir();
        write_valid_checkpoint(&app_data, "main", "note1", "valid content");

        // Write a truncated JSON file directly
        let checkpoint_dir = app_data.join(CHECKPOINT_DIRECTORY_NAME);
        let truncated_path = checkpoint_dir.join("truncated.json");
        fs::write(&truncated_path, r#"{"key":{"window_label":"main","note_id":"note2"#).unwrap();

        let checkpoints = list_checkpoints(&app_data).expect("list checkpoints");
        // Only the valid checkpoint should be returned
        assert_eq!(checkpoints.len(), 1);
        assert_eq!(checkpoints[0].key.note_id, "note1");
    }

    #[test]
    fn list_checkpoints_skips_identity_mismatch() {
        let directory = TestDirectory::new("list-identity-mismatch");
        let app_data = directory.app_data_dir();
        write_valid_checkpoint(&app_data, "main", "note1", "valid content");

        // Write a checkpoint with mismatched identity (wrong hash in filename)
        let checkpoint_dir = app_data.join(CHECKPOINT_DIRECTORY_NAME);
        let mismatch_path = checkpoint_dir.join("mismatch.json");
        let mismatch_content = r#"{"key":{"window_label":"main","note_id":"note2"},"markdown":"mismatch","metadata":{"source_path":"/notes/note2.md","base_revision":"abc","updated_at":"2024-01-01T00:00:00Z"}}"#;
        fs::write(&mismatch_path, mismatch_content).unwrap();

        let checkpoints = list_checkpoints(&app_data).expect("list checkpoints");
        // Only the valid checkpoint should be returned
        assert_eq!(checkpoints.len(), 1);
        assert_eq!(checkpoints[0].key.note_id, "note1");
    }

    #[test]
    fn list_checkpoints_skips_unreadable_entry() {
        let directory = TestDirectory::new("list-unreadable");
        let app_data = directory.app_data_dir();
        write_valid_checkpoint(&app_data, "main", "note1", "valid content");

        // Create a directory entry instead of a file (unreadable as JSON)
        let checkpoint_dir = app_data.join(CHECKPOINT_DIRECTORY_NAME);
        fs::create_dir(checkpoint_dir.join("not-a-file.json")).unwrap();

        let checkpoints = list_checkpoints(&app_data).expect("list checkpoints");
        assert_eq!(checkpoints.len(), 1);
        assert_eq!(checkpoints[0].key.note_id, "note1");
    }

    #[test]
    fn list_checkpoints_preserves_deterministic_sorting() {
        let directory = TestDirectory::new("list-sorting");
        let app_data = directory.app_data_dir();
        write_valid_checkpoint(&app_data, "main", "note1", "content1");
        write_valid_checkpoint(&app_data, "main", "note2", "content2");
        write_valid_checkpoint(&app_data, "workspace-1", "note1", "content3");

        let checkpoints = list_checkpoints(&app_data).expect("list checkpoints");
        assert_eq!(checkpoints.len(), 3);
        // Sorted by updated_at descending, then window_label, then note_id
        // All have same updated_at, so sort by window_label then note_id
        assert_eq!(checkpoints[0].key.window_label, "main");
        assert_eq!(checkpoints[0].key.note_id, "note1");
        assert_eq!(checkpoints[1].key.window_label, "main");
        assert_eq!(checkpoints[1].key.note_id, "note2");
        assert_eq!(checkpoints[2].key.window_label, "workspace-1");
        assert_eq!(checkpoints[2].key.note_id, "note1");
    }
}
