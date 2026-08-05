use std::collections::HashMap;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

static NEXT_TEMPORARY_FILE: AtomicU64 = AtomicU64::new(0);
static PATH_LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();

/// Stable SHA-256 identifier for one exact UTF-8 note content.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct ContentRevision(String);

impl ContentRevision {
    #[cfg(test)]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn from_hex(value: &str) -> Result<Self, String> {
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("Revision must be 64 lowercase hexadecimal characters".to_string());
        }
        Ok(Self(value.to_string()))
    }
}

impl fmt::Display for ContentRevision {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileSnapshot {
    pub revision: ContentRevision,
    pub content: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SaveResult {
    Saved { revision: ContentRevision },
    Conflict { current: Option<FileSnapshot> },
}

/// Returns a deterministic revision suitable for optimistic concurrency checks.
pub fn content_revision(content: &str) -> ContentRevision {
    ContentRevision(crate::sha256::hex_digest(content.as_bytes()))
}

/// Saves `content` only when the file still has `expected_revision`.
///
/// `None` means the caller expects the file not to exist. A stale or missing
/// current revision is returned as a typed conflict and never mutates `path`.
pub fn save_if_revision(
    path: impl AsRef<Path>,
    content: &str,
    expected_revision: Option<&ContentRevision>,
) -> io::Result<SaveResult> {
    let path = path.as_ref();
    let path_lock = lock_for_path(path);
    let _save_guard = path_lock
        .lock()
        .map_err(|_| io::Error::other("note persistence lock poisoned"))?;

    let current = read_snapshot(path)?;
    let revision_matches = match (expected_revision, current.as_ref()) {
        (None, None) => true,
        (Some(expected), Some(snapshot)) => expected == &snapshot.revision,
        _ => false,
    };

    if !revision_matches {
        return Ok(SaveResult::Conflict { current });
    }

    let next_revision = content_revision(content);
    if current
        .as_ref()
        .is_some_and(|snapshot| snapshot.revision == next_revision)
    {
        return Ok(SaveResult::Saved {
            revision: next_revision,
        });
    }

    let write_result = if expected_revision.is_none() {
        atomic_create_new(path, content.as_bytes())
    } else {
        atomic_write(path, content.as_bytes())
    };

    if let Err(error) = write_result {
        if expected_revision.is_none() && error.kind() == io::ErrorKind::AlreadyExists {
            return Ok(SaveResult::Conflict {
                current: read_snapshot(path)?,
            });
        }
        return Err(error);
    }

    Ok(SaveResult::Saved {
        revision: next_revision,
    })
}

pub(crate) fn read_snapshot(path: &Path) -> io::Result<Option<FileSnapshot>> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(FileSnapshot {
            revision: content_revision(&content),
            content,
        })),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn lock_for_path(path: &Path) -> Arc<Mutex<()>> {
    let key = lock_key(path);
    let locks = PATH_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    locks.retain(|_, lock| lock.strong_count() > 0);

    if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
        return lock;
    }

    let lock = Arc::new(Mutex::new(()));
    locks.insert(key, Arc::downgrade(&lock));
    lock
}

fn lock_key(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    };

    if let Ok(canonical) = absolute.canonicalize() {
        return canonical;
    }

    let Some(file_name) = absolute.file_name() else {
        return absolute;
    };
    absolute
        .parent()
        .and_then(|parent| parent.canonicalize().ok())
        .map(|parent| parent.join(file_name))
        .unwrap_or(absolute)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "atomic save target has no parent directory",
        )
    })?;
    let existing_permissions = fs::metadata(path)
        .ok()
        .map(|metadata| metadata.permissions());
    let (mut temporary_file, mut temporary_path) = create_temporary_file(path, parent)?;

    temporary_file.write_all(bytes)?;
    temporary_file.flush()?;
    if let Some(permissions) = existing_permissions {
        temporary_file.set_permissions(permissions)?;
    }
    temporary_file.sync_all()?;
    drop(temporary_file);

    fs::rename(temporary_path.path(), path)?;
    temporary_path.commit();
    sync_parent_directory(parent)?;
    Ok(())
}

