#[path = "../src/draft_checkpoint.rs"]
mod draft_checkpoint;

use draft_checkpoint::{
    clear_checkpoint, list_checkpoints, read_checkpoint, write_checkpoint, DraftCheckpoint,
    DraftCheckpointKey, DraftCheckpointMetadata, CHECKPOINT_DIRECTORY_NAME,
};
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
            "scratch-draft-checkpoint-{test_name}-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&path).expect("create isolated draft checkpoint test directory");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn checkpoint(window_label: &str, note_id: &str, markdown: &str) -> DraftCheckpoint {
    DraftCheckpoint {
        key: DraftCheckpointKey {
            window_label: window_label.to_string(),
            note_id: note_id.to_string(),
        },
        markdown: markdown.to_string(),
        metadata: DraftCheckpointMetadata {
            source_path: "/workspace/Notes/Plan.md".to_string(),
            base_revision: Some("revision-before-edit".to_string()),
            updated_at: "2026-08-01T12:34:56.789Z".to_string(),
        },
    }
}

#[test]
fn round_trip_preserves_exact_markdown_and_metadata() {
    let app_data = TestDirectory::new("exact-round-trip");
    let expected = checkpoint(
        "main-window",
        "notes/plan",
        "# Plan\n\n- café ☕\n- two trailing spaces  \n\n```rust\nfn main() {}\n```\n\0",
    );

    write_checkpoint(app_data.path(), &expected).expect("write checkpoint");
    let actual = read_checkpoint(app_data.path(), &expected.key)
        .expect("read checkpoint")
        .expect("checkpoint exists");

    assert_eq!(actual, expected);
}

#[test]
fn unsafe_identity_values_become_one_hashed_file_inside_app_data() {
    let app_data = TestDirectory::new("safe-file-name");
    let expected = checkpoint("../window/../../escape", "../../Notes/秘密.md", "draft");

    write_checkpoint(app_data.path(), &expected).expect("write checkpoint");

    let checkpoint_directory = app_data.path().join(CHECKPOINT_DIRECTORY_NAME);
    let entries = fs::read_dir(&checkpoint_directory)
        .expect("read checkpoint directory")
        .collect::<Result<Vec<_>, _>>()
        .expect("read checkpoint entries");
    assert_eq!(entries.len(), 1);

    let file_name = entries[0]
        .file_name()
        .into_string()
        .expect("checkpoint file name is UTF-8");
    let hash = file_name
        .strip_suffix(".json")
        .expect("checkpoint uses JSON extension");
    assert_eq!(hash.len(), 64);
    assert!(hash.bytes().all(|byte| byte.is_ascii_hexdigit()));
    assert!(!file_name.contains("window"));
    assert!(!file_name.contains("Notes"));
    assert!(!app_data.path().join("escape").exists());
}

#[test]
fn rewriting_one_checkpoint_leaves_other_window_and_note_checkpoints_unchanged() {
    let app_data = TestDirectory::new("isolated-replacement");
    let first = checkpoint("window-a", "note-a", "first draft");
    let second = checkpoint("window-b", "note-a", "other window draft");
    let third = checkpoint("window-a", "note-b", "other note draft");
    write_checkpoint(app_data.path(), &first).expect("write first checkpoint");
    write_checkpoint(app_data.path(), &second).expect("write second checkpoint");
    write_checkpoint(app_data.path(), &third).expect("write third checkpoint");

    let mut replacement = first.clone();
    replacement.markdown = "replacement draft\n".to_string();
    replacement.metadata.updated_at = "2026-08-01T13:00:00Z".to_string();
    write_checkpoint(app_data.path(), &replacement).expect("replace first checkpoint");

    assert_eq!(
        read_checkpoint(app_data.path(), &first.key).expect("read replacement"),
        Some(replacement.clone())
    );
    assert_eq!(
        read_checkpoint(app_data.path(), &second.key).expect("read other window"),
        Some(second.clone())
    );
    assert_eq!(
        read_checkpoint(app_data.path(), &third.key).expect("read other note"),
        Some(third.clone())
    );

    let listed = list_checkpoints(app_data.path()).expect("list checkpoints");
    assert_eq!(listed.len(), 3);
    assert!(listed.contains(&replacement));
    assert!(listed.contains(&second));
    assert!(listed.contains(&third));
}

