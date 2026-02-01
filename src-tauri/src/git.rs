use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub has_remote: bool,
    pub has_upstream: bool, // Whether the current branch tracks an upstream
    pub changed_count: usize,
    pub ahead_count: i32, // -1 if no upstream tracking
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

    // Get ahead count if we have a remote
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
                        status.ahead_count = parts[1].parse().unwrap_or(0);
                    }
                } else {
                    // Command failed - likely no upstream configured
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    if stderr.contains("no upstream") || stderr.contains("unknown revision") {
                        status.has_upstream = false;
                        status.ahead_count = -1; // Sentinel value indicating no upstream
                    }
                }
            }
            Err(_) => {
                status.has_upstream = false;
                status.ahead_count = -1;
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
                    error: Some(String::from_utf8_lossy(&output.stderr).to_string()),
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
