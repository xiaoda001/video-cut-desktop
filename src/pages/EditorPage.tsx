import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { save } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, ArrowsOut, DownloadSimple, GearSix, Scissors, SpinnerGap } from "@phosphor-icons/react";
import { Brand } from "../components/Icons";
import type { ToastState } from "../components/Toast";
import { ClipCard, formatRangeTime, formatTime, RangeClipCard } from "../components/VideoCard";
import { api, mediaUrl } from "../lib/api";
import type { Clip, Project, Settings } from "../types";

const sortClipsByTime = (items: Clip[]) => [...items].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);

const parseRangeTime = (value: string) => {
  const match = /^(\d{2,}):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

export function EditorPage({ settings, onSettings, notify }: { settings: Settings | null; onSettings: () => void; notify: (toast: ToastState) => void }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [rangeClip, setRangeClip] = useState<Clip | null>(null);
  const [selected, setSelected] = useState<Clip | null>(null);
  const [segmentSeconds, setSegmentSeconds] = useState(settings?.defaultSegmentSeconds ?? 10);
  const [rangeStart, setRangeStart] = useState("00:00");
  const [rangeEnd, setRangeEnd] = useState("00:00");
  const [busy, setBusy] = useState<"split" | "range" | null>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    Promise.all([
      api.getProject(id),
      api.listClips(id),
      api.latestRangeClip(id),
      settings ? Promise.resolve(settings) : api.getSettings()
    ]).then(([nextProject, nextClips, latestRange, nextSettings]) => {
      setProject(nextProject);
      setClips(sortClipsByTime(nextClips));
      setRangeClip(latestRange);
      setPreviewDuration(nextProject.duration);
      setRangeEnd(formatRangeTime(Math.min(nextProject.duration, 10)));
      setSegmentSeconds(nextSettings.defaultSegmentSeconds);
    }).catch((error) => notify({ kind: "error", message: String(error) }));
  }, [id]);

  useEffect(() => {
    if (selected && previewRef.current) {
      setPreviewTime(0);
      setPreviewDuration(selected.endTime - selected.startTime);
      previewRef.current.src = mediaUrl(selected.path);
      previewRef.current.play().catch(() => undefined);
    }
  }, [selected]);

  async function split() {
    if (!project || !Number.isFinite(segmentSeconds) || segmentSeconds <= 0) return notify({ kind: "error", message: "平均裁剪秒数必须大于 0" });
    const selectedWillBeCleared = selected !== null && clips.some((clip) => clip.id === selected.id);
    setClips([]);
    if (selectedWillBeCleared && previewRef.current) {
      setSelected(null);
      setPreviewTime(0);
      setPreviewDuration(project.duration);
      previewRef.current.pause();
      previewRef.current.src = mediaUrl(project.originalPath);
      previewRef.current.load();
    }
    setBusy("split");
    try {
      const next = await api.splitEvenly(id, segmentSeconds);
      setClips(sortClipsByTime(next));
      notify({ kind: "success", message: `裁剪完成，共生成 ${next.length} 个片段` });
    } catch (error) {
      try {
        setClips(sortClipsByTime(await api.listClips(id)));
      } catch {
        // 保持列表为空，避免展示已经失效的旧裁剪结果。
      }
      notify({ kind: "error", message: String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function cutRange() {
    const start = parseRangeTime(rangeStart);
    const end = parseRangeTime(rangeEnd);
    if (!project || start === null || end === null || end <= start || end > project.duration) {
      return notify({ kind: "error", message: "请按 00:00 格式填写有效区间，结束时间需大于开始时间且不超过视频时长" });
    }
    setBusy("range");
    try {
      const clip = await api.cutRange(id, start, end);
      setRangeClip(clip);
      notify({ kind: "success", message: "区间片段已生成" });
    } catch (error) {
      notify({ kind: "error", message: String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function exportSelected() {
    if (!selected) return;
    const ext = selected.path.split(".").pop() || "mp4";
    const destination = await save({ title: "导出裁剪视频", defaultPath: `clip-${formatTime(selected.startTime).replaceAll(":", "-")}.${ext}`, filters: [{ name: "视频", extensions: [ext] }] });
    if (!destination) return;
    try {
      await api.exportClip(selected.id, destination);
      notify({ kind: "success", message: "视频已导出" });
    } catch (error) {
      notify({ kind: "error", message: String(error) });
    }
  }

  async function maximize() {
    if (previewRef.current?.requestFullscreen) await previewRef.current.requestFullscreen();
  }

  function playClip(clip: Clip) {
    if (selected?.id === clip.id) previewRef.current?.play().catch(() => undefined);
    else setSelected(clip);
  }

  if (!project) return <div className="center-screen"><SpinnerGap size={28} className="spin" /><span>正在加载视频项目…</span></div>;

  return (
    <div className="app-shell editor-shell">
      <header className="topbar">
        <div className="header-left"><button className="icon-button" onClick={() => navigate("/")} aria-label="返回项目列表"><ArrowLeft size={21} /></button><Brand /><span className="header-divider" /><span className="current-project" title={project.name}>{project.name}</span></div>
        <button className="icon-button" onClick={onSettings} aria-label="打开设置"><GearSix size={21} /></button>
      </header>
      <main className="editor-page">
        <section className="preview-panel"><div className="video-stage"><video ref={previewRef} src={mediaUrl(project.originalPath)} controls preload="metadata" onTimeUpdate={(event) => setPreviewTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setPreviewDuration(event.currentTarget.duration); }} onEmptied={() => setPreviewTime(0)} /><div className="stage-label">{selected ? `片段 ${formatTime(selected.startTime)} — ${formatTime(selected.endTime)}` : "原视频"}</div><div className="stage-time" aria-label={`播放时间 ${formatTime(previewTime)}，总时长 ${formatTime(previewDuration)}`}>{formatTime(previewTime)} / {formatTime(previewDuration)}</div>{selected && <button className="stage-action" onClick={maximize}><ArrowsOut size={17} />最大化</button>}</div></section>
        <aside className="tools-panel">
          <div className="tools-title"><p className="eyebrow">裁剪工具</p><h2>创建新片段</h2><p>所有操作都会保留原视频。</p></div>
          <section className="tool-block"><div className="tool-heading"><span className="tool-number">01</span><div><h3>平均时长裁剪</h3><p>按固定秒数切分整个视频</p></div></div><label className="field compact-field"><span>每段时长（秒）</span><input type="number" min="0.1" step="0.1" value={segmentSeconds} onChange={(event) => setSegmentSeconds(Number(event.target.value))} /></label><button className="primary-button full" onClick={split} disabled={busy !== null}>{busy === "split" ? <SpinnerGap className="spin" size={18} /> : <Scissors size={18} />}裁剪全部</button></section>
          <section className="tool-block">
            <div className="tool-heading"><span className="tool-number">02</span><div><h3>指定区间裁剪</h3><p>精确提取一个独立片段</p></div></div>
            <div className="range-fields"><label className="field compact-field"><span>开始</span><input type="text" inputMode="numeric" placeholder="00:00" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} aria-label="开始时间，格式为分分冒号秒秒" /></label><label className="field compact-field"><span>结束</span><input type="text" inputMode="numeric" placeholder="00:00" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} aria-label="结束时间，格式为分分冒号秒秒" /></label></div>
            <p className="duration-hint">时间格式 00:00 · 原视频总时长 {formatTime(project.duration)}</p>
            <button className="secondary-button full" onClick={cutRange} disabled={busy !== null}>{busy === "range" ? <SpinnerGap className="spin" size={18} /> : <Scissors size={18} />}生成区间片段</button>
            {rangeClip && <RangeClipCard clip={rangeClip} selected={selected?.id === rangeClip.id} onPlay={() => playClip(rangeClip)} />}
          </section>
        </aside>
        <section className="clips-panel"><header className="clips-header"><div><p className="eyebrow">裁剪结果</p><h2>视频片段 <span>{clips.length}</span></h2></div><button className="secondary-button" onClick={exportSelected} disabled={!selected}><DownloadSimple size={18} />导出所选</button></header>{clips.length ? <div className="clip-grid">{clips.map((clip) => <ClipCard key={clip.id} clip={clip} selected={selected?.id === clip.id} onSelect={() => setSelected(clip)} onMaximize={() => { setSelected(clip); window.setTimeout(maximize, 80); }} />)}</div> : <div className="clips-empty"><Scissors size={26} /><div><strong>暂无裁剪片段</strong><span>使用平均时长裁剪后，结果会显示在这里。</span></div></div>}</section>
      </main>
    </div>
  );
}
