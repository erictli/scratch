use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Component, Path, PathBuf};

const SUPPORTED_IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tiff", "tif", "ico", "avif",
];
const MAX_IMAGE_NAME_ATTEMPTS: usize = 1_000;

pub(crate) fn copy_image_to_assets_create_only(
    source: &Path,
    assets_directory: &Path,
    sanitized_name: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    for attempt in 0..MAX_IMAGE_NAME_ATTEMPTS {
        let target_name = if attempt == 0 {
            format!("{sanitized_name}.{extension}")
        } else {
            format!("{sanitized_name}-{attempt}.{extension}")
        };
        let target_path = assets_directory.join(target_name);
        let mut target = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target_path)
        {
            Ok(target) => target,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Failed to create image asset: {error}")),
        };

        let copy_result = (|| -> io::Result<()> {
            let mut source_file = File::open(source)?;
            io::copy(&mut source_file, &mut target)?;
            target.sync_all()
        })();
        if let Err(error) = copy_result {
            drop(target);
            let _ = fs::remove_file(&target_path);
            return Err(format!("Failed to copy image: {error}"));
        }

        return Ok(target_path);
    }

    Err(format!(
        "Could not create a unique image asset after {MAX_IMAGE_NAME_ATTEMPTS} attempts",
    ))
}

pub(crate) fn editor_window_can_open_local_images(window_label: &str) -> bool {
    window_label == "main" || window_label.starts_with("workspace-")
}

pub(crate) fn canonical_workspace_assets(workspace: &Path) -> Result<PathBuf, String> {
    let canonical_workspace = workspace
        .canonicalize()
        .map_err(|_| "Workspace folder is unavailable".to_string())?;
    let canonical_assets = workspace
        .join("assets")
        .canonicalize()
        .map_err(|_| "Workspace assets folder is unavailable".to_string())?;
    if !canonical_assets.starts_with(&canonical_workspace) {
        return Err("Workspace assets folder escapes the workspace".to_string());
    }
    Ok(canonical_assets)
}

pub(crate) fn validate_editor_image_source(
    source: &str,
    workspace: &Path,
) -> Result<PathBuf, String> {
    let url = url::Url::parse(source).map_err(|_| "Invalid image source".to_string())?;
    let is_asset_scheme =
        url.scheme() == "asset" && matches!(url.host_str(), None | Some("localhost"));
    let is_asset_host =
        matches!(url.scheme(), "http" | "https") && url.host_str() == Some("asset.localhost");

    if !is_asset_scheme && !is_asset_host {
        return Err("Only local Tauri asset URLs are supported".to_string());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("Local image source must not contain a query or fragment".to_string());
    }

    let encoded_path = url.path().strip_prefix('/').unwrap_or(url.path());
    let decoded_path = urlencoding::decode(encoded_path)
        .map_err(|_| "Invalid percent encoding in image source".to_string())?;
    if decoded_path.contains('\0') {
        return Err("Image path contains a NUL byte".to_string());
    }

    let requested_path = PathBuf::from(decoded_path.as_ref());
    if !requested_path.is_absolute() {
        return Err("Image path must be absolute".to_string());
    }
    if requested_path
        .components()
        .any(|component| component == Component::ParentDir)
    {
        return Err("Image path traversal is not allowed".to_string());
    }

    let canonical_assets = canonical_workspace_assets(workspace)?;

    let canonical_requested = requested_path
        .canonicalize()
        .map_err(|_| "Image file is unavailable".to_string())?;
    if !canonical_requested.starts_with(&canonical_assets) {
        return Err("Image path is outside the workspace assets folder".to_string());
    }

    let metadata = fs::metadata(&canonical_requested)
        .map_err(|_| "Image file metadata is unavailable".to_string())?;
    if !metadata.is_file() {
        return Err("Image path is not a regular file".to_string());
    }

    let extension = canonical_requested
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "Image file has no supported extension".to_string())?;
    if !SUPPORTED_IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err("Image file extension is not supported".to_string());
    }

    Ok(canonical_requested)
}

#[cfg(test)]
mod tests {
    use super::{
        copy_image_to_assets_create_only, editor_window_can_open_local_images,
        validate_editor_image_source,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct TestWorkspace {
        root: PathBuf,
    }

    impl TestWorkspace {
        fn new() -> Self {
            let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "scratch-editor-image-open-{}-{sequence}",
                std::process::id(),
            ));
            fs::create_dir_all(root.join("assets")).expect("create test assets directory");
            Self { root }
        }

        fn asset(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.root.join("assets").join(name);
            fs::write(&path, contents).expect("write test asset");
            path
        }

