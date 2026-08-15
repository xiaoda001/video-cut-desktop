import { useEffect, useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { FfmpegSetup } from "./components/FfmpegSetup";
import { SettingsModal } from "./components/SettingsModal";
import { Toast, type ToastState } from "./components/Toast";
import { api } from "./lib/api";
import { EditorPage } from "./pages/EditorPage";
import { LibraryPage } from "./pages/LibraryPage";
import type { FfmpegStatus, Settings } from "./types";
import "./styles.css";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsChecked, setSettingsChecked] = useState(false);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [toast, setToast] = useState<ToastState>(null);
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus | null>(null);
  const [ffmpegError, setFfmpegError] = useState("");

  const notify = (next: ToastState) => {
    setToast(next);
    window.setTimeout(() => setToast(null), 4200);
  };

  async function prepareFfmpeg() {
    setFfmpegError("");
    setFfmpegStatus(null);
    try {
      setFfmpegStatus(await api.ensureFfmpeg());
    } catch (error) {
      setFfmpegError(String(error));
    }
  }

  useEffect(() => {
    prepareFfmpeg();
    api.getSettings()
      .then((value) => {
        setSettings(value);
        if (!value.setupCompleted) setSettingsOpen(true);
      })
      .catch((error) => notify({ kind: "error", message: String(error) }))
      .finally(() => setSettingsChecked(true));
  }, []);

  const requiresInitialSetup = settings?.setupCompleted === false;

  return (
    <HashRouter>
      <Routes>
        <Route
          path="/"
          element={<LibraryPage revision={libraryRevision} onSettings={() => setSettingsOpen(true)} notify={notify} />}
        />
        <Route
          path="/project/:id"
          element={<EditorPage settings={settings} onSettings={() => setSettingsOpen(true)} notify={notify} />}
        />
      </Routes>
      <SettingsModal
        open={settingsOpen}
        required={requiresInitialSetup}
        onClose={() => setSettingsOpen(false)}
        onSaved={(value) => {
          setSettings(value);
          setLibraryRevision((current) => current + 1);
          if (window.location.hash !== "#/") window.location.hash = "#/";
          notify({ kind: "success", message: "设置已保存，项目库已刷新" });
        }}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
      {settingsChecked && !requiresInitialSetup && (
        <FfmpegSetup status={ffmpegStatus} error={ffmpegError} onRetry={prepareFfmpeg} />
      )}
    </HashRouter>
  );
}
