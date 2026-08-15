import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Clip, FfmpegStatus, Project, Settings } from "../types";

export const mediaUrl = (path: string) => convertFileSrc(path);

export const api = {
  listProjects: () => invoke<Project[]>("list_projects"),
  getProject: (id: string) => invoke<Project>("get_project", { id }),
  importVideos: (paths: string[]) => invoke<Project[]>("import_videos", { paths }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
  listClips: (projectId: string) => invoke<Clip[]>("list_clips", { projectId }),
  latestRangeClip: (projectId: string) =>
    invoke<Clip | null>("latest_range_clip", { projectId }),
  splitEvenly: (projectId: string, seconds: number) =>
    invoke<Clip[]>("split_evenly", { projectId, seconds }),
  cutRange: (projectId: string, start: number, end: number) =>
    invoke<Clip>("cut_range", { projectId, start, end }),
  exportClip: (clipId: string, destination: string) =>
    invoke<void>("export_clip", { clipId, destination }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  ensureFfmpeg: () => invoke<FfmpegStatus>("ensure_ffmpeg")
};
