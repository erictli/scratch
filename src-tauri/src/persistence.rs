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
    pub fn as_str(&self) -> &str {
        &self.0
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
    let digest = sha256(content.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    const DIGITS: &[u8; 16] = b"0123456789abcdef";

    for byte in digest {
        hex.push(DIGITS[(byte >> 4) as usize] as char);
        hex.push(DIGITS[(byte & 0x0f) as usize] as char);
    }

    ContentRevision(hex)
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

    fs::hard_link(temporary_path.path(), path)?;
    fs::remove_file(temporary_path.path())?;
    temporary_path.commit();
    sync_parent_directory(parent)?;
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

fn sha256(input: &[u8]) -> [u8; 32] {
    const INITIAL: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    const ROUND_CONSTANTS: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut state = INITIAL;
    let mut chunks = input.chunks_exact(64);
    for chunk in &mut chunks {
        sha256_compress(&mut state, chunk, &ROUND_CONSTANTS);
    }

    let remainder = chunks.remainder();
    let mut tail = [0_u8; 128];
    tail[..remainder.len()].copy_from_slice(remainder);
    tail[remainder.len()] = 0x80;
    let tail_length = if remainder.len() < 56 { 64 } else { 128 };
    let bit_length = (input.len() as u64).wrapping_mul(8).to_be_bytes();
    tail[tail_length - 8..tail_length].copy_from_slice(&bit_length);

    for chunk in tail[..tail_length].chunks_exact(64) {
        sha256_compress(&mut state, chunk, &ROUND_CONSTANTS);
    }

    let mut digest = [0_u8; 32];
    for (output, word) in digest.chunks_exact_mut(4).zip(state) {
        output.copy_from_slice(&word.to_be_bytes());
    }
    digest
}

fn sha256_compress(state: &mut [u32; 8], chunk: &[u8], constants: &[u32; 64]) {
    let mut schedule = [0_u32; 64];
    for (index, word) in chunk.chunks_exact(4).enumerate() {
        schedule[index] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
    }
    for index in 16..64 {
        let s0 = schedule[index - 15].rotate_right(7)
            ^ schedule[index - 15].rotate_right(18)
            ^ (schedule[index - 15] >> 3);
        let s1 = schedule[index - 2].rotate_right(17)
            ^ schedule[index - 2].rotate_right(19)
            ^ (schedule[index - 2] >> 10);
        schedule[index] = schedule[index - 16]
            .wrapping_add(s0)
            .wrapping_add(schedule[index - 7])
            .wrapping_add(s1);
    }

    let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = *state;
    for index in 0..64 {
        let big_s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
        let choice = (e & f) ^ ((!e) & g);
        let temp1 = h
            .wrapping_add(big_s1)
            .wrapping_add(choice)
            .wrapping_add(constants[index])
            .wrapping_add(schedule[index]);
        let big_s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
        let majority = (a & b) ^ (a & c) ^ (b & c);
        let temp2 = big_s0.wrapping_add(majority);

        h = g;
        g = f;
        f = e;
        e = d.wrapping_add(temp1);
        d = c;
        c = b;
        b = a;
        a = temp1.wrapping_add(temp2);
    }

    state[0] = state[0].wrapping_add(a);
    state[1] = state[1].wrapping_add(b);
    state[2] = state[2].wrapping_add(c);
    state[3] = state[3].wrapping_add(d);
    state[4] = state[4].wrapping_add(e);
    state[5] = state[5].wrapping_add(f);
    state[6] = state[6].wrapping_add(g);
    state[7] = state[7].wrapping_add(h);
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
