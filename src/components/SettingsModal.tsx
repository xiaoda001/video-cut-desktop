import { useEffect, useState } from "react";
import { FolderOpen, X } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import type { Settings } from "../types";

export function SettingsModal({ open: visible, required = false, onClose, onSaved }: {
  open: boolean; required?: boolean; onClose: () => void; onSaved: (settings: Settings) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (visible) api.getSettings().then(setSettings).catch((e) => setError(String(e)));
  }, [visible]);

  if (!visible) return null;
  async function chooseFolder() {
    const selected = await open({ directory: true, multiple: false, title: "选择项目存储位置" });
    if (selected && settings) setSettings({ ...settings, storagePath: selected });
  }
  async function save() {
    if (!settings || settings.defaultSegmentSeconds <= 0) {
      setError("默认裁剪秒数必须大于 0"); return;
    }
    setSaving(true); setError("");
    try { onSaved(await api.saveSettings(settings)); onClose(); }
    catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }
  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(e) => !required && e.target === e.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal-header">
          <div><p className="eyebrow">偏好设置</p><h2 id="settings-title">应用设置</h2></div>
          {!required && <button className="icon-button" onClick={onClose} aria-label="关闭设置"><X size={20} /></button>}
        </header>
        {settings ? <div className="settings-form">
          <label className="field"><span>默认平均裁剪秒数</span><input type="number" min="0.1" step="0.1" value={settings.defaultSegmentSeconds} onChange={(e) => setSettings({ ...settings, defaultSegmentSeconds: Number(e.target.value) })} /><small>进入编辑页时自动填入，可随时单独修改。</small></label>
          <label className="setting-toggle"><span><strong>导入视频是否自动裁剪</strong><small>根据默认秒数自动裁剪。</small></span><input type="checkbox" checked={settings.autoCutOnImport} onChange={(e) => setSettings({ ...settings, autoCutOnImport: e.target.checked })} /></label>
          <label className="field"><span>视频项目存储位置</span><div className="path-control"><input readOnly value={settings.storagePath} title={settings.storagePath} /><button className="secondary-button" onClick={chooseFolder} type="button"><FolderOpen size={18} />选择</button></div><small>修改后仅影响新导入项目，已有项目不会被移动。</small></label>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div> : <div className="loading-panel">正在读取设置…</div>}
        <footer className="modal-footer">{!required && <button className="ghost-button" onClick={onClose}>取消</button>}<button className="primary-button" disabled={!settings || saving} onClick={save}>{saving ? "保存中…" : "保存设置"}</button></footer>
      </section>
    </div>
  );
}
