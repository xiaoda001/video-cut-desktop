import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { CheckCircle, FileVideo, GearSix, Plus, SpinnerGap, Trash, UploadSimple, VideoCamera, WarningCircle } from "@phosphor-icons/react";
import { Brand } from "../components/Icons";
import { ProjectCard } from "../components/VideoCard";
import { api } from "../lib/api";
import type { ToastState } from "../components/Toast";
import type { Project } from "../types";

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v"]);
const fileName = (path: string) => path.split(/[\\/]/).pop() || path;
const isVideoPath = (path: string) => VIDEO_EXTENSIONS.has(path.split(".").pop()?.toLowerCase() || "");

type ImportProgress = {
  completed: number;
  total: number;
  currentFile: string;
  phase: string;
  fileProgress: number;
  done: boolean;
};

type BackendImportProgress = Omit<ImportProgress, "done">;

export function LibraryPage({ revision, onSettings, notify }: { revision: number; onSettings: () => void; notify: (toast: ToastState) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const importLock = useRef(false);

  useEffect(() => {
    setLoading(true);
    api.listProjects()
      .then(setProjects)
      .catch((error) => notify({ kind: "error", message: String(error) }))
      .finally(() => setLoading(false));
  }, [revision]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") setDragActive(true);
      if (event.payload.type === "leave") setDragActive(false);
      if (event.payload.type === "drop") {
        setDragActive(false);
        void importPaths(event.payload.paths);
      }
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    }).catch((error) => notify({ kind: "error", message: `无法启用拖拽导入：${String(error)}` }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function chooseVideos() {
    if (importLock.current) return;
    const paths = await open({
      multiple: true,
      title: "批量导入视频",
      filters: [{ name: "视频", extensions: [...VIDEO_EXTENSIONS] }]
    });
    if (paths) await importPaths(Array.isArray(paths) ? paths : [paths]);
  }

  async function importPaths(candidatePaths: string[]) {
    if (importLock.current) return;
    const paths = candidatePaths.filter(isVideoPath);
    const skipped = candidatePaths.length - paths.length;
    if (!paths.length) {
      notify({ kind: "error", message: "未找到支持的视频文件，请拖入 MP4、MOV、MKV、AVI、WebM 或 M4V 文件" });
      return;
    }

    importLock.current = true;
    setImporting(true);
    setProgress({ completed: 0, total: paths.length, currentFile: fileName(paths[0]), phase: "准备导入", fileProgress: 0, done: false });
    let importedCount = 0;
    let duplicateCount = 0;
    let stopListening: (() => void) | undefined;
    try {
      try {
        stopListening = await listen<BackendImportProgress>("import-progress", ({ payload }) => {
          setProgress({ ...payload, done: payload.completed === payload.total });
        });
      } catch {
        // 进度监听失败不应阻止实际导入。
      }
      const added = await api.importVideos(paths);
      importedCount = added.length;
      duplicateCount = paths.length - added.length;
      setProjects((current) => [...added, ...current]);
      const duplicateMessage = duplicateCount ? `，已跳过 ${duplicateCount} 个重复视频` : "";
      const skippedMessage = skipped ? `，已忽略 ${skipped} 个不支持的文件` : "";
      notify({ kind: "success", message: `已导入 ${importedCount} 个视频项目${duplicateMessage}${skippedMessage}` });
      window.setTimeout(() => setProgress(null), 650);
    } catch (error) {
      setProgress(null);
      let libraryRefreshed = false;
      try {
        const refreshed = await api.listProjects();
        setProjects(refreshed);
        libraryRefreshed = true;
      } catch {
        // 保留当前列表，主错误信息更有诊断价值。
      }
      notify({ kind: "error", message: `${libraryRefreshed ? "导入中断，项目库已刷新" : "导入失败"}：${String(error)}` });
    } finally {
      stopListening?.();
      importLock.current = false;
      setImporting(false);
    }
  }

  async function confirmDelete() {
    if (!projectToDelete || deleting) return;
    setDeleting(true);
    try {
      await api.deleteProject(projectToDelete.id);
      setProjects((current) => current.filter((project) => project.id !== projectToDelete.id));
      notify({ kind: "success", message: `已删除视频项目“${projectToDelete.name}”及其全部数据` });
      setProjectToDelete(null);
    } catch (error) {
      notify({ kind: "error", message: String(error) });
    } finally {
      setDeleting(false);
    }
  }

  const progressRatio = progress?.total
    ? Math.min(1, (progress.completed + progress.fileProgress) / progress.total)
    : 0;

  return (
    <div className={`app-shell ${dragActive ? "drag-import-active" : ""}`}>
      <header className="topbar"><Brand /><div className="topbar-actions"><button className="icon-button" onClick={onSettings} aria-label="打开设置"><GearSix size={21} /></button><button className="primary-button" onClick={chooseVideos} disabled={importing}><Plus size={19} weight="bold" />{importing ? "正在导入…" : "导入视频"}</button></div></header>
      <main className="library-page" id="main-content">
        <section className="library-heading"><div><p className="eyebrow">本地媒体库</p><h1>视频项目</h1><p className="heading-note">拖入视频或点击导入，双击卡片开始无损裁剪。</p></div><div className="project-count"><strong>{projects.length}</strong><span>个项目</span></div></section>
        {loading ? <div className="card-grid skeleton-grid">{[1, 2, 3, 4].map((number) => <div className="skeleton-card" key={number} />)}</div> : projects.length ? <section className="card-grid" aria-label="视频项目列表">{projects.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => navigate(`/project/${project.id}`)} onDelete={() => setProjectToDelete(project)} />)}</section> : <section className="empty-state"><div className="empty-icon"><VideoCamera size={34} /></div><h2>还没有视频项目</h2><p>拖拽视频到窗口任意位置，或一次选择多个视频。应用会复制原文件并自动生成首帧封面。</p><button className="primary-button large" onClick={chooseVideos}><UploadSimple size={20} />选择视频文件</button></section>}
      </main>
      {dragActive && <div className="drag-import-overlay" aria-hidden="true"><div><UploadSimple size={42} /><strong>释放以导入视频</strong><span>支持 MP4、MOV、MKV、AVI、WebM、M4V</span></div></div>}
      {progress && <div className="modal-scrim import-progress-scrim"><section className="import-progress-modal" role="dialog" aria-modal="true" aria-labelledby="import-progress-title"><div className={`import-progress-icon ${progress.done ? "done" : ""}`}>{progress.done ? <CheckCircle size={30} weight="fill" /> : <SpinnerGap size={30} className="spin" />}</div><p className="eyebrow">视频导入</p><h2 id="import-progress-title">{progress.done ? "导入完成" : progress.phase}</h2><div className="import-current-file"><FileVideo size={18} /><span title={progress.currentFile}>{progress.currentFile}</span></div><div className="download-progress"><div className="progress-track"><span style={{ transform: `scaleX(${progressRatio})` }} /></div><div className="progress-copy"><span>{progress.completed} / {progress.total} 个文件</span><strong>{Math.round(progressRatio * 100)}%</strong></div></div><p className="import-progress-note">{progress.done ? "视频项目已准备完成" : "导入在后台执行，窗口仍可正常响应"}</p></section></div>}
      {projectToDelete && <div className="modal-scrim delete-confirm-scrim" role="presentation" onMouseDown={(event) => !deleting && event.target === event.currentTarget && setProjectToDelete(null)}><section className="delete-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" aria-describedby="delete-project-description"><div className="delete-confirm-icon"><WarningCircle size={30} weight="fill" /></div><p className="eyebrow">删除视频项目</p><h2 id="delete-project-title">确认删除“{projectToDelete.name}”？</h2><p id="delete-project-description">此操作将永久删除该项目的原视频副本、封面、全部裁剪结果及数据库记录，无法撤销。</p><div className="delete-project-summary"><FileVideo size={19} /><span>{projectToDelete.name}</span></div><div className="delete-confirm-actions"><button className="secondary-button" onClick={() => setProjectToDelete(null)} disabled={deleting} autoFocus>取消</button><button className="danger-button" onClick={confirmDelete} disabled={deleting}>{deleting ? <SpinnerGap size={18} className="spin" /> : <Trash size={18} />}永久删除</button></div></section></div>}
    </div>
  );
}
