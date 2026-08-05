use crate::persistence::{
    content_revision, read_snapshot, save_if_revision, FileSnapshot, SaveResult,
};
use crate::{
    create_note_create_only, read_file_content_from_path, read_note_from_path,
    recreate_file_content_to_path, save_file_content_to_path, save_note_to_path,
    validate_preview_create_path, write_recovery_snapshot, write_recovery_snapshot_with,
    FileSaveResult, NoteConflictSnapshot, NoteSaveResult, RecoverySnapshotRequest,
    MAX_RECOVERY_NAME_ATTEMPTS,
};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Barrier};

static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

struct TestDirectory {
    path: PathBuf,
}

impl TestDirectory {
    fn new(test_name: &str) -> Self {
        let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "scratch-note-persistence-{test_name}-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&path).expect("create isolated note persistence test directory");
        Self { path }
    }

    fn note_path(&self, file_name: &str) -> PathBuf {
        self.path.join(file_name)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[test]
fn reading_the_same_note_returns_the_same_content_revision() {
    let directory = TestDirectory::new("deterministic-read");
    let first_path = directory.note_path("first.md");
    let second_path = directory.note_path("second.md");
    let content = "# Deterministic\n\nSame Markdown bytes.\n";
    fs::write(&first_path, content).expect("write first note");
    fs::write(&second_path, content).expect("write second note");

    let first_read = read_snapshot(&first_path)
        .expect("read first note")
        .expect("first note exists");
    let repeated_read = read_snapshot(&first_path)
        .expect("read first note again")
        .expect("first note still exists");
    let same_content_elsewhere = read_snapshot(&second_path)
        .expect("read second note")
        .expect("second note exists");

    assert_eq!(first_read.content, content);
    assert_eq!(first_read.revision, repeated_read.revision);
    assert_eq!(first_read.revision, same_content_elsewhere.revision);
    assert_eq!(first_read.revision, content_revision(content));
}

#[test]
fn save_with_the_current_revision_replaces_the_note_and_returns_the_new_revision() {
    let directory = TestDirectory::new("expected-revision");
    let path = directory.note_path("note.md");
    fs::write(&path, "version one").expect("write initial note");
    let initial = read_snapshot(&path)
        .expect("read initial note")
        .expect("initial note exists");

    let result = save_if_revision(&path, "version two", Some(&initial.revision))
        .expect("save with current revision");
    let SaveResult::Saved { revision } = result else {
        panic!("current revision must allow the save");
    };
    let persisted = read_snapshot(&path)
        .expect("read saved note")
        .expect("saved note exists");

    assert_eq!(
        persisted,
        FileSnapshot {
            revision: revision.clone(),
            content: "version two".to_string(),
        }
    );
    assert_ne!(revision, initial.revision);
}

#[test]
fn save_with_a_stale_revision_returns_typed_conflict_without_overwriting() {
    let directory = TestDirectory::new("stale-revision");
    let path = directory.note_path("note.md");
    fs::write(&path, "version one").expect("write initial note");
    let stale = read_snapshot(&path)
        .expect("read initial note")
        .expect("initial note exists");
    fs::write(&path, "newer version from another window").expect("write external update");
    let newer = read_snapshot(&path)
        .expect("read external update")
        .expect("externally updated note exists");

    let result = save_if_revision(&path, "stale local draft", Some(&stale.revision))
        .expect("stale save returns a typed result");

    assert_eq!(
        result,
        SaveResult::Conflict {
            current: Some(newer.clone()),
        }
    );
    assert_eq!(
        read_snapshot(&path).expect("read note after conflict"),
        Some(newer)
    );
}

#[test]
fn save_after_external_deletion_returns_missing_conflict_and_does_not_recreate_file() {
    let directory = TestDirectory::new("deleted-note");
    let path = directory.note_path("note.md");
    fs::write(&path, "deleted elsewhere").expect("write initial note");
    let deleted = read_snapshot(&path)
        .expect("read initial note")
        .expect("initial note exists");
    fs::remove_file(&path).expect("delete note externally");

    let result = save_if_revision(&path, "stale local draft", Some(&deleted.revision))
        .expect("save after deletion returns a typed result");

    assert_eq!(result, SaveResult::Conflict { current: None });
    assert_eq!(
        read_snapshot(&path).expect("check deleted note after conflict"),
        None
    );
    assert!(!path.exists());
}

#[test]
fn simultaneous_saves_from_one_revision_yield_exactly_one_save_and_one_conflict() {
    let directory = TestDirectory::new("simultaneous-saves");
    let path = directory.note_path("note.md");
    fs::write(&path, "shared base").expect("write shared base");
    let shared_revision = read_snapshot(&path)
        .expect("read shared base")
        .expect("shared base exists")
        .revision;
    let start = Arc::new(Barrier::new(3));

    let first_path = path.clone();
    let first_revision = shared_revision.clone();
    let first_start = Arc::clone(&start);
    let first = std::thread::spawn(move || {
        first_start.wait();
        save_if_revision(&first_path, "draft from window one", Some(&first_revision))
            .expect("first simultaneous save returns a typed result")
    });

    let second_path = path.clone();
    let second_revision = shared_revision.clone();
    let second_start = Arc::clone(&start);
    let second = std::thread::spawn(move || {
        second_start.wait();
        save_if_revision(
            &second_path,
            "draft from window two",
            Some(&second_revision),
        )
        .expect("second simultaneous save returns a typed result")
    });

    start.wait();
    let results = [
        first.join().expect("first save thread completes"),
        second.join().expect("second save thread completes"),
    ];

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

    let persisted = read_snapshot(&path)
        .expect("read winner")
        .expect("winning save keeps note present");
    let saved_revision = results
        .iter()
        .find_map(|result| match result {
            SaveResult::Saved { revision } => Some(revision),
            SaveResult::Conflict { .. } => None,
        })
        .expect("one saved revision");
    let conflict_snapshot = results
        .iter()
        .find_map(|result| match result {
            SaveResult::Conflict {
                current: Some(snapshot),
            } => Some(snapshot),
            _ => None,
        })
        .expect("losing save observes the winner");

    assert_eq!(&persisted.revision, saved_revision);
    assert_eq!(&persisted, conflict_snapshot);
    assert!(matches!(
        persisted.content.as_str(),
        "draft from window one" | "draft from window two"
    ));
}

#[test]
fn simultaneous_note_creators_retry_the_same_initial_id_without_overwriting() {
    let directory = TestDirectory::new("simultaneous-creators");
    let start = Arc::new(Barrier::new(3));

    let first_folder = directory.path.clone();
    let first_start = Arc::clone(&start);
    let first = std::thread::spawn(move || {
        first_start.wait();
        create_note_create_only(&first_folder, "Untitled", false).expect("first creator succeeds")
    });

    let second_folder = directory.path.clone();
    let second_start = Arc::clone(&start);
    let second = std::thread::spawn(move || {
        second_start.wait();
        create_note_create_only(&second_folder, "Untitled", false).expect("second creator retries")
    });

    start.wait();
    let first_note = first.join().expect("first creator completes");
    let second_note = second.join().expect("second creator completes");
    let mut ids = vec![first_note.id, second_note.id];
    ids.sort();

    assert_eq!(ids, vec!["Untitled", "Untitled-1"]);
    assert_eq!(
        fs::read_to_string(directory.note_path("Untitled.md")).unwrap(),
        "# Untitled\n\n",
    );
    assert_eq!(
        fs::read_to_string(directory.note_path("Untitled-1.md")).unwrap(),
        "# Untitled 1\n\n",
    );
}

#[test]
fn command_read_exposes_the_note_content_and_its_deterministic_revision() {
    let directory = TestDirectory::new("command-read-revision");
    let path = directory.note_path("command-note.md");
    let content = "# Command note\n\nRead through the command contract.\n";
    fs::write(&path, content).expect("write command note");

    let note = read_note_from_path("command-note".to_string(), &path)
        .expect("command reads existing note");

    assert_eq!(note.id, "command-note");
    assert_eq!(note.content, content);
    assert_eq!(note.revision, content_revision(content).to_string());
}

#[test]
fn command_save_with_current_revision_returns_saved_note_with_new_revision() {
    let directory = TestDirectory::new("command-current-save");
    let path = directory.note_path("command-note.md");
    fs::write(&path, "version one").expect("write initial command note");
    let initial =
        read_note_from_path("command-note".to_string(), &path).expect("command reads initial note");
    let updated_content = "version two from the command";

    let result = save_note_to_path(
        "command-note".to_string(),
        &path,
        updated_content.to_string(),
        initial.revision.clone(),
    )
    .expect("command save with current revision returns a typed result");
    let NoteSaveResult::Saved { note } = result else {
        panic!("current revision must return NoteSaveResult::Saved");
    };

    assert_eq!(note.id, "command-note");
    assert_eq!(note.content, updated_content);
    assert_eq!(note.revision, content_revision(updated_content).to_string());
    assert_ne!(note.revision, initial.revision);
    assert_eq!(
        fs::read_to_string(&path).expect("read command-saved file"),
        updated_content
    );
}

#[test]
fn command_save_with_stale_revision_returns_current_conflict_without_overwriting() {
    let directory = TestDirectory::new("command-stale-save");
    let path = directory.note_path("command-note.md");
    fs::write(&path, "version one").expect("write initial command note");
    let stale =
        read_note_from_path("command-note".to_string(), &path).expect("command reads initial note");
    let external_content = "newer version from another window";
    fs::write(&path, external_content).expect("write external update");

    let result = save_note_to_path(
        "command-note".to_string(),
        &path,
        "stale local draft".to_string(),
        stale.revision,
    )
    .expect("stale command save returns a typed result");

    assert_eq!(
        result,
        NoteSaveResult::Conflict {
            current: Some(NoteConflictSnapshot {
                content: external_content.to_string(),
                revision: content_revision(external_content).to_string(),
            }),
        }
    );
    assert_eq!(
        fs::read_to_string(&path).expect("read file after command conflict"),
        external_content
    );
}

#[test]
fn command_save_after_deletion_returns_missing_conflict_without_recreating_file() {
    let directory = TestDirectory::new("command-deleted-save");
    let path = directory.note_path("command-note.md");
    fs::write(&path, "deleted elsewhere").expect("write initial command note");
    let deleted = read_note_from_path("command-note".to_string(), &path)
        .expect("command reads note before deletion");
    fs::remove_file(&path).expect("delete command note externally");

    let result = save_note_to_path(
        "command-note".to_string(),
        &path,
        "stale local draft".to_string(),
        deleted.revision,
    )
    .expect("command save after deletion returns a typed result");

    assert_eq!(result, NoteSaveResult::Conflict { current: None });
    assert!(!path.exists());
}

#[test]
fn note_read_contract_exposes_the_revision_used_by_the_next_save() {
    let directory = TestDirectory::new("note-read-contract");
    let path = directory.note_path("Plan.md");
    fs::write(&path, "# Plan\n\nOriginal").expect("write note");

    let note = read_note_from_path("Plan".to_string(), &path).expect("read note contract");

    assert_eq!(note.content, "# Plan\n\nOriginal");
    assert_eq!(note.revision, content_revision(&note.content).to_string());
}

#[test]
fn note_save_contract_returns_a_new_revision_after_atomic_save() {
    let directory = TestDirectory::new("note-save-contract");
    let path = directory.note_path("Plan.md");
    fs::write(&path, "# Plan\n\nOriginal").expect("write note");
    let expected_revision = content_revision("# Plan\n\nOriginal").to_string();

    let result = save_note_to_path(
        "Plan".to_string(),
        &path,
        "# Plan\n\nWindow A".to_string(),
        expected_revision,
    )
    .expect("save note contract");

    let NoteSaveResult::Saved { note } = result else {
        panic!("current revision must save");
    };
    assert_eq!(note.content, "# Plan\n\nWindow A");
    assert_eq!(note.revision, content_revision(&note.content).to_string());
    assert_eq!(fs::read_to_string(path).unwrap(), note.content);
}

#[test]
fn note_save_contract_returns_remote_snapshot_instead_of_overwriting() {
    let directory = TestDirectory::new("note-save-conflict-contract");
    let path = directory.note_path("Plan.md");
    fs::write(&path, "# Plan\n\nOriginal").expect("write note");
    let stale_revision = content_revision("# Plan\n\nOriginal").to_string();
    fs::write(&path, "# Plan\n\nWindow B").expect("write remote update");

    let result = save_note_to_path(
        "Plan".to_string(),
        &path,
        "# Plan\n\nStale window A draft".to_string(),
        stale_revision,
    )
    .expect("conflict is typed");

    assert_eq!(
        result,
        NoteSaveResult::Conflict {
            current: Some(NoteConflictSnapshot {
                content: "# Plan\n\nWindow B".to_string(),
                revision: content_revision("# Plan\n\nWindow B").to_string(),
            }),
        }
    );
    assert_eq!(fs::read_to_string(path).unwrap(), "# Plan\n\nWindow B");
}

#[test]
fn standalone_read_and_save_use_the_same_revision_conflict_contract() {
    let directory = TestDirectory::new("standalone-save-contract");
    let path = directory.note_path("External.md");
    fs::write(&path, "# External\n\nOriginal").expect("write standalone note");
    let loaded = read_file_content_from_path(&path).expect("read standalone note");
    fs::write(&path, "# External\n\nChanged outside Scratch").expect("write external update");

    let result = save_file_content_to_path(
        &path,
        "# External\n\nStale Scratch draft".to_string(),
        loaded.revision,
    )
    .expect("standalone conflict is typed");

    assert_eq!(
        result,
        FileSaveResult::Conflict {
            current: Some(NoteConflictSnapshot {
                content: "# External\n\nChanged outside Scratch".to_string(),
                revision: content_revision("# External\n\nChanged outside Scratch").to_string(),
            }),
        }
    );
    assert_eq!(
        fs::read_to_string(path).unwrap(),
        "# External\n\nChanged outside Scratch"
    );
}

#[test]
fn standalone_recreate_create_only_returns_saved_file_and_revision() {
    let directory = TestDirectory::new("standalone-recreate");
    let path = directory.note_path("Deleted.md");
    let draft = "# Deleted\n\nRecovered local draft";

    let result = recreate_file_content_to_path(&path, draft.to_string())
        .expect("create-only recreation returns a typed result");

    assert_eq!(
        result,
        FileSaveResult::Saved {
            file: crate::FileContent {
                path: path.to_string_lossy().into_owned(),
                content: draft.to_string(),
                title: "Deleted".to_string(),
                modified: fs::metadata(&path)
                    .unwrap()
                    .modified()
                    .unwrap()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs() as i64,
                revision: content_revision(draft).to_string(),
            }
        }
    );
    assert_eq!(fs::read_to_string(path).unwrap(), draft);
}

#[test]
fn simultaneous_standalone_recreate_has_one_winner_and_never_overwrites_it() {
    let directory = TestDirectory::new("standalone-recreate-race");
    let path = directory.note_path("Deleted.md");
    let start = Arc::new(Barrier::new(3));

    let first_path = path.clone();
    let first_start = Arc::clone(&start);
    let first = std::thread::spawn(move || {
        first_start.wait();
        recreate_file_content_to_path(&first_path, "draft from window one".to_string())
            .expect("first recreation returns a typed result")
    });

    let second_path = path.clone();
    let second_start = Arc::clone(&start);
    let second = std::thread::spawn(move || {
        second_start.wait();
        recreate_file_content_to_path(&second_path, "draft from window two".to_string())
            .expect("second recreation returns a typed result")
    });

    start.wait();
    let results = [first.join().unwrap(), second.join().unwrap()];
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, FileSaveResult::Saved { .. }))
            .count(),
        1
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, FileSaveResult::Conflict { .. }))
            .count(),
        1
    );

    let persisted = fs::read_to_string(&path).unwrap();
    let saved = results
        .iter()
        .find_map(|result| match result {
            FileSaveResult::Saved { file } => Some(file),
            FileSaveResult::Conflict { .. } => None,
        })
        .unwrap();
    let conflict = results
        .iter()
        .find_map(|result| match result {
            FileSaveResult::Conflict {
                current: Some(current),
            } => Some(current),
            _ => None,
        })
        .unwrap();

    assert_eq!(persisted, saved.content);
    assert_eq!(conflict.content, saved.content);
    assert_eq!(conflict.revision, saved.revision);
}

