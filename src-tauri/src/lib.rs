use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;
static FFMPEG_DIR: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

struct AppState {
    config_db: Mutex<PathBuf>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Project {
    id: String,
    name: String,
    original_path: String,
    thumbnail_path: String,
    project_dir: String,
    duration: f64,
    created_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Clip {
    id: String,
    project_id: String,
    path: String,
    thumbnail_path: String,
    start_time: f64,
    end_time: f64,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Settings {
    default_segment_seconds: f64,
    storage_path: String,
    auto_cut_on_import: bool,
    setup_completed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FfmpegStatus {
    ready: bool,
    path: String,
    downloaded: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProgressEvent {
    completed: usize,
    total: usize,
    current_file: String,
    phase: String,
    file_progress: f64,
}

type AppResult<T> = Result<T, String>;

fn db_error(error: impl std::fmt::Display) -> String {
    format!("数据库操作失败：{error}")
}

fn init_config(path: &Path, default_storage: &Path) -> AppResult<()> {
    let config_already_existed = path.exists();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建应用数据目录：{e}"))?;
    }
    let db = Connection::open(path).map_err(db_error)?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .map_err(db_error)?;
    db.execute(
        "INSERT OR IGNORE INTO settings(key,value) VALUES('default_segment_seconds','10')",
        [],
    )
    .map_err(db_error)?;
    db.execute(
        "INSERT OR IGNORE INTO settings(key,value) VALUES('storage_path',?1)",
        [default_storage.to_string_lossy().as_ref()],
    )
    .map_err(db_error)?;
    db.execute(
        "INSERT OR IGNORE INTO settings(key,value) VALUES('auto_cut_on_import','0')",
        [],
    )
    .map_err(db_error)?;
    db.execute(
        "INSERT OR IGNORE INTO settings(key,value) VALUES('setup_completed',?1)",
        [if config_already_existed { "1" } else { "0" }],
    )
    .map_err(db_error)?;
    init_library(default_storage)
}

fn init_library(root: &Path) -> AppResult<()> {
    fs::create_dir_all(root).map_err(|e| format!("无法创建视频项目目录：{e}"))?;
    let db = Connection::open(root.join("framecut.db")).map_err(db_error)?;
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS projects (
           id TEXT PRIMARY KEY, name TEXT NOT NULL, original_path TEXT NOT NULL,
           thumbnail_path TEXT NOT NULL, project_dir TEXT NOT NULL,
           duration REAL NOT NULL, created_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS clips (
           id TEXT PRIMARY KEY, project_id TEXT NOT NULL, path TEXT NOT NULL,
           thumbnail_path TEXT NOT NULL, start_time REAL NOT NULL,
           end_time REAL NOT NULL, created_at TEXT NOT NULL,
           clip_type TEXT NOT NULL DEFAULT 'split',
           FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
         );",
    )
    .map_err(db_error)?;
    let has_clip_type = db
        .prepare("PRAGMA table_info(clips)")
        .map_err(db_error)?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?
        .iter()
        .any(|column| column == "clip_type");
    if !has_clip_type {
        db.execute(
            "ALTER TABLE clips ADD COLUMN clip_type TEXT NOT NULL DEFAULT 'split'",
            [],
        )
        .map_err(db_error)?;
    }
    Ok(())
}

fn read_settings(config_path: &Path) -> AppResult<Settings> {
    let db = Connection::open(config_path).map_err(db_error)?;
    let seconds: String = db
        .query_row(
            "SELECT value FROM settings WHERE key='default_segment_seconds'",
            [],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    let storage_path: String = db
        .query_row(
            "SELECT value FROM settings WHERE key='storage_path'",
            [],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    let setup_completed: String = db
        .query_row(
            "SELECT value FROM settings WHERE key='setup_completed'",
            [],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    let auto_cut_on_import: String = db
        .query_row(
            "SELECT value FROM settings WHERE key='auto_cut_on_import'",
            [],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    Ok(Settings {
        default_segment_seconds: seconds.parse().unwrap_or(10.0),
        storage_path,
        auto_cut_on_import: auto_cut_on_import == "1",
        setup_completed: setup_completed == "1",
    })
}

fn config_path(state: &State<AppState>) -> AppResult<PathBuf> {
    state
        .config_db
        .lock()
        .map(|p| p.clone())
        .map_err(|_| "应用状态锁定失败".to_string())
}

fn library_db(state: &State<AppState>) -> AppResult<Connection> {
    let settings = read_settings(&config_path(state)?)?;
    init_library(Path::new(&settings.storage_path))?;
    Connection::open(Path::new(&settings.storage_path).join("framecut.db")).map_err(db_error)
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        original_path: row.get(2)?,
        thumbnail_path: row.get(3)?,
        project_dir: row.get(4)?,
        duration: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn clip_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Clip> {
    Ok(Clip {
        id: row.get(0)?,
        project_id: row.get(1)?,
        path: row.get(2)?,
        thumbnail_path: row.get(3)?,
        start_time: row.get(4)?,
        end_time: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn ffmpeg_slot() -> &'static Mutex<Option<PathBuf>> {
    FFMPEG_DIR.get_or_init(|| Mutex::new(None))
}

fn tool_file(directory: &Path, tool: &str) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        directory.join(format!("{tool}.exe"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        directory.join(tool)
    }
}

fn directory_has_tools(directory: &Path) -> bool {
    tool_file(directory, "ffmpeg").is_file() && tool_file(directory, "ffprobe").is_file()
}

fn remember_ffmpeg(directory: Option<PathBuf>) {
    if let Ok(mut slot) = ffmpeg_slot().lock() {
        *slot = directory;
    }
}

fn command_available(tool: &str) -> bool {
    let mut command = Command::new(tool);
    hide_console(&mut command);
    command
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn find_ffmpeg(app: &AppHandle) -> Option<FfmpegStatus> {
    if let (Ok(ffmpeg), Ok(ffprobe)) = (
        std::env::var("FRAMECUT_FFMPEG"),
        std::env::var("FRAMECUT_FFPROBE"),
    ) {
        if Path::new(&ffmpeg).is_file() && Path::new(&ffprobe).is_file() {
            remember_ffmpeg(None);
            return Some(FfmpegStatus {
                ready: true,
                path: ffmpeg,
                downloaded: false,
            });
        }
    }
    let executable_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf));
    let local_data_dir = app.path().app_local_data_dir().ok();
    let candidates = [
        executable_dir
            .as_ref()
            .map(|p| p.join("ffmpeg").join("bin")),
        local_data_dir
            .as_ref()
            .map(|p| p.join("ffmpeg").join("bin")),
    ];
    for candidate in candidates.into_iter().flatten() {
        if directory_has_tools(&candidate) {
            remember_ffmpeg(Some(candidate.clone()));
            return Some(FfmpegStatus {
                ready: true,
                path: candidate.to_string_lossy().into_owned(),
                downloaded: true,
            });
        }
    }
    if command_available("ffmpeg") && command_available("ffprobe") {
        remember_ffmpeg(None);
        return Some(FfmpegStatus {
            ready: true,
            path: "系统 PATH".into(),
            downloaded: false,
        });
    }
    None
}

fn find_file_recursive(root: &Path, file_name: &str) -> Option<PathBuf> {
    for entry in fs::read_dir(root).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_recursive(&path, file_name) {
                return Some(found);
            }
        } else if path
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case(file_name))
        {
            return Some(path);
        }
    }
    None
}

pub fn install_ffmpeg_archive(archive: &str, destination: &str) -> AppResult<()> {
    let archive = PathBuf::from(archive);
    let destination = PathBuf::from(destination);
    if !archive.is_file() {
        return Err(format!("FFmpeg 安装包不存在：{}", archive.display()));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "FFmpeg 安装目录无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建 FFmpeg 安装目录：{e}"))?;
    let temporary = parent.join(format!(".extract-{}", std::process::id()));
    if temporary.exists() {
        fs::remove_dir_all(&temporary).map_err(|e| format!("无法清理 FFmpeg 临时目录：{e}"))?;
    }
    fs::create_dir_all(&temporary).map_err(|e| format!("无法创建 FFmpeg 临时目录：{e}"))?;
    let result = (|| -> AppResult<()> {
        sevenz_rust::decompress_file(&archive, &temporary)
            .map_err(|e| format!("无法解压 FFmpeg：{e}"))?;
        let ffmpeg = find_file_recursive(&temporary, "ffmpeg.exe")
            .ok_or_else(|| "FFmpeg 压缩包中缺少 ffmpeg.exe。".to_string())?;
        let ffprobe = find_file_recursive(&temporary, "ffprobe.exe")
            .ok_or_else(|| "FFmpeg 压缩包中缺少 ffprobe.exe。".to_string())?;
        fs::create_dir_all(&destination).map_err(|e| format!("无法创建 FFmpeg bin 目录：{e}"))?;
        for (source, name) in [(ffmpeg, "ffmpeg.exe"), (ffprobe, "ffprobe.exe")] {
            let target = destination.join(name);
            if target.exists() {
                fs::remove_file(&target).map_err(|e| format!("无法更新 {name}：{e}"))?;
            }
            fs::copy(source, target).map_err(|e| format!("无法安装 {name}：{e}"))?;
        }
        Ok(())
    })();
    let _ = fs::remove_dir_all(&temporary);
    result
}

#[cfg(target_os = "windows")]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}
#[cfg(not(target_os = "windows"))]
fn hide_console(_: &mut Command) {}

fn media_command(binary: &str) -> Command {
    let env_key = if binary == "ffmpeg" {
        "FRAMECUT_FFMPEG"
    } else {
        "FRAMECUT_FFPROBE"
    };
    let executable = std::env::var(env_key)
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            ffmpeg_slot()
                .lock()
                .ok()
                .and_then(|slot| slot.as_ref().map(|directory| tool_file(directory, binary)))
        })
        .unwrap_or_else(|| PathBuf::from(binary));
    let mut command = Command::new(executable);
    hide_console(&mut command);
    command
        .args(["-hide_banner", "-loglevel", "error"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

fn run_media(mut command: Command, label: &str) -> AppResult<()> {
    let output = command.output().map_err(|_| format!("未找到 {label}。请安装 FFmpeg 并加入 PATH，或设置 FRAMECUT_FFMPEG / FRAMECUT_FFPROBE 环境变量。"))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr);
        let last = detail
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("未知错误");
        Err(format!("{label} 执行失败：{last}"))
    }
}

fn probe_duration(path: &Path) -> AppResult<f64> {
    let output = media_command("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output()
        .map_err(|_| {
            "未找到 ffprobe。请安装 FFmpeg 并加入 PATH，或设置 FRAMECUT_FFPROBE 环境变量。"
                .to_string()
        })?;
    if !output.status.success() {
        return Err(format!(
            "无法读取视频信息：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .map_err(|_| "无法识别视频时长，文件可能已损坏或格式不受支持。".to_string())
}

fn make_thumbnail(video: &Path, output: &Path, at: f64) -> AppResult<()> {
    let mut command = media_command("ffmpeg");
    command
        .args(["-y", "-ss", &format!("{at:.3}"), "-i"])
        .arg(video)
        .args(["-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "3"])
        .arg(output);
    run_media(command, "FFmpeg 首帧提取")
}

fn get_project_inner(db: &Connection, id: &str) -> AppResult<Project> {
    db.query_row("SELECT id,name,original_path,thumbnail_path,project_dir,duration,created_at FROM projects WHERE id=?1", [id], project_from_row).map_err(|_| "没有找到该视频项目，它可能已被移动或删除。".to_string())
}

fn create_clip(
    db: &Connection,
    project: &Project,
    start: f64,
    end: f64,
    clip_type: &str,
) -> AppResult<Clip> {
    let id = Uuid::new_v4().to_string();
    let clips_dir = Path::new(&project.project_dir).join("clips");
    let thumbs_dir = Path::new(&project.project_dir).join("thumbnails");
    fs::create_dir_all(&clips_dir).map_err(|e| format!("无法创建片段目录：{e}"))?;
    fs::create_dir_all(&thumbs_dir).map_err(|e| format!("无法创建封面目录：{e}"))?;
    let clip_path = clips_dir.join(format!("clip_{id}.mp4"));
    let thumb_path = thumbs_dir.join(format!("clip_{id}.jpg"));
    let mut command = media_command("ffmpeg");
    command
        .args(["-y", "-ss", &format!("{start:.3}"), "-i"])
        .arg(&project.original_path)
        .args([
            "-t",
            &format!("{:.3}", end - start),
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
        ])
        .arg(&clip_path);
    if let Err(error) = run_media(command, "FFmpeg 视频裁剪") {
        let _ = fs::remove_file(&clip_path);
        return Err(error);
    }
    if let Err(error) = make_thumbnail(&clip_path, &thumb_path, 0.0) {
        let _ = fs::remove_file(&clip_path);
        return Err(error);
    }
    let clip = Clip {
        id,
        project_id: project.id.clone(),
        path: clip_path.to_string_lossy().into_owned(),
        thumbnail_path: thumb_path.to_string_lossy().into_owned(),
        start_time: start,
        end_time: end,
        created_at: Utc::now().to_rfc3339(),
    };
    db.execute("INSERT INTO clips(id,project_id,path,thumbnail_path,start_time,end_time,created_at,clip_type) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)", params![clip.id, clip.project_id, clip.path, clip.thumbnail_path, clip.start_time, clip.end_time, clip.created_at, clip_type]).map_err(db_error)?;
    Ok(clip)
}

fn split_project_evenly<F>(
    db: &Connection,
    project: &Project,
    seconds: f64,
    mut on_progress: F,
) -> AppResult<Vec<Clip>>
where
    F: FnMut(usize, usize),
{
    let mut created = Vec::new();
    let mut start = 0.0;
    let total = (project.duration / seconds).ceil() as usize;
    while start < project.duration - 0.001 {
        let end = (start + seconds).min(project.duration);
        created.push(create_clip(db, project, start, end, "split")?);
        start = end;
        on_progress(created.len(), total);
    }
    created.reverse();
    Ok(created)
}

fn clear_split_clips(db: &Connection, project: &Project) -> AppResult<()> {
    let mut stmt = db
        .prepare("SELECT path,thumbnail_path FROM clips WHERE project_id=?1 AND clip_type='split'")
        .map_err(db_error)?;
    let files = stmt
        .query_map([&project.id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    drop(stmt);

    let project_dir = Path::new(&project.project_dir);
    for (clip_path, thumbnail_path) in files {
        for raw_path in [clip_path, thumbnail_path] {
            let path = PathBuf::from(raw_path);
            if !path.starts_with(project_dir) {
                return Err("裁剪文件路径校验失败，为避免误删文件，操作已取消。".into());
            }
            if path.exists() {
                fs::remove_file(&path).map_err(|e| format!("无法清理旧裁剪文件：{e}"))?;
            }
        }
    }
    db.execute(
        "DELETE FROM clips WHERE project_id=?1 AND clip_type='split'",
        [&project.id],
    )
    .map(|_| ())
    .map_err(db_error)
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> AppResult<Settings> {
    read_settings(&config_path(&state)?)
}

#[tauri::command]
fn ensure_ffmpeg(app: AppHandle) -> AppResult<FfmpegStatus> {
    find_ffmpeg(&app)
        .ok_or_else(|| "没有检测到 FFmpeg，应用安装可能不完整，请重新运行安装程序。".to_string())
}

#[tauri::command]
fn save_settings(settings: Settings, state: State<AppState>) -> AppResult<Settings> {
    if !settings.default_segment_seconds.is_finite() || settings.default_segment_seconds <= 0.0 {
        return Err("默认裁剪秒数必须大于 0。".into());
    }
    let storage = PathBuf::from(settings.storage_path.trim());
    if storage.as_os_str().is_empty() {
        return Err("请选择有效的视频项目存储位置。".into());
    }
    init_library(&storage)?;
    let config = config_path(&state)?;
    let mut db = Connection::open(config).map_err(db_error)?;
    let tx = db.transaction().map_err(db_error)?;
    tx.execute(
        "INSERT OR REPLACE INTO settings(key,value) VALUES('default_segment_seconds',?1)",
        [settings.default_segment_seconds.to_string()],
    )
    .map_err(db_error)?;
    tx.execute(
        "INSERT OR REPLACE INTO settings(key,value) VALUES('storage_path',?1)",
        [storage.to_string_lossy().as_ref()],
    )
    .map_err(db_error)?;
    tx.execute(
        "INSERT OR REPLACE INTO settings(key,value) VALUES('auto_cut_on_import',?1)",
        [if settings.auto_cut_on_import {
            "1"
        } else {
            "0"
        }],
    )
    .map_err(db_error)?;
    tx.execute(
        "INSERT OR REPLACE INTO settings(key,value) VALUES('setup_completed','1')",
        [],
    )
    .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(Settings {
        storage_path: storage.to_string_lossy().into_owned(),
        setup_completed: true,
        ..settings
    })
}

#[tauri::command]
fn list_projects(state: State<AppState>) -> AppResult<Vec<Project>> {
    let db = library_db(&state)?;
    let mut stmt = db.prepare("SELECT id,name,original_path,thumbnail_path,project_dir,duration,created_at FROM projects ORDER BY created_at DESC").map_err(db_error)?;
    let projects = stmt
        .query_map([], project_from_row)
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    Ok(projects)
}

#[tauri::command]
fn get_project(id: String, state: State<AppState>) -> AppResult<Project> {
    get_project_inner(&library_db(&state)?, &id)
}

fn files_have_same_content(first: &Path, second: &Path) -> AppResult<bool> {
    let first_size = fs::metadata(first)
        .map_err(|e| format!("无法读取待导入视频信息：{e}"))?
        .len();
    let second_size = match fs::metadata(second) {
        Ok(metadata) => metadata.len(),
        Err(_) => return Ok(false),
    };
    if first_size != second_size {
        return Ok(false);
    }

    let mut first_file = fs::File::open(first).map_err(|e| format!("无法读取待导入视频：{e}"))?;
    let mut second_file = fs::File::open(second).map_err(|e| format!("无法读取已有视频：{e}"))?;
    let mut first_buffer = [0_u8; 64 * 1024];
    let mut second_buffer = [0_u8; 64 * 1024];
    let mut remaining = first_size;
    while remaining > 0 {
        let chunk_size = remaining.min(first_buffer.len() as u64) as usize;
        first_file
            .read_exact(&mut first_buffer[..chunk_size])
            .map_err(|e| format!("读取待导入视频时出错：{e}"))?;
        second_file
            .read_exact(&mut second_buffer[..chunk_size])
            .map_err(|e| format!("读取已有视频时出错：{e}"))?;
        if first_buffer[..chunk_size] != second_buffer[..chunk_size] {
            return Ok(false);
        }
        remaining -= chunk_size as u64;
    }
    Ok(true)
}

fn video_already_imported(db: &Connection, source: &Path) -> AppResult<bool> {
    let mut stmt = db
        .prepare("SELECT original_path FROM projects")
        .map_err(db_error)?;
    let originals = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    drop(stmt);
    for original in originals {
        if files_have_same_content(source, Path::new(&original))? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn emit_import_progress(
    app: &AppHandle,
    completed: usize,
    total: usize,
    current_file: &str,
    phase: &str,
    file_progress: f64,
) {
    let _ = app.emit(
        "import-progress",
        ImportProgressEvent {
            completed,
            total,
            current_file: current_file.to_owned(),
            phase: phase.to_owned(),
            file_progress: file_progress.clamp(0.0, 1.0),
        },
    );
}

fn copy_with_progress<F>(source: &Path, target: &Path, mut on_progress: F) -> std::io::Result<u64>
where
    F: FnMut(f64),
{
    const BUFFER_SIZE: usize = 1024 * 1024;
    const REPORT_INTERVAL: u64 = 4 * 1024 * 1024;

    let total = fs::metadata(source)?.len();
    let mut input = fs::File::open(source)?;
    let mut output = fs::File::create(target)?;
    let mut buffer = vec![0_u8; BUFFER_SIZE];
    let mut copied = 0_u64;
    let mut last_reported = 0_u64;

    loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        output.write_all(&buffer[..read])?;
        copied += read as u64;
        if copied == total || copied.saturating_sub(last_reported) >= REPORT_INTERVAL {
            on_progress(if total == 0 {
                1.0
            } else {
                copied as f64 / total as f64
            });
            last_reported = copied;
        }
    }
    output.flush()?;
    if total == 0 {
        on_progress(1.0);
    }
    Ok(copied)
}

fn import_videos_inner(
    paths: Vec<String>,
    config: PathBuf,
    app: AppHandle,
) -> AppResult<Vec<Project>> {
    let total = paths.len();
    let settings = read_settings(&config)?;
    let root = PathBuf::from(settings.storage_path);
    init_library(&root)?;
    let mut db = Connection::open(root.join("framecut.db")).map_err(db_error)?;
    let mut imported = Vec::new();

    for (index, raw) in paths.into_iter().enumerate() {
        let source = PathBuf::from(&raw);
        let current_file = source
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| raw.clone());
        emit_import_progress(&app, index, total, &current_file, "正在检查重复视频", 0.02);
        if !source.is_file() {
            return Err(format!("视频文件不存在：{raw}"));
        }
        if video_already_imported(&db, &source)? {
            emit_import_progress(&app, index + 1, total, &current_file, "已跳过重复视频", 0.0);
            continue;
        }

        emit_import_progress(&app, index, total, &current_file, "正在读取视频信息", 0.06);
        let duration = probe_duration(&source)?;
        let id = Uuid::new_v4().to_string();
        let project_dir = root.join(&id);
        fs::create_dir_all(project_dir.join("original"))
            .map_err(|e| format!("无法创建项目目录：{e}"))?;
        fs::create_dir_all(project_dir.join("thumbnails"))
            .map_err(|e| format!("无法创建封面目录：{e}"))?;
        let file_name = source
            .file_name()
            .ok_or_else(|| "无法读取视频文件名。".to_string())?;
        let original = project_dir.join("original").join(file_name);
        let thumbnail = project_dir.join("thumbnails").join("cover.jpg");

        emit_import_progress(&app, index, total, &current_file, "正在复制原视频", 0.1);
        if let Err(error) = copy_with_progress(&source, &original, |copy_progress| {
            emit_import_progress(
                &app,
                index,
                total,
                &current_file,
                "正在复制原视频",
                0.1 + copy_progress * 0.65,
            );
        }) {
            let _ = fs::remove_dir_all(&project_dir);
            return Err(format!("复制视频失败：{error}"));
        }

        emit_import_progress(&app, index, total, &current_file, "正在生成视频封面", 0.78);
        if let Err(error) = make_thumbnail(&original, &thumbnail, 0.0) {
            let _ = fs::remove_dir_all(&project_dir);
            return Err(error);
        }
        let name = source
            .file_stem()
            .unwrap_or(file_name)
            .to_string_lossy()
            .into_owned();
        let project = Project {
            id,
            name,
            original_path: original.to_string_lossy().into_owned(),
            thumbnail_path: thumbnail.to_string_lossy().into_owned(),
            project_dir: project_dir.to_string_lossy().into_owned(),
            duration,
            created_at: Utc::now().to_rfc3339(),
        };

        emit_import_progress(&app, index, total, &current_file, "正在保存视频项目", 0.84);
        let tx = db.transaction().map_err(db_error)?;
        if let Err(error) = tx.execute("INSERT INTO projects(id,name,original_path,thumbnail_path,project_dir,duration,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![project.id, project.name, project.original_path, project.thumbnail_path, project.project_dir, project.duration, project.created_at]) {
            let _ = fs::remove_dir_all(&project_dir);
            return Err(db_error(error));
        }
        tx.commit().map_err(db_error)?;

        if settings.auto_cut_on_import {
            if let Err(error) = split_project_evenly(
                &db,
                &project,
                settings.default_segment_seconds,
                |created, clip_total| {
                    let clip_progress = if clip_total == 0 {
                        1.0
                    } else {
                        created as f64 / clip_total as f64
                    };
                    emit_import_progress(
                        &app,
                        index,
                        total,
                        &current_file,
                        &format!("正在自动裁剪 {created}/{clip_total}"),
                        0.85 + clip_progress * 0.14,
                    );
                },
            ) {
                let _ = db.execute("DELETE FROM clips WHERE project_id=?1", [&project.id]);
                let _ = db.execute("DELETE FROM projects WHERE id=?1", [&project.id]);
                let _ = fs::remove_dir_all(&project_dir);
                return Err(format!("导入后自动裁剪失败：{error}"));
            }
        }
        imported.push(project);
        emit_import_progress(&app, index + 1, total, &current_file, "导入完成", 0.0);
    }
    imported.reverse();
    Ok(imported)
}

#[tauri::command]
async fn import_videos(
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> AppResult<Vec<Project>> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let config = config_path(&state)?;
    tauri::async_runtime::spawn_blocking(move || import_videos_inner(paths, config, app))
        .await
        .map_err(|error| format!("导入任务执行失败：{error}"))?
}

#[tauri::command]
fn list_clips(project_id: String, state: State<AppState>) -> AppResult<Vec<Clip>> {
    let db = library_db(&state)?;
    let mut stmt = db.prepare("SELECT id,project_id,path,thumbnail_path,start_time,end_time,created_at FROM clips WHERE project_id=?1 AND clip_type='split' ORDER BY created_at DESC").map_err(db_error)?;
    let clips = stmt
        .query_map([project_id], clip_from_row)
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    Ok(clips)
}

#[tauri::command]
fn latest_range_clip(project_id: String, state: State<AppState>) -> AppResult<Option<Clip>> {
    let db = library_db(&state)?;
    let mut stmt = db.prepare("SELECT id,project_id,path,thumbnail_path,start_time,end_time,created_at FROM clips WHERE project_id=?1 AND clip_type='range' ORDER BY created_at DESC LIMIT 1").map_err(db_error)?;
    let mut rows = stmt.query([project_id]).map_err(db_error)?;
    rows.next()
        .map_err(db_error)?
        .map(clip_from_row)
        .transpose()
        .map_err(db_error)
}

#[tauri::command]
fn split_evenly(project_id: String, seconds: f64, state: State<AppState>) -> AppResult<Vec<Clip>> {
    if !seconds.is_finite() || seconds <= 0.0 {
        return Err("平均裁剪秒数必须大于 0。".into());
    }
    let db = library_db(&state)?;
    let project = get_project_inner(&db, &project_id)?;
    clear_split_clips(&db, &project)?;
    split_project_evenly(&db, &project, seconds, |_, _| {})
}

#[tauri::command]
fn cut_range(project_id: String, start: f64, end: f64, state: State<AppState>) -> AppResult<Clip> {
    let db = library_db(&state)?;
    let project = get_project_inner(&db, &project_id)?;
    if !start.is_finite()
        || !end.is_finite()
        || start < 0.0
        || end <= start
        || end > project.duration + 0.001
    {
        return Err("裁剪区间无效，请确认结束时间大于开始时间且不超过视频总时长。".into());
    }
    create_clip(&db, &project, start, end, "range")
}

#[tauri::command]
fn export_clip(clip_id: String, destination: String, state: State<AppState>) -> AppResult<()> {
    let db = library_db(&state)?;
    let source: String = db
        .query_row("SELECT path FROM clips WHERE id=?1", [clip_id], |r| {
            r.get(0)
        })
        .map_err(|_| "没有找到要导出的裁剪片段。".to_string())?;
    let target = PathBuf::from(destination);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建导出目录：{e}"))?;
    }
    fs::copy(source, target)
        .map(|_| ())
        .map_err(|e| format!("导出视频失败：{e}"))
}

#[tauri::command]
fn delete_project(id: String, state: State<AppState>) -> AppResult<()> {
    let settings = read_settings(&config_path(&state)?)?;
    let library_root = PathBuf::from(settings.storage_path);
    let mut db = library_db(&state)?;
    let project = get_project_inner(&db, &id)?;
    let project_dir = PathBuf::from(project.project_dir);
    if project_dir.parent() != Some(library_root.as_path())
        || project_dir.file_name().and_then(|name| name.to_str()) != Some(id.as_str())
    {
        return Err("项目目录校验失败，为避免误删文件，操作已取消。".into());
    }
    let tx = db.transaction().map_err(db_error)?;
    tx.execute("DELETE FROM clips WHERE project_id=?1", [&id])
        .map_err(db_error)?;
    tx.execute("DELETE FROM projects WHERE id=?1", [id])
        .map_err(db_error)?;
    if project_dir.exists() {
        fs::remove_dir_all(&project_dir).map_err(|e| format!("无法清理项目文件夹：{e}"))?;
    }
    tx.commit().map_err(db_error)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("无法定位应用数据目录：{e}"))?;
            let config = data.join("config.db");
            let storage = data.join("projects");
            init_config(&config, &storage)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(AppState {
                config_db: Mutex::new(config),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ensure_ffmpeg,
            get_settings,
            save_settings,
            list_projects,
            get_project,
            import_videos,
            list_clips,
            latest_range_clip,
            split_evenly,
            cut_range,
            export_clip,
            delete_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running FrameCut");
}

#[cfg(test)]
mod tests {
    use super::copy_with_progress;
    use std::{fs, time::SystemTime};

    #[test]
    fn copy_with_progress_preserves_content_and_finishes_at_one() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("framecut-copy-test-{unique}"));
        fs::create_dir_all(&directory).expect("create test directory");
        let source = directory.join("source.bin");
        let target = directory.join("target.bin");
        let content = vec![0x5a; 5 * 1024 * 1024];
        fs::write(&source, &content).expect("write source");

        let mut updates = Vec::new();
        let copied = copy_with_progress(&source, &target, |value| updates.push(value))
            .expect("copy should succeed");

        assert_eq!(copied, content.len() as u64);
        assert_eq!(fs::read(&target).expect("read target"), content);
        assert_eq!(updates.last().copied(), Some(1.0));
        assert!(updates.windows(2).all(|pair| pair[0] <= pair[1]));

        fs::remove_dir_all(directory).expect("remove test directory");
    }
}
