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
        let checkpoint: DraftCheckpoint = serde_json::from_slice(&fs::read(&path)?)?;
        ensure_identity_matches(&path, &checkpoint)?;
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
    format!("{}.json", hex_sha256(&identity))
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

fn hex_sha256(input: &[u8]) -> String {
    let digest = sha256(input);
    let mut hex = String::with_capacity(64);
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    for byte in digest {
        hex.push(DIGITS[(byte >> 4) as usize] as char);
        hex.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    hex
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
    tail[tail_length - 8..tail_length]
        .copy_from_slice(&(input.len() as u64).wrapping_mul(8).to_be_bytes());
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
