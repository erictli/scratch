use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeResult {
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
    pub session_url: Option<String>,
}

/// Check if the `claude` CLI is available
pub fn is_available() -> bool {
    Command::new("claude")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Run Claude Code to edit a note file based on a user prompt
pub fn edit_note(note_path: &Path, prompt: &str) -> ClaudeResult {
    let full_prompt = format!(
        "Edit the file at {}. Here is what the user wants: {}",
        note_path.display(),
        prompt
    );

    let output = Command::new("claude")
        .args([
            "-p",
            &full_prompt,
            "--allowedTools",
            "Edit,Read,Write",
        ])
        .output();

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            // Try to extract session URL from output
            let session_url = extract_session_url(&stdout)
                .or_else(|| extract_session_url(&stderr));

            if output.status.success() {
                ClaudeResult {
                    success: true,
                    output: if stdout.is_empty() { None } else { Some(stdout) },
                    error: None,
                    session_url,
                }
            } else {
                ClaudeResult {
                    success: false,
                    output: if stdout.is_empty() { None } else { Some(stdout) },
                    error: Some(if stderr.is_empty() {
                        "Claude Code exited with an error".to_string()
                    } else {
                        stderr
                    }),
                    session_url,
                }
            }
        }
        Err(e) => ClaudeResult {
            success: false,
            output: None,
            error: Some(format!("Failed to run claude: {}", e)),
            session_url: None,
        },
    }
}

/// Extract a Claude session URL from output text
fn extract_session_url(text: &str) -> Option<String> {
    text.lines()
        .find(|line| line.contains("claude.ai/") && line.contains("session"))
        .map(|line| {
            // Extract just the URL part
            if let Some(start) = line.find("https://") {
                line[start..].split_whitespace().next().unwrap_or(line).to_string()
            } else {
                line.trim().to_string()
            }
        })
}