#[test]
fn clear_is_idempotent_and_removes_only_the_selected_checkpoint() {
    let app_data = TestDirectory::new("idempotent-clear");
    let selected = checkpoint("window-a", "note-a", "selected");
    let retained = checkpoint("window-a", "note-b", "retained");
    write_checkpoint(app_data.path(), &selected).expect("write selected checkpoint");
    write_checkpoint(app_data.path(), &retained).expect("write retained checkpoint");

    clear_checkpoint(app_data.path(), &selected.key).expect("clear selected checkpoint");
    clear_checkpoint(app_data.path(), &selected.key).expect("clear selected checkpoint again");

    assert_eq!(
        read_checkpoint(app_data.path(), &selected.key).expect("read cleared checkpoint"),
        None
    );
    assert_eq!(
        list_checkpoints(app_data.path()).expect("list retained checkpoint"),
        vec![retained]
    );
}

#[test]
fn writes_never_touch_the_markdown_workspace_named_in_metadata() {
    let root = TestDirectory::new("app-data-only");
    let app_data = root.path().join("app-data");
    let workspace = root.path().join("workspace");
    fs::create_dir_all(&workspace).expect("create workspace");
    let note_path = workspace.join("Plan.md");
    fs::write(&note_path, "# Saved note\n").expect("write workspace note");
    let mut expected = checkpoint("main", "plan", "# Unsaved draft\n");
    expected.metadata.source_path = note_path.to_string_lossy().into_owned();

    write_checkpoint(&app_data, &expected).expect("write checkpoint");

    assert_eq!(
        fs::read_to_string(&note_path).expect("read untouched workspace note"),
        "# Saved note\n"
    );
    assert_eq!(
        fs::read_dir(&workspace)
            .expect("read workspace")
            .collect::<Result<Vec<_>, _>>()
            .expect("read workspace entries")
            .len(),
        1
    );
}

#[test]
fn completed_atomic_writes_leave_no_temporary_files() {
    let app_data = TestDirectory::new("atomic-cleanup");
    let expected = checkpoint("main", "plan", "first");
    write_checkpoint(app_data.path(), &expected).expect("write first checkpoint");

    let mut replacement = expected.clone();
    replacement.markdown = "second".to_string();
    write_checkpoint(app_data.path(), &replacement).expect("replace checkpoint");

    let names = fs::read_dir(app_data.path().join(CHECKPOINT_DIRECTORY_NAME))
        .expect("read checkpoint directory")
        .map(|entry| {
            entry
                .expect("read checkpoint entry")
                .file_name()
                .into_string()
                .expect("checkpoint file name is UTF-8")
        })
        .collect::<Vec<_>>();
    assert_eq!(names.len(), 1);
    assert!(names[0].ends_with(".json"));
    assert!(!names[0].ends_with(".tmp"));
}

#[test]
fn distinct_identity_pairs_cannot_share_a_hash_input() {
    let app_data = TestDirectory::new("unambiguous-identity");
    let first = checkpoint("a\0b", "c", "first identity");
    let second = checkpoint("a", "b\0c", "second identity");

    write_checkpoint(app_data.path(), &first).expect("write first identity");
    write_checkpoint(app_data.path(), &second).expect("write second identity");

    assert_eq!(
        read_checkpoint(app_data.path(), &first.key).expect("read first identity"),
        Some(first)
    );
    assert_eq!(
        read_checkpoint(app_data.path(), &second.key).expect("read second identity"),
        Some(second)
    );
    assert_eq!(
        list_checkpoints(app_data.path())
            .expect("list distinct identities")
            .len(),
        2
    );
}
