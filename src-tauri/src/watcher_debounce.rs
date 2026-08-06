use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub(crate) const WATCHER_DEBOUNCE_WINDOW: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct DebounceToken(u64);

#[derive(Debug, Default)]
pub(crate) struct WatcherDebounce {
    pending_by_path: HashMap<PathBuf, DebounceToken>,
    next_generation: u64,
}

impl WatcherDebounce {
    pub(crate) fn schedule(&mut self, path: PathBuf) -> DebounceToken {
        self.next_generation = self
            .next_generation
            .checked_add(1)
            .expect("watcher debounce generation exhausted");
        let token = DebounceToken(self.next_generation);
        self.pending_by_path.insert(path, token);
        token
    }

    pub(crate) fn take_if_latest(&mut self, path: &Path, token: DebounceToken) -> bool {
        if self.pending_by_path.get(path) != Some(&token) {
            return false;
        }

        self.pending_by_path.remove(path);
        true
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{WatcherDebounce, WATCHER_DEBOUNCE_WINDOW};

    #[test]
    fn debounce_window_is_500_milliseconds() {
        assert_eq!(WATCHER_DEBOUNCE_WINDOW.as_millis(), 500);
    }

    #[test]
    fn only_latest_event_in_a_burst_becomes_ready() {
        let mut debounce = WatcherDebounce::default();
        let path = Path::new("notes/roadmap.md");

        let first = debounce.schedule(path.to_path_buf());
        let second = debounce.schedule(path.to_path_buf());
        let third = debounce.schedule(path.to_path_buf());

        assert!(!debounce.take_if_latest(path, first));
        assert!(!debounce.take_if_latest(path, second));
        assert!(debounce.take_if_latest(path, third));
        assert!(!debounce.take_if_latest(path, third));
    }

    #[test]
    fn distinct_paths_are_debounced_independently() {
        let mut debounce = WatcherDebounce::default();
        let alpha = Path::new("notes/alpha.md");
        let beta = Path::new("notes/beta.md");

        let alpha_first = debounce.schedule(alpha.to_path_buf());
        let beta_only = debounce.schedule(beta.to_path_buf());
        let alpha_latest = debounce.schedule(alpha.to_path_buf());

        assert!(debounce.take_if_latest(beta, beta_only));
        assert!(!debounce.take_if_latest(alpha, alpha_first));
        assert!(debounce.take_if_latest(alpha, alpha_latest));
    }

    #[test]
    fn stale_event_cannot_remove_the_latest_event() {
        let mut debounce = WatcherDebounce::default();
        let path = Path::new("notes/inbox.md");

        let stale = debounce.schedule(path.to_path_buf());
        let latest = debounce.schedule(path.to_path_buf());

        assert!(!debounce.take_if_latest(path, stale));
        assert!(debounce.take_if_latest(path, latest));
    }

    #[test]
    fn pending_state_stays_bounded_and_is_cleaned_after_latest_events() {
        let mut debounce = WatcherDebounce::default();
        let alpha = Path::new("notes/alpha.md");
        let beta = Path::new("notes/beta.md");

        let mut alpha_latest = debounce.schedule(alpha.to_path_buf());
        for _ in 0..100 {
            alpha_latest = debounce.schedule(alpha.to_path_buf());
        }
        let beta_latest = debounce.schedule(beta.to_path_buf());

        assert_eq!(debounce.pending_by_path.len(), 2);
        assert!(debounce.take_if_latest(alpha, alpha_latest));
        assert!(debounce.take_if_latest(beta, beta_latest));
        assert!(debounce.pending_by_path.is_empty());
    }
}
