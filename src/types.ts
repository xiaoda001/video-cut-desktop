export type Project = {
  id: string;
  name: string;
  originalPath: string;
  thumbnailPath: string;
  projectDir: string;
  duration: number;
  createdAt: string;
};

export type Clip = {
  id: string;
  projectId: string;
  path: string;
  thumbnailPath: string;
  startTime: number;
  endTime: number;
  createdAt: string;
};

export type Settings = {
  defaultSegmentSeconds: number;
  storagePath: string;
  autoCutOnImport: boolean;
  setupCompleted: boolean;
};

export type FfmpegStatus = { ready: boolean; path: string; downloaded: boolean };