#[test]
fn deleted_preview_path_uses_canonical_parent_and_rejects_traversal() {
    let directory = TestDirectory::new("standalone-recreate-path");
    let missing = directory.note_path("Deleted.markdown");

    let validated = validate_preview_create_path(&missing.to_string_lossy())
        .expect("missing Markdown path with existing parent is valid");

    assert_eq!(
        validated,
        directory
            .path
            .canonicalize()
            .unwrap()
            .join("Deleted.markdown")
    );
    assert!(!validated.exists());

    let nested = directory.path.join("nested");
    fs::create_dir(&nested).unwrap();
    let traversal = nested.join("..").join("Escaped.md");
    assert!(validate_preview_create_path(&traversal.to_string_lossy()).is_err());
    assert!(validate_preview_create_path(
        &directory.note_path("NotMarkdown.txt").to_string_lossy()
    )
    .is_err());
}

#[test]
fn recovery_snapshot_preserves_the_exact_dirty_markdown_in_a_hidden_store() {
    let directory = TestDirectory::new("recovery-snapshot");
    let dirty_markdown = "# Plan\n\n- [x] local task\n\n[link](other.md)\n";

    let recovery_path = write_recovery_snapshot(
        &directory.path,
        "folder/Plan",
        "/notes/folder/Plan.md",
        dirty_markdown,
        "save-conflict",
    )
    .expect("persist recovery snapshot");

    assert!(recovery_path.starts_with(directory.path.join("recovery")));
    assert_eq!(fs::read_to_string(&recovery_path).unwrap(), dirty_markdown);
    assert_eq!(
        recovery_path
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("md")
    );
}

