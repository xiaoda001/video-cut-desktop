use std::{fs, path::Path};

fn ensure_windows_icon() {
    let path = Path::new("icons/icon.ico");
    if path.exists() {
        return;
    }
    let size = 32usize;
    let xor_bytes = size * size * 4;
    let mask_bytes = (size / 8) * size;
    let image_bytes = 40 + xor_bytes + mask_bytes;
    let mut ico = Vec::with_capacity(22 + image_bytes);
    ico.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
    ico.extend_from_slice(&[32, 32, 0, 0, 1, 0, 32, 0]);
    ico.extend_from_slice(&(image_bytes as u32).to_le_bytes());
    ico.extend_from_slice(&22u32.to_le_bytes());
    ico.extend_from_slice(&40u32.to_le_bytes());
    ico.extend_from_slice(&(size as i32).to_le_bytes());
    ico.extend_from_slice(&((size * 2) as i32).to_le_bytes());
    ico.extend_from_slice(&1u16.to_le_bytes());
    ico.extend_from_slice(&32u16.to_le_bytes());
    ico.extend_from_slice(&0u32.to_le_bytes());
    ico.extend_from_slice(&(xor_bytes as u32).to_le_bytes());
    ico.extend_from_slice(&[0; 16]);
    for y in 0..size {
        for x in 0..size {
            let border = x < 3 || x >= size - 3 || y < 3 || y >= size - 3;
            let perforation = (x < 8 || x >= size - 8) && (y % 9 < 4);
            let (r, g, b) = if border || perforation {
                (216, 255, 79)
            } else {
                (16, 19, 24)
            };
            ico.extend_from_slice(&[b, g, r, 255]);
        }
    }
    ico.extend(std::iter::repeat(0).take(mask_bytes));
    fs::create_dir_all("icons").expect("create icon directory");
    fs::write(path, ico).expect("write generated Windows icon");
}

fn ensure_bundle_placeholders() {
    if !cfg!(target_os = "windows") {
        return;
    }
    let resource_dir = Path::new("resources");
    fs::create_dir_all(resource_dir).expect("create resource directory");
    let ffmpeg_archive = resource_dir.join("ffmpeg-release-essentials.7z");
    if !ffmpeg_archive.exists() {
        fs::write(ffmpeg_archive, []).expect("write FFmpeg bundle placeholder");
    }
}

fn main() {
    ensure_windows_icon();
    ensure_bundle_placeholders();
    tauri_build::build()
}
