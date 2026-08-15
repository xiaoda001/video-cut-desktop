#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--install-ffmpeg") {
        let result = match (args.get(2), args.get(3)) {
            (Some(archive), Some(destination)) => {
                framecut_lib::install_ffmpeg_archive(archive, destination)
            }
            _ => Err("缺少 FFmpeg 压缩包或安装目录参数。".into()),
        };
        match result {
            Ok(()) => std::process::exit(0),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
    }
    framecut_lib::run();
}