#[test]
fn repeated_recovery_snapshots_never_replace_an_earlier_draft() {
    let directory = TestDirectory::new("unique-recovery-snapshot");

    let first = write_recovery_snapshot(
        &directory.path,
        "Plan",
        "/notes/Plan.md",
        "first draft",
        "window-close",
    )
    .unwrap();
    let second = write_recovery_snapshot(
        &directory.path,
        "Plan",
        "/notes/Plan.md",
        "second draft",
        "window-close",
    )
    .unwrap();

    assert_ne!(first, second);
    assert_eq!(fs::read_to_string(first).unwrap(), "first draft");
    assert_eq!(fs::read_to_string(second).unwrap(), "second draft");
}

#[test]
fn recovery_snapshot_retries_collisions_and_uses_the_successful_stem_for_metadata() {
    let directory = TestDirectory::new("recovery-collision-retry");
    let mut sequence = 40_u64;
    let mut markdown_attempts = 0_usize;
    let mut written_paths = Vec::new();

    let recovery_path = write_recovery_snapshot_with(
        RecoverySnapshotRequest {
            recovery_root: &directory.path,
            note_id: "Plan",
            source_path: "/notes/Plan.md",
            content: "dirty draft",
            reason: "window-close",
            timestamp: 123_456,
            process_id: 987,
        },
        || {
            let current = sequence;
            sequence += 1;
            current
        },
        |path, content| {
            written_paths.push(path.to_path_buf());
            if path.extension().and_then(|value| value.to_str()) == Some("md") {
                markdown_attempts += 1;
                if markdown_attempts <= 3 {
                    return Ok(SaveResult::Conflict { current: None });
                }
            }
            Ok(SaveResult::Saved {
                revision: content_revision(content),
            })
        },
    )
    .expect("retry recovery collision");

    assert_eq!(markdown_attempts, 4);
    assert!(recovery_path
        .file_stem()
        .and_then(|value| value.to_str())
        .is_some_and(|stem| stem.contains("123456-987-43-window-close-Plan")));
    let metadata_path = written_paths
        .iter()
        .find(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .expect("metadata write path");
    assert_eq!(metadata_path.file_stem(), recovery_path.file_stem());
}

#[test]
fn recovery_snapshot_reports_collision_retry_exhaustion() {
    let directory = TestDirectory::new("recovery-collision-exhaustion");
    let mut attempts = 0_usize;

    let error = write_recovery_snapshot_with(
        RecoverySnapshotRequest {
            recovery_root: &directory.path,
            note_id: "Plan",
            source_path: "/notes/Plan.md",
            content: "dirty draft",
            reason: "window-close",
            timestamp: 123_456,
            process_id: 987,
        },
        || 0,
        |_path, _content| {
            attempts += 1;
            Ok(SaveResult::Conflict { current: None })
        },
    )
    .expect_err("collision exhaustion must fail");

    assert_eq!(attempts, MAX_RECOVERY_NAME_ATTEMPTS);
    assert!(error.contains("collision"));
}

#[test]
fn recovery_snapshot_returns_non_conflict_persistence_errors_immediately() {
    let directory = TestDirectory::new("recovery-persistence-error");
    let mut attempts = 0_usize;

    let error = write_recovery_snapshot_with(
        RecoverySnapshotRequest {
            recovery_root: &directory.path,
            note_id: "Plan",
            source_path: "/notes/Plan.md",
            content: "dirty draft",
            reason: "window-close",
            timestamp: 123_456,
            process_id: 987,
        },
        || 0,
        |_path, _content| {
            attempts += 1;
            Err("disk failure".to_string())
        },
    )
    .expect_err("persistence failure must surface");

    assert_eq!(attempts, 1);
    assert_eq!(error, "disk failure");
}
