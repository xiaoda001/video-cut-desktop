import { Clock, FilmSlate, Play, Trash } from "@phosphor-icons/react";
import { mediaUrl } from "../lib/api";
import type { Clip, Project } from "../types";

export const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

export const formatRangeTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};

export function ProjectCard({ project, onOpen, onDelete }: { project: Project; onOpen: () => void; onDelete: () => void }) {
  return (
    <article className="media-card" tabIndex={0} onDoubleClick={onOpen} onKeyDown={(event) => event.target === event.currentTarget && event.key === "Enter" && onOpen()} aria-label={`${project.name}，双击进入编辑`}>
      <div className="thumbnail"><img src={mediaUrl(project.thumbnailPath)} alt="" loading="lazy" /><button className="project-delete-button" onClick={(event) => { event.stopPropagation(); onDelete(); }} onDoubleClick={(event) => event.stopPropagation()} aria-label={`删除视频项目 ${project.name}`} title="删除项目"><Trash size={17} /></button><div className="duration"><Clock size={13} />{formatTime(project.duration)}</div><div className="open-overlay"><span><FilmSlate size={19} />双击编辑</span></div></div>
      <div className="card-copy"><h3 title={project.name}>{project.name}</h3><p>{new Date(project.createdAt).toLocaleDateString("zh-CN")} 导入</p></div>
    </article>
  );
}

export function ClipCard({ clip, selected, onSelect, onMaximize }: { clip: Clip; selected: boolean; onSelect: () => void; onMaximize: () => void }) {
  return (
    <article className={`clip-card ${selected ? "selected" : ""}`} tabIndex={0} onClick={onSelect} onDoubleClick={onMaximize} onKeyDown={(e) => e.key === "Enter" && onSelect()} aria-label={`片段 ${formatTime(clip.startTime)} 到 ${formatTime(clip.endTime)}`}>
      <div className="clip-thumb"><img src={mediaUrl(clip.thumbnailPath)} alt="" loading="lazy" /><span className="clip-play"><Play size={17} weight="fill" /></span></div>
      <div className="clip-info">
        <span className="clip-range-label">裁剪区间</span>
        <strong>{formatTime(clip.startTime)} — {formatTime(clip.endTime)}</strong>
        <span className="clip-meta">时长 {formatTime(clip.endTime - clip.startTime)} · 双击全屏</span>
      </div>
    </article>
  );
}

export function RangeClipCard({ clip, selected, onPlay }: { clip: Clip; selected: boolean; onPlay: () => void }) {
  return (
    <button className={`range-result ${selected ? "selected" : ""}`} onClick={onPlay} aria-label={`播放区间片段 ${formatRangeTime(clip.startTime)} 到 ${formatRangeTime(clip.endTime)}`}>
      <span className="range-result-thumb">
        <img src={mediaUrl(clip.thumbnailPath)} alt="" />
        <span className="range-result-play"><Play size={15} weight="fill" /></span>
      </span>
      <span className="range-result-copy">
        <small>区间裁剪结果</small>
        <strong>{formatRangeTime(clip.startTime)} — {formatRangeTime(clip.endTime)}</strong>
        <span>点击在播放区域播放</span>
      </span>
    </button>
  );
}
