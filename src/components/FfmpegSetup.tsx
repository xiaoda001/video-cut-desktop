import { CheckCircle, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import type { FfmpegStatus } from "../types";

export function FfmpegSetup({ status, error, onRetry }: {
  status: FfmpegStatus | null;
  error: string;
  onRetry: () => void;
}) {
  if (status?.ready) return null;
  return (
    <div className="modal-scrim ffmpeg-scrim">
      <section className="ffmpeg-setup" role="dialog" aria-modal="true" aria-labelledby="ffmpeg-title">
        <div className={`setup-icon ${error ? "error" : ""}`}>
          {error ? <WarningCircle size={30} /> : <CheckCircle size={30} />}
        </div>
        <p className="eyebrow">首次运行配置</p>
        <h2 id="ffmpeg-title">{error ? "视频引擎安装不完整" : "正在检查视频引擎"}</h2>
        {error ? <>
          <p className="setup-description">{error} 请重新运行 FrameCut 安装程序完成修复。</p>
          <button className="primary-button large" onClick={onRetry}>重新检查</button>
        </> : <>
          <p className="setup-description"><SpinnerGap className="spin inline-spinner" size={16} />正在确认 FFmpeg 安装状态…</p>
        </>}
      </section>
    </div>
  );
}