/// Publishes a brand-new file without ever replacing an existing directory
/// entry. The hard-link operation is atomic within the destination directory:
/// another process either wins first or receives `AlreadyExists`.
/// Filesystems without hard-link support fall back to a direct create-only
/// publication so that create-new saves still succeed.
fn atomic_create_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "atomic create target has no parent directory",
        )
    })?;
    let (mut temporary_file, mut temporary_path) = create_temporary_file(path, parent)?;

    temporary_file.write_all(bytes)?;
    temporary_file.flush()?;
    temporary_file.sync_all()?;
    drop(temporary_file);

    match fs::hard_link(temporary_path.path(), path) {
        Ok(()) => {
            fs::remove_file(temporary_path.path())?;
            temporary_path.commit();
            sync_parent_directory(parent)?;
            return Ok(());
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            return Err(error);
        }
        Err(_) => {}
    }

    write_create_new_destination(path, bytes)?;

    fs::remove_file(temporary_path.path())?;
    temporary_path.commit();
    sync_parent_directory(parent)?;
    Ok(())
}

fn write_create_new_destination(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let write_result = file
        .write_all(bytes)
        .and_then(|()| file.flush())
        .and_then(|()| file.sync_all());
    drop(file);

    if let Err(error) = write_result {
        let _ = fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

fn create_temporary_file(path: &Path, parent: &Path) -> io::Result<(File, TemporaryPath)> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("note");

    loop {
        let sequence = NEXT_TEMPORARY_FILE.fetch_add(1, Ordering::Relaxed);
        let temporary_path = parent.join(format!(
            ".{file_name}.scratch-save-{}-{sequence}.tmp",
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
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory {
        path: PathBuf,
    }

    impl TestDirectory {
        fn new(test_name: &str) -> Self {
            let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "scratch-persistence-{test_name}-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create persistence test directory");
            Self { path }
        }

        fn note_path(&self) -> PathBuf {
            self.path.join("note.md")
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn temporary_artifacts(parent: &Path) -> Vec<PathBuf> {
        fs::read_dir(parent)
            .expect("read test directory")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.contains(".scratch-save-"))
            })
            .collect()
    }

    #[test]
    fn revision_is_deterministic_and_uses_known_sha256_values() {
        assert_eq!(
            content_revision("").as_str(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            content_revision("abc").as_str(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(content_revision("same"), content_revision("same"));
        assert_ne!(content_revision("same"), content_revision("changed"));
    }

    #[test]
    fn revision_parser_rejects_non_sha256_identifiers() {
        let valid = content_revision("valid").to_string();
        assert_eq!(ContentRevision::from_hex(&valid).unwrap().as_str(), valid);
        assert!(ContentRevision::from_hex("short").is_err());
        assert!(ContentRevision::from_hex(&"A".repeat(64)).is_err());
        assert!(ContentRevision::from_hex(&"g".repeat(64)).is_err());
    }

    #[test]
    fn save_to_missing_file_is_atomic_and_returns_new_revision() {
        let directory = TestDirectory::new("initial-save");
        let path = directory.note_path();

        let result = save_if_revision(&path, "first version", None).expect("save new note");

        assert_eq!(
            result,
            SaveResult::Saved {
                revision: content_revision("first version")
            }
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "first version");
        assert!(temporary_artifacts(&directory.path).is_empty());
    }

    #[test]
    fn stale_revision_returns_current_snapshot_without_modifying_final_file() {
        let directory = TestDirectory::new("stale-revision");
        let path = directory.note_path();
        fs::write(&path, "version one").unwrap();
        let stale_revision = content_revision("version one");
        fs::write(&path, "version two from another window").unwrap();

        let result = save_if_revision(&path, "stale local edit", Some(&stale_revision))
            .expect("conflict is a typed result");

        assert_eq!(
            result,
            SaveResult::Conflict {
                current: Some(FileSnapshot {
                    revision: content_revision("version two from another window"),
                    content: "version two from another window".to_string(),
                })
            }
        );
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "version two from another window"
        );
        assert!(temporary_artifacts(&directory.path).is_empty());
    }

    #[test]
    fn expected_revision_for_deleted_file_returns_missing_conflict() {
        let directory = TestDirectory::new("deleted-file");
        let path = directory.note_path();
        let deleted_revision = content_revision("deleted elsewhere");

        let result = save_if_revision(&path, "local edit", Some(&deleted_revision)).unwrap();

        assert_eq!(result, SaveResult::Conflict { current: None });
        assert!(!path.exists());
    }

    #[test]
    fn create_only_save_refuses_to_replace_existing_file() {
        let directory = TestDirectory::new("create-only");
        let path = directory.note_path();
        fs::write(&path, "already exists").unwrap();

        let result = save_if_revision(&path, "new content", None).unwrap();

        assert_eq!(
            result,
            SaveResult::Conflict {
                current: Some(FileSnapshot {
                    revision: content_revision("already exists"),
                    content: "already exists".to_string(),
                })
            }
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "already exists");
    }

    #[test]
    fn atomic_create_new_never_replaces_an_external_file() {
        let directory = TestDirectory::new("external-create-race");
        let path = directory.note_path();
        fs::write(&path, "created by another process").unwrap();

        let error = atomic_create_new(&path, b"local draft")
            .expect_err("create-only publication must reject an existing destination");

        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "created by another process"
        );
        assert!(temporary_artifacts(&directory.path).is_empty());
    }

    #[test]
    fn create_new_fallback_never_deletes_an_existing_destination() {
        let directory = TestDirectory::new("fallback-existing-race");
        let path = directory.note_path();
        fs::write(&path, "created by another process").unwrap();

        let error = write_create_new_destination(&path, b"local draft")
            .expect_err("create-only fallback must reject an existing destination");

        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "created by another process"
        );
    }

    #[cfg(unix)]
    #[test]
    fn atomic_create_new_never_replaces_a_dangling_symlink() {
        use std::os::unix::fs::symlink;

        let directory = TestDirectory::new("dangling-symlink-race");
        let path = directory.note_path();
        let missing_target = directory.path.join("missing.md");
        symlink(&missing_target, &path).unwrap();

        let error = atomic_create_new(&path, b"local draft")
            .expect_err("create-only publication must preserve a dangling symlink");

        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_link(&path).unwrap(), missing_target);
        assert!(temporary_artifacts(&directory.path).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn existing_symlink_aliases_share_one_persistence_lock_key() {
        use std::os::unix::fs::symlink;

        let directory = TestDirectory::new("symlink-lock-key");
        let target = directory.note_path();
        let alias = directory.path.join("alias.md");
        fs::write(&target, "base").unwrap();
        symlink(&target, &alias).unwrap();

        assert_eq!(lock_key(&target), lock_key(&alias));
    }

    #[test]
    fn simultaneous_saves_with_same_revision_have_one_winner_and_one_conflict() {
        let directory = TestDirectory::new("simultaneous-save");
        let path = directory.note_path();
        fs::write(&path, "base").unwrap();
        let expected = content_revision("base");

        let first_path = path.clone();
        let first_expected = expected.clone();
        let first = std::thread::spawn(move || {
            save_if_revision(&first_path, "edit from window one", Some(&first_expected))
                .expect("first concurrent save")
        });

        let second_path = path.clone();
        let second_expected = expected.clone();
        let second = std::thread::spawn(move || {
            save_if_revision(&second_path, "edit from window two", Some(&second_expected))
                .expect("second concurrent save")
        });

        let results = [first.join().unwrap(), second.join().unwrap()];
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, SaveResult::Saved { .. }))
                .count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, SaveResult::Conflict { .. }))
                .count(),
            1
        );

        let final_content = fs::read_to_string(&path).unwrap();
        let saved_revision = results
            .iter()
            .find_map(|result| match result {
                SaveResult::Saved { revision } => Some(revision),
                SaveResult::Conflict { .. } => None,
            })
            .unwrap();
        assert_eq!(&content_revision(&final_content), saved_revision);
        assert!(temporary_artifacts(&directory.path).is_empty());
    }

    #[test]
    fn atomic_write_removes_temporary_file_when_rename_fails() {
        let directory = TestDirectory::new("rename-error");
        let destination_is_a_directory = directory.path.join("destination");
        fs::create_dir(&destination_is_a_directory).unwrap();

        let error = atomic_write(&destination_is_a_directory, b"content")
            .expect_err("renaming a file over a directory must fail");

        assert_ne!(error.kind(), std::io::ErrorKind::NotFound);
        assert!(destination_is_a_directory.is_dir());
        assert!(temporary_artifacts(&directory.path).is_empty());
    }
}
