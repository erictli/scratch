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
        let path = entry?.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let Ok(checkpoint) = serde_json::from_slice::<DraftCheckpoint>(&bytes) else {
            continue;
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
    format!("{}.json", crate::sha256::hex_digest(&identity))
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
    use super::{
        checkpoint_directory, list_checkpoints, write_checkpoint, DraftCheckpoint,
        DraftCheckpointKey, DraftCheckpointMetadata,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory {
        path: PathBuf,
    }

    impl TestDirectory {
        fn new() -> Self {
            let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "scratch-draft-checkpoint-list-{}-{sequence}",
                std::process::id(),
            ));
            fs::create_dir_all(&path).expect("create checkpoint test directory");
            Self { path }
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn checkpoint(note_id: &str) -> DraftCheckpoint {
        DraftCheckpoint {
            key: DraftCheckpointKey {
                window_label: "main".to_string(),
                note_id: note_id.to_string(),
            },
            markdown: "# Recoverable".to_string(),
            metadata: DraftCheckpointMetadata {
                source_path: "/notes/recoverable.md".to_string(),
                base_revision: Some("revision".to_string()),
                updated_at: "2026-08-04T08:00:00Z".to_string(),
            },
        }
    }

    #[test]
    fn list_skips_invalid_entries_and_returns_valid_checkpoints() {
        let directory = TestDirectory::new();
        let valid = checkpoint("recoverable.md");
        write_checkpoint(&directory.path, &valid).expect("write valid checkpoint");

        let checkpoint_directory = checkpoint_directory(&directory.path);
        fs::write(checkpoint_directory.join("truncated.json"), b"{").expect("write truncated JSON");
        fs::write(checkpoint_directory.join("unrelated.json"), b"{}")
            .expect("write unrelated JSON");
        fs::write(
            checkpoint_directory.join("wrong-identity.json"),
            serde_json::to_vec(&checkpoint("different.md")).expect("serialize checkpoint"),
        )
        .expect("write identity mismatch");
        fs::create_dir(checkpoint_directory.join("unreadable.json"))
            .expect("create unreadable JSON entry");
        fs::write(checkpoint_directory.join("ignore.txt"), b"not JSON")
            .expect("write non-JSON file");

        assert_eq!(
            list_checkpoints(&directory.path).expect("list valid checkpoints"),
            vec![valid],
        );
    }
}