        fn source(path: &Path) -> String {
            format!(
                "asset://localhost/{}",
                urlencoding::encode(path.to_string_lossy().as_ref()),
            )
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn allows_only_normal_editor_windows_to_open_local_images() {
        assert!(editor_window_can_open_local_images("main"));
        assert!(editor_window_can_open_local_images("workspace-client"));
        assert!(!editor_window_can_open_local_images("preview-note"));
        assert!(!editor_window_can_open_local_images("preferences"));
        assert!(!editor_window_can_open_local_images("unknown"));
    }

    #[test]
    fn accepts_a_regular_supported_image_inside_workspace_assets() {
        let workspace = TestWorkspace::new();
        let image = workspace.asset("photo.PNG", b"image");

        assert_eq!(
            validate_editor_image_source(&TestWorkspace::source(&image), &workspace.root)
                .expect("valid workspace image"),
            image.canonicalize().expect("canonical image"),
        );
    }

    #[test]
    fn rejects_paths_outside_workspace_assets() {
        let workspace = TestWorkspace::new();
        let outside = workspace.root.join("outside.png");
        fs::write(&outside, b"image").expect("write outside image");

        assert!(
            validate_editor_image_source(&TestWorkspace::source(&outside), &workspace.root)
                .is_err(),
        );
    }

    #[test]
    fn rejects_encoded_system_and_windows_paths() {
        let workspace = TestWorkspace::new();

        assert!(
            validate_editor_image_source("asset://localhost/%2Fetc%2Fpasswd", &workspace.root,)
                .is_err()
        );
        assert!(validate_editor_image_source(
            "asset://localhost/C%3A%5CWindows%5CSystem32%5Cdrivers%5Cetc%5Chosts",
            &workspace.root,
        )
        .is_err());
    }

    #[test]
    fn rejects_unsupported_schemes_and_malformed_sources() {
        let workspace = TestWorkspace::new();

        for source in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "asset://localhost/%ZZ",
            "asset://localhost/assets/photo.png",
            "asset://localhost/%00tmp%2Fphoto.png",
            "asset://localhost/%2Ftmp%2Fphoto.png?download=1",
            "asset://localhost/%2Ftmp%2Fphoto.png#fragment",
        ] {
            assert!(
                validate_editor_image_source(source, &workspace.root).is_err(),
                "source must be rejected: {source}",
            );
        }
    }

    #[test]
    fn rejects_parent_directory_components_before_canonicalization() {
        let workspace = TestWorkspace::new();
        let escaped = format!(
            "{}%2Fassets%2F..%2Foutside.png",
            urlencoding::encode(workspace.root.to_string_lossy().as_ref()),
        );

        assert!(validate_editor_image_source(
            &format!("asset://localhost/{escaped}"),
            &workspace.root,
        )
        .is_err());
    }

    #[test]
    fn rejects_non_image_files_inside_assets() {
        let workspace = TestWorkspace::new();
        let text = workspace.asset("notes.txt", b"not an image");

        assert!(
            validate_editor_image_source(&TestWorkspace::source(&text), &workspace.root).is_err(),
        );
    }

    #[test]
    fn atomically_uses_a_suffix_without_replacing_an_existing_asset() {
        let workspace = TestWorkspace::new();
        let source = workspace.root.join("source.png");
        fs::write(&source, b"new image").expect("write source image");
        let existing = workspace.asset("photo.png", b"existing image");

        let copied = copy_image_to_assets_create_only(
            &source,
            &workspace.root.join("assets"),
            "photo",
            "png",
        )
        .expect("copy to unique asset path");

        assert_eq!(
            copied.file_name().and_then(|name| name.to_str()),
            Some("photo-1.png")
        );
        assert_eq!(
            fs::read(existing).expect("read existing asset"),
            b"existing image"
        );
        assert_eq!(fs::read(copied).expect("read copied asset"), b"new image");
    }

    #[test]
    fn concurrent_copies_receive_distinct_asset_names() {
        let workspace = TestWorkspace::new();
        let source = workspace.root.join("source.png");
        fs::write(&source, b"shared image").expect("write source image");
        let assets = workspace.root.join("assets");

        let first_source = source.clone();
        let first_assets = assets.clone();
        let first = std::thread::spawn(move || {
            copy_image_to_assets_create_only(&first_source, &first_assets, "photo", "png")
        });
        let second = std::thread::spawn(move || {
            copy_image_to_assets_create_only(&source, &assets, "photo", "png")
        });

        let first_path = first
            .join()
            .expect("first copy thread")
            .expect("first copy");
        let second_path = second
            .join()
            .expect("second copy thread")
            .expect("second copy");
        assert_ne!(first_path, second_path);
        assert_eq!(
            fs::read(first_path).expect("read first copy"),
            b"shared image"
        );
        assert_eq!(
            fs::read(second_path).expect("read second copy"),
            b"shared image"
        );
    }

    #[test]
    fn failed_copy_removes_the_partial_destination() {
        let workspace = TestWorkspace::new();
        let missing_source = workspace.root.join("missing.png");
        let assets = workspace.root.join("assets");

        assert!(
            copy_image_to_assets_create_only(&missing_source, &assets, "photo", "png",).is_err()
        );
        assert!(!assets.join("photo.png").exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_that_escape_workspace_assets() {
        use std::os::unix::fs::symlink;

        let workspace = TestWorkspace::new();
        let outside = workspace.root.join("outside.png");
        fs::write(&outside, b"image").expect("write outside image");
        let link = workspace.root.join("assets").join("escape.png");
        symlink(&outside, &link).expect("create escaping symlink");

        assert!(
            validate_editor_image_source(&TestWorkspace::source(&link), &workspace.root).is_err(),
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_an_assets_directory_symlinked_outside_the_workspace() {
        use std::os::unix::fs::symlink;

        let workspace = TestWorkspace::new();
        fs::remove_dir(workspace.root.join("assets")).expect("remove original assets directory");
        let outside = std::env::temp_dir().join(format!(
            "scratch-editor-image-open-outside-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir_all(&outside).expect("create outside assets directory");
        let image = outside.join("escape.png");
        fs::write(&image, b"image").expect("write outside image");
        symlink(&outside, workspace.root.join("assets")).expect("symlink assets outside");

        assert!(
            validate_editor_image_source(&TestWorkspace::source(&image), &workspace.root).is_err(),
        );

        fs::remove_dir_all(outside).expect("remove outside assets directory");
    }
}
