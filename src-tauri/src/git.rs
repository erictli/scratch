use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// Create a `Command` for git that hides the console window on Windows.
fn git_cmd() -> Command {
    let cmd = Command::new("git");
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub has_remote: bool,
    pub has_upstream: bool, // Whether the current branch tracks an upstream
    pub remote_url: Option<String>, // URL of the 'origin' remote
    pub changed_count: usize,
    pub ahead_count: i32, // -1 if no upstream tracking
    pub behind_count: i32, // -1 if no upstream tracking
    pub current_branch: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitResult {
    pub success: bool,
    pub message: Option<String>,
    pub error: Option<String>,
}

/// Check if git CLI is available
pub fn is_available() -> bool {
    git_cmd()
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check if a directory is a git repository
pub fn is_git_repo(path: &Path) -> bool {
    path.join(".git").exists()
}

/// Initialize a git repository
pub fn git_init(path: &Path) -> Result<(), String> {
    let output = git_cmd()
        .arg("init")
        .current_dir(path)
        .output()
        .map_err(|e| format!("Failed to run git init: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Get the current git status
pub fn get_status(path: &Path) -> GitStatus {
    if !is_git_repo(path) {
        return GitStatus::default();
    }

    let mut status = GitStatus {
        is_repo: true,
        ahead_count: -1,
        behind_count: -1,
        ..Default::default()
    };

    // Get current branch
    if let Ok(output) = git_cmd()
        .args(["branch", "--show-current"])
        .current_dir(path)
        .output()
    {
        if output.status.success() {
            let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !branch.is_empty() {
                status.current_branch = Some(branch);
            }
        }
    }

    // Check for remote
    if let Ok(output) = git_cmd()
        .args(["remote"])
        .current_dir(path)
        .output()
    {
        status.has_remote = output.status.success()
            && !String::from_utf8_lossy(&output.stdout).trim().is_empty();

        // Get remote URL if remote exists
        if status.has_remote {
            status.remote_url = get_remote_url(path);
        }
    }

    // Get status with porcelain format for easy parsing
    if let Ok(output) = git_cmd()
        .args(["status", "--porcelain"])
        .current_dir(path)
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            status.changed_count = stdout.lines().filter(|line| !line.is_empty()).count();
        }
    }

    // Get ahead/behind count if we have a remote
    if status.has_remote && status.current_branch.is_some() {
        match git_cmd()
            .args(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])
            .current_dir(path)
            .output()
        {
            Ok(output) => {
                if output.status.success() {
                    status.has_upstream = true;
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let parts: Vec<&str> = stdout.trim().split('\t').collect();
                    if parts.len() == 2 {
                        // parts[0] is behind count, parts[1] is ahead count
                        status.behind_count = parts[0].parse().unwrap_or(0);
                        status.ahead_count = parts[1].parse().unwrap_or(0);
                    }
                } else {
                    // Command failed - likely no upstream configured
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    if stderr.contains("no upstream") || stderr.contains("unknown revision") {
                        status.has_upstream = false;
                        status.ahead_count = -1; // Sentinel value indicating no upstream
                        status.behind_count = -1;
                    }
                }
            }
            Err(_) => {
                status.has_upstream = false;
                status.ahead_count = -1;
                status.behind_count = -1;
            }
        }
    }

    status
}

/// Build a descriptive commit message from the changed files.
/// Returns something like "Update API Credentials, Clé API" or "Add Meeting Notes".
pub fn build_commit_message(path: &Path) -> String {
    // Get staged + unstaged changes (before staging)
    let output = git_cmd()
        .args(["-c", "core.quotepath=false", "status", "--porcelain"])
        .current_dir(path)
        .output();

    let stdout = match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => return "Quick commit from Scratch".to_string(),
    };

    let mut added: Vec<String> = Vec::new();
    let mut modified: Vec<String> = Vec::new();
    let mut deleted: Vec<String> = Vec::new();

    for line in stdout.lines() {
        if let Some((kind, name)) = parse_commit_message_status_line(line) {
            match kind {
                CommitMessageChangeKind::Added => added.push(name),
                CommitMessageChangeKind::Deleted => deleted.push(name),
                CommitMessageChangeKind::Modified => modified.push(name),
            }
        }
    }

    let mut parts: Vec<String> = Vec::new();

    if !modified.is_empty() {
        let names = truncate_names(&modified, 3);
        parts.push(format!("Update {names}"));
    }
    if !added.is_empty() {
        let names = truncate_names(&added, 3);
        parts.push(format!("Add {names}"));
    }
    if !deleted.is_empty() {
        let names = truncate_names(&deleted, 3);
        parts.push(format!("Delete {names}"));
    }

    if parts.is_empty() {
        "Quick commit from Scratch".to_string()
    } else {
        parts.join(", ")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommitMessageChangeKind {
    Added,
    Modified,
    Deleted,
}

fn parse_commit_message_status_line(line: &str) -> Option<(CommitMessageChangeKind, String)> {
    if line.len() < 4 {
        return None;
    }

    let status = &line[..2];
    let raw_file = line[3..].trim_matches('"');
    let file = raw_file.rsplit(" -> ").next().unwrap_or(raw_file);

    if !file.ends_with(".md") {
        return None;
    }

    let name = file
        .rsplit('/')
        .next()
        .unwrap_or(file)
        .trim_end_matches(".md")
        .to_string();

    let kind = match status.trim() {
        "?" | "??" | "A" => CommitMessageChangeKind::Added,
        "D" => CommitMessageChangeKind::Deleted,
        _ => CommitMessageChangeKind::Modified,
    };

    Some((kind, name))
}

/// Join names with a limit, adding "+N more" if truncated.
fn truncate_names(names: &[String], max: usize) -> String {
    if names.len() <= max {
        names.join(", ")
    } else {
        let shown: Vec<&str> = names[..max].iter().map(|s| s.as_str()).collect();
        format!("{} +{} more", shown.join(", "), names.len() - max)
    }
}

/// Stage all changes and commit
pub fn commit_all(path: &Path, message: &str) -> GitResult {
    // Build descriptive message BEFORE staging (needs unstaged status)
    let final_message = if message == "Quick commit from Scratch" {
        build_commit_message(path)
    } else {
        message.to_string()
    };

    // Stage all changes
    let stage_output = match git_cmd()
        .args(["add", "-A"])
        .current_dir(path)
        .output()
    {
        Ok(output) => output,
        Err(e) => {
            return GitResult {
                success: false,
                message: None,
                error: Some(format!("Failed to run git add: {}", e)),
            };
        }
    };

    // Check if staging succeeded
    if !stage_output.status.success() {
        let stderr = String::from_utf8_lossy(&stage_output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&stage_output.stdout).to_string();
        return GitResult {
            success: false,
            message: None,
            error: Some(format!(
                "Failed to stage changes: {}{}",
                stderr,
                if stdout.is_empty() { String::new() } else { format!("\n{}", stdout) }
            )),
        };
    }

    // Commit
    let commit_output = git_cmd()
        .args(["commit", "-m", &final_message])
        .current_dir(path)
        .output();

    match commit_output {
        Ok(output) => {
            if output.status.success() {
                GitResult {
                    success: true,
                    message: Some("Changes committed".to_string()),
                    error: None,
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                // "nothing to commit" is not really an error
                if stderr.contains("nothing to commit") {
                    GitResult {
                        success: true,
                        message: Some("Nothing to commit".to_string()),
                        error: None,
                    }
                } else {
                    GitResult {
                        success: false,
                        message: None,
                        error: Some(stderr),
                    }
                }
            }
        }
        Err(e) => GitResult {
            success: false,
            message: None,
            error: Some(format!("Failed to commit: {}", e)),
        },
    }
}

/// Push to remote
pub fn push(path: &Path) -> GitResult {
    let output = git_cmd()
        .args(["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=10", "push"])
        .env("GIT_SSH_COMMAND", "ssh -o ConnectTimeout=10")
        .current_dir(path)
        .output();

    match output {
        Ok(output) => {
            if output.status.success() {
                GitResult {
                    success: true,
                    message: Some("Pushed successfully".to_string()),
                    error: None,
                }
            } else {
                GitResult {
                    success: false,
                    message: None,
                    error: Some(parse_push_error(&String::from_utf8_lossy(&output.stderr))),
                }
            }
        }
        Err(e) => GitResult {
            success: false,
            message: None,
            error: Some(format!("Failed to push: {}", e)),
        },
    }
}

/// Fetch from remote to update tracking refs
pub fn fetch(path: &Path) -> GitResult {
    let output = git_cmd()
        .args(["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=10", "fetch", "--quiet"])
        .env("GIT_SSH_COMMAND", "ssh -o ConnectTimeout=10")
        .current_dir(path)
        .output();

    match output {
        Ok(output) => {
            if output.status.success() {
                GitResult {
                    success: true,
                    message: Some("Fetched successfully".to_string()),
                    error: None,
                }
            } else {
                GitResult {
                    success: false,
                    message: None,
                    error: Some(parse_pull_error(&String::from_utf8_lossy(&output.stderr))),
                }
            }
        }
        Err(e) => GitResult {
            success: false,
            message: None,
            error: Some(format!("Failed to fetch: {}", e)),
        },
    }
}

/// Pull from remote
pub fn pull(path: &Path) -> GitResult {
    let output = git_cmd()
        .args(["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=10", "-c", "pull.rebase=false", "pull"])
        .env("GIT_SSH_COMMAND", "ssh -o ConnectTimeout=10")
        .current_dir(path)
        .output();

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if output.status.success() {
                let message = if stdout.contains("Already up to date") {
                    "Already up to date"
                } else {
                    "Pulled latest changes"
                };
                GitResult {
                    success: true,
                    message: Some(message.to_string()),
                    error: None,
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let combined = format!("{}{}", stdout, stderr);
                GitResult {
                    success: false,
                    message: None,
                    error: Some(parse_pull_error(&combined)),
                }
            }
        }
        Err(e) => GitResult {
            success: false,
            message: None,
            error: Some(format!("Failed to pull: {}", e)),
        },
    }
}

/// Get the URL of the 'origin' remote, if configured
pub fn get_remote_url(path: &Path) -> Option<String> {
    if !is_git_repo(path) {
        return None;
    }

    git_cmd()
        .args(["remote", "get-url", "origin"])
        .current_dir(path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// Add a remote named 'origin' with the given URL
pub fn add_remote(path: &Path, url: &str) -> GitResult {
    // Validate URL format (basic check)
    if !is_valid_remote_url(url) {
        return GitResult {
            success: false,
            message: None,
            error: Some("Invalid remote URL format. URL must start with https://, http://, or git@".to_string()),
        };
    }

    let output = git_cmd()
        .args(["remote", "add", "origin", url])
        .current_dir(path)
        .output();

    match output {
        Ok(output) => {
            if output.status.success() {
                GitResult {
                    success: true,
                    message: Some("Remote added successfully".to_string()),
                    error: None,
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                // Handle common case: remote already exists
                if stderr.contains("already exists") {
                    GitResult {
                        success: false,
                        message: None,
                        error: Some("Remote 'origin' already exists".to_string()),
                    }
                } else {
                    GitResult {
                        success: false,
                        message: None,
                        error: Some(stderr),
                    }
                }
            }
        }
        Err(e) => GitResult {
            success: false,
            message: None,
            error: Some(format!("Failed to add remote: {}", e)),
        },
    }
}

/// Update the URL of the existing 'origin' remote
pub fn set_remote_url(path: &Path, url: &str) -> GitResult {
    let normalized = url.trim();
    if !is_valid_remote_url(normalized) {
        return GitResult {
            success: false,
            message: None,
            error: Some("Invalid remote URL format. URL must start with https://, http://, or git@".to_string()),
        };
    }

    let output = git_cmd()
        .args(["remote", "set-url", "origin", normalized])
        .current_dir(path)
        .output();

    match output {
        Ok(output) => {
            if output.status.success() {
                GitResult {
                    success: true,
                    message: Some("Remote URL updated".to_string()),
                    error: None,
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                if stderr.contains("No such remote") {
                    GitResult {
                        success: false,
                        message: None,
                        error: Some("No 'origin' remote configured".to_string()),
                    }
                } else {
                    GitResult {
                        success: false,
                        message: None,
                        error: Some(stderr.trim().to_string()),
                    }
                }
            }
        }
        Err(e) => GitResult {
            success: false,
            message: None,
            error: Some(format!("Failed to update remote: {}", e)),
        },
    }
}

/// Remove the 'origin' remote
pub fn remove_remote(path: &Path) -> GitResult {
    let output = git_cmd()
        .args(["remote", "remove", "origin"])
        .current_dir(path)
        .output();

    match output {
        Ok(output) => {
            if output.status.success() {
                GitResult {
                    success: true,
                    message: Some("Remote removed".to_string()),
                    error: None,
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                // Removing an already-missing 'origin' is idempotent — converge on "not connected".
                if stderr.contains("No such remote") {
                    GitResult {
                        success: true,
                        message: None,
                        error: None,
                    }
                } else {
                    GitResult {
                        success: false,
                        message: None,
                        error: Some(stderr.trim().to_string()),
                    }
                }
            }
        }
        Err(e) => GitResult {
            success: false,
            message: None,
            error: Some(format!("Failed to remove remote: {}", e)),
        },
    }
}

/// Push to remote and set upstream tracking (git push -u origin <branch>)
pub fn push_with_upstream(path: &Path, branch: &str) -> GitResult {
    let output = git_cmd()
        .args(["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=10", "push", "-u", "origin", branch])
        .env("GIT_SSH_COMMAND", "ssh -o ConnectTimeout=10")
        .current_dir(path)
        .output();

    match output {
        Ok(output) => {
            if output.status.success() {
                GitResult {
                    success: true,
                    message: Some(format!("Pushed and tracking origin/{}", branch)),
                    error: None,
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                GitResult {
                    success: false,
                    message: None,
                    error: Some(parse_push_error(&stderr)),
                }
            }
        }
        Err(e) => GitResult {
            success: false,
            message: None,
            error: Some(format!("Failed to push: {}", e)),
        },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub commit: String,
    pub author: String,
    pub date: i64,
    pub message: String,
    pub file_path: String,
}

/// Get the git commit history for a specific file.
/// If the file has no history under its current name (e.g. it was renamed),
/// we detect the original name via git's rename detection and retry.
pub fn get_file_history(path: &Path, file_relative_path: &str) -> Result<Vec<FileVersion>, String> {
    if !is_git_repo(path) {
        return Ok(vec![]);
    }

    // Try with the current path first
    let versions = git_log_follow(path, file_relative_path)?;
    if !versions.is_empty() {
        return Ok(versions);
    }

    // No history found — the file may have been renamed on disk but not yet committed.
    // Use git's rename detection to find the original tracked name.
    if let Some(original) = detect_original_path(path, file_relative_path) {
        return git_log_follow(path, &original);
    }

    Ok(vec![])
}

/// Run `git log --follow --name-only` and parse the output into FileVersions.
fn git_log_follow(path: &Path, file_relative_path: &str) -> Result<Vec<FileVersion>, String> {
    let output = git_cmd()
        .args([
            "-c", "core.quotepath=false",
            "log",
            "-50",
            "-z",
            "--pretty=tformat:COMMIT%x00%H%x00%an%x00%at%x00%s%x00",
            "--follow",
            "--name-only",
            "--",
            file_relative_path,
        ])
        .current_dir(path)
        .output()
        .map_err(|e| format!("Failed to run git log: {e}"))?;

    if !output.status.success() {
        return Ok(vec![]);
    }

    Ok(parse_git_log_follow_output(&output.stdout, file_relative_path))
}

fn parse_git_log_follow_output(stdout: &[u8], fallback_path: &str) -> Vec<FileVersion> {
    let stdout = String::from_utf8_lossy(stdout);
    let mut versions = Vec::new();
    let tokens: Vec<&str> = stdout.split('\0').collect();
    let mut i = 0;

    while i < tokens.len() {
        let token = tokens[i].trim_start_matches('\n');
        if token.is_empty() {
            i += 1;
            continue;
        }
        if token != "COMMIT" {
            i += 1;
            continue;
        }
        if i + 4 >= tokens.len() {
            break;
        }

        let commit = tokens[i + 1].to_string();
        let author = tokens[i + 2].to_string();
        let date = tokens[i + 3].parse().unwrap_or(0);
        let message = tokens[i + 4].to_string();
        i += 5;

        let mut file_path = fallback_path.to_string();
        while i < tokens.len() {
            let token = tokens[i].trim_start_matches('\n');
            if token.is_empty() {
                i += 1;
                continue;
            }
            if token == "COMMIT" {
                break;
            }
            file_path = token.to_string();
            i += 1;
            break;
        }

        versions.push(FileVersion {
            commit,
            author,
            date,
            message,
            file_path,
        });
    }

    versions
}

/// Detect if a file on disk is a rename of a tracked file.
/// Uses a temporary index (via GIT_INDEX_FILE) so the user's real staging area
/// is never modified.
fn detect_original_path(path: &Path, file_relative_path: &str) -> Option<String> {
    // Find files tracked in HEAD that are missing on disk (potential rename sources)
    let ls_output = git_cmd()
        .args(["-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=D", "HEAD"])
        .current_dir(path)
        .output()
        .ok()?;

    let deleted_stdout = String::from_utf8_lossy(&ls_output.stdout).to_string();
    let deleted_paths: Vec<&str> = deleted_stdout
        .lines()
        .filter(|l| !l.is_empty())
        .collect();

    if deleted_paths.is_empty() {
        return None;
    }

    // Resolve the actual git dir (supports linked worktrees where .git is a file)
    let git_dir_output = git_cmd()
        .args(["rev-parse", "--git-dir"])
        .current_dir(path)
        .output()
        .ok()?;
    if !git_dir_output.status.success() {
        return None;
    }
    let git_dir = Path::new(
        String::from_utf8_lossy(&git_dir_output.stdout).trim(),
    ).to_path_buf();
    // Resolve relative paths (git rev-parse may return relative like ".git")
    let git_dir = if git_dir.is_relative() { path.join(&git_dir) } else { git_dir };

    // Create a temporary index seeded from HEAD so we never touch the real index.
    // Use a unique name to avoid corruption from concurrent calls.
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp_index = git_dir.join(format!("index.detect_rename.{nonce}.tmp"));
    let seed_ok = git_cmd()
        .args(["read-tree", "HEAD"])
        .env("GIT_INDEX_FILE", &tmp_index)
        .current_dir(path)
        .output()
        .ok()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !seed_ok {
        let _ = std::fs::remove_file(&tmp_index);
        return None;
    }

    // Helper closure: all remaining git commands use the temp index
    let result = (|| -> Option<String> {
        // Stage the new file in the temp index
        let add_ok = git_cmd()
            .args(["add", file_relative_path])
            .env("GIT_INDEX_FILE", &tmp_index)
            .current_dir(path)
            .output()
            .ok()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if !add_ok {
            return None;
        }

        // Stage deletions of missing tracked files so git sees them as paired with the add
        for deleted in &deleted_paths {
            let _ = git_cmd()
                .args(["rm", "--cached", "--quiet", deleted])
                .env("GIT_INDEX_FILE", &tmp_index)
                .current_dir(path)
                .output();
        }

        // Run rename detection against HEAD using the temp index
        let diff_output = git_cmd()
            .args([
                "-c", "core.quotepath=false",
                "diff", "--cached", "--name-status", "-M", "HEAD",
            ])
            .env("GIT_INDEX_FILE", &tmp_index)
            .current_dir(path)
            .output()
            .ok()?;

        if !diff_output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&diff_output.stdout);
        for line in stdout.lines() {
            // Format: R<score>\t<old_path>\t<new_path>
            if line.starts_with('R') {
                let parts: Vec<&str> = line.split('\t').collect();
                if parts.len() == 3 && parts[2] == file_relative_path {
                    return Some(parts[1].to_string());
                }
            }
        }

        None
    })();

    // Always clean up the temp index
    let _ = std::fs::remove_file(&tmp_index);

    result
}

/// Get the content of a file at a specific commit
pub fn get_file_at_commit(path: &Path, commit: &str, file_relative_path: &str) -> Result<String, String> {
    // Validate commit hash (only hex chars, 7-40 length)
    if !commit.chars().all(|c| c.is_ascii_hexdigit()) || commit.len() < 7 || commit.len() > 40 {
        return Err("Invalid commit hash".to_string());
    }

    let file_spec = format!("{commit}:{file_relative_path}");
    let output = git_cmd()
        .args(["show", &file_spec])
        .current_dir(path)
        .output()
        .map_err(|e| format!("Failed to run git show: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Basic validation for git remote URLs
fn is_valid_remote_url(url: &str) -> bool {
    let url = url.trim();
    // SSH format: git@github.com:user/repo.git
    // HTTPS format: https://github.com/user/repo.git
    url.starts_with("git@") || url.starts_with("https://") || url.starts_with("http://")
}

/// Parse common remote errors (auth, network) shared by push/pull/fetch
fn parse_remote_error(stderr: &str) -> Option<String> {
    if stderr.contains("Permission denied") || stderr.contains("publickey") {
        Some("Authentication failed. Check your SSH keys or credentials.".to_string())
    } else if stderr.contains("Could not resolve host") {
        Some("Could not connect to remote. Check your internet connection.".to_string())
    } else {
        None
    }
}

/// Parse git pull errors into user-friendly messages
fn parse_pull_error(stderr: &str) -> String {
    if let Some(msg) = parse_remote_error(stderr) {
        msg
    } else if stderr.contains("local changes") || stderr.contains("unstaged changes") {
        "Commit your changes before syncing with remote.".to_string()
    } else if stderr.contains("CONFLICT") || stderr.contains("Merge conflict") {
        "Pull failed due to merge conflicts. Resolve conflicts manually.".to_string()
    } else if stderr.contains("not possible to fast-forward") {
        "Pull failed: local and remote have diverged. Try pulling with rebase or merging manually.".to_string()
    } else if stderr.contains("unrelated histories") {
        "Pull failed: repositories have unrelated histories. Merge them manually or re-run with --allow-unrelated-histories.".to_string()
    } else {
        stderr.trim().to_string()
    }
}

/// Parse git push errors into user-friendly messages
fn parse_push_error(stderr: &str) -> String {
    if let Some(msg) = parse_remote_error(stderr) {
        msg
    } else if stderr.contains("Repository not found") || stderr.contains("does not exist") {
        "Remote repository not found. Check the URL.".to_string()
    } else {
        stderr.trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_commit_message_status_line, parse_git_log_follow_output, CommitMessageChangeKind,
    };

    #[test]
    fn parse_git_log_follow_output_handles_pipes_and_rename_paths() {
        let output = concat!(
            "COMMIT\0",
            "newcommit\0",
            "A|B\0",
            "123\0",
            "rename | commit\0",
            "\0\nnew name.md\0",
            "COMMIT\0",
            "oldcommit\0",
            "A|B\0",
            "122\0",
            "initial | commit\0",
            "\0\nold name.md\0",
        );

        let versions = parse_git_log_follow_output(output.as_bytes(), "new name.md");

        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].author, "A|B");
        assert_eq!(versions[0].message, "rename | commit");
        assert_eq!(versions[0].file_path, "new name.md");
        assert_eq!(versions[1].file_path, "old name.md");
    }

    #[test]
    fn parse_git_log_follow_output_falls_back_without_losing_sync() {
        let output = concat!(
            "COMMIT\0",
            "commit1\0",
            "tester\0",
            "123\0",
            "no path emitted\0",
            "COMMIT\0",
            "commit2\0",
            "tester\0",
            "124\0",
            "with path\0",
            "\0\nold name.md\0",
        );

        let versions = parse_git_log_follow_output(output.as_bytes(), "current.md");

        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].file_path, "current.md");
        assert_eq!(versions[1].file_path, "old name.md");
    }

    #[test]
    fn parse_commit_message_status_line_uses_new_path_for_renames() {
        let parsed = parse_commit_message_status_line("R  old/alpha.md -> new/beta.md");

        assert_eq!(
            parsed,
            Some((CommitMessageChangeKind::Modified, "beta".to_string()))
        );
    }

    #[test]
    fn parse_commit_message_status_line_skips_non_markdown_files() {
        let parsed = parse_commit_message_status_line("M  src/main.rs");

        assert_eq!(parsed, None);
    }
}
