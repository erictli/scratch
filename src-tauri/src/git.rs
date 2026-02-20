use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

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
    Command::new("git")
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
    let output = Command::new("git")
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
        ..Default::default()
    };

    // Get current branch
    if let Ok(output) = Command::new("git")
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
    if let Ok(output) = Command::new("git")
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
    if let Ok(output) = Command::new("git")
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
        match Command::new("git")
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

/// Stage all changes and commit
pub fn commit_all(path: &Path, message: &str) -> GitResult {
    // Stage all changes
    let stage_output = match Command::new("git")
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
    let commit_output = Command::new("git")
        .args(["commit", "-m", message])
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
    let output = Command::new("git")
        .args(["push"])
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
    let output = Command::new("git")
        .args(["fetch", "--quiet"])
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
    let output = Command::new("git")
        .args(["pull"])
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

    Command::new("git")
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

    let output = Command::new("git")
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

/// Push to remote and set upstream tracking (git push -u origin <branch>)
pub fn push_with_upstream(path: &Path, branch: &str) -> GitResult {
    let output = Command::new("git")
        .args(["push", "-u", "origin", branch])
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

/// Basic validation for git remote URLs
fn is_valid_remote_url(url: &str) -> bool {
    let url = url.trim();
    // SSH format: git@github.com:user/repo.git
    // HTTPS format: https://github.com/user/repo.git
    url.starts_with("git@") || url.starts_with("https://") || url.starts_with("http://")
}

/// Parse git pull errors into user-friendly messages
fn parse_pull_error(stderr: &str) -> String {
    if stderr.contains("CONFLICT") || stderr.contains("Merge conflict") {
        "Pull failed due to merge conflicts. Resolve conflicts manually.".to_string()
    } else if stderr.contains("Permission denied") || stderr.contains("publickey") {
        "Authentication failed. Check your SSH keys or credentials.".to_string()
    } else if stderr.contains("Could not resolve host") {
        "Could not connect to remote. Check your internet connection.".to_string()
    } else if stderr.contains("not possible to fast-forward") {
        "Pull failed: local and remote have diverged. Try pulling with rebase or merging manually.".to_string()
    } else {
        stderr.trim().to_string()
    }
}

/// Parse git push errors into user-friendly messages
fn parse_push_error(stderr: &str) -> String {
    if stderr.contains("Permission denied") || stderr.contains("publickey") {
        "Authentication failed. Check your SSH keys or credentials.".to_string()
    } else if stderr.contains("Repository not found") || stderr.contains("does not exist") {
        "Remote repository not found. Check the URL.".to_string()
    } else if stderr.contains("Could not resolve host") {
        "Could not connect to remote. Check your internet connection.".to_string()
    } else {
        stderr.trim().to_string()
    }
}
