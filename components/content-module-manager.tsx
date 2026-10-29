"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, CheckCircle2, FolderUp, RefreshCw, Settings2, Trash2, UploadCloud, X } from "lucide-react";
import { zipSync } from "fflate";
import type { ContentModuleInstallation } from "@/lib/content-module/store";

type PublicInstallation = Pick<ContentModuleInstallation, "id" | "name" | "version" | "fileCount" | "totalBytes" | "installedAt" | "updatedAt" | "runtimeUrl">;
type UploadTicket = { path?: string; token?: string; signedUrl?: string; publicKey?: string; error?: string };

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) throw new Error(response.ok ? "Сервер не вернул данные." : "Сервер вернул пустую ошибку.");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Сервер вернул некорректный ответ. Обновите страницу и повторите попытку.");
  }
}

async function packageFiles(files: File[]) {
  if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) return files[0];
  const entries = await Promise.all(files.map(async (file) => {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    return [relativePath, new Uint8Array(await file.arrayBuffer())] as const;
  }));
  const archive = zipSync(Object.fromEntries(entries), { level: 6 });
  return new File([archive], "content-module.zip", { type: "application/zip" });
}

export function ContentModuleManager({ initialInstallation, isOwner, loadError }: {
  initialInstallation: PublicInstallation | null;
  isOwner: boolean;
  loadError?: string;
}) {
  const router = useRouter();
  const archiveInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [installation, setInstallation] = useState(initialInstallation);
  const [showManagement, setShowManagement] = useState(!initialInstallation);
  const [busy, setBusy] = useState(false);
  const [frameLoading, setFrameLoading] = useState(Boolean(initialInstallation));
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(loadError ? { tone: "error", text: loadError } : null);
  const storageReady = !loadError;

  async function install(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setNotice(null);
    try {
      const archive = await packageFiles(files);
      if (archive.size > 20 * 1024 * 1024) throw new Error("Архив превышает лимит 20 МБ.");
      const ticketResponse = await fetch("/api/content-module", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: archive.name, size: archive.size })
      });
      const ticket = await readJson<UploadTicket>(ticketResponse);
      if (!ticketResponse.ok || !ticket.signedUrl || !ticket.path) throw new Error(ticket.error || "Не удалось подготовить загрузку.");

      const uploadBody = new FormData();
      uploadBody.append("cacheControl", "0");
      uploadBody.append("", archive);
      const uploadHeaders: Record<string, string> = { "x-upsert": "false" };
      if (ticket.publicKey) {
        uploadHeaders.apikey = ticket.publicKey;
        uploadHeaders.Authorization = `Bearer ${ticket.publicKey}`;
      }
      const uploadResponse = await fetch(ticket.signedUrl, { method: "PUT", headers: uploadHeaders, body: uploadBody });
      if (!uploadResponse.ok) throw new Error("Архив не загрузился в Supabase Storage.");

      const installResponse = await fetch("/api/content-module", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ticket.path })
      });
      const result = await readJson<{ module?: PublicInstallation; message?: string; error?: string }>(installResponse);
      if (!installResponse.ok || !result.module) throw new Error(result.error || "Не удалось установить Контент-завод.");
      setInstallation(result.module);
      setFrameLoading(true);
      setShowManagement(false);
      setNotice({ tone: "success", text: result.message || "Контент-завод установлен." });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Не удалось установить Контент-завод." });
    } finally {
      setBusy(false);
      if (archiveInput.current) archiveInput.current.value = "";
      if (folderInput.current) folderInput.current.value = "";
    }
  }

  async function remove() {
    if (!window.confirm("Удалить установленный Контент-завод и его файлы?")) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/content-module", { method: "DELETE" });
      const result = await readJson<{ message?: string; error?: string }>(response);
      if (!response.ok) throw new Error(result.error || "Не удалось удалить модуль.");
      setInstallation(null);
      setShowManagement(true);
      setNotice({ tone: "success", text: result.message || "Контент-завод удалён." });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Не удалось удалить Контент-завод." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="content-module-shell">
      {notice && <div className={`content-module-notice content-module-notice-${notice.tone}`} role="status">
        {notice.tone === "success" ? <CheckCircle2 size={18} /> : <X size={18} />}
        <span>{notice.text}</span>
        {!loadError && <button type="button" onClick={() => setNotice(null)} aria-label="Закрыть сообщение"><X size={16} /></button>}
      </div>}

      {installation && <div className="content-module-statusbar">
        <div className="content-module-status-copy">
          <span className="content-module-live"><i /> Подключён</span>
          <strong>{installation.name}</strong>
          <span>Версия {installation.version} · {installation.fileCount} файлов · {formatBytes(installation.totalBytes)}</span>
        </div>
        {isOwner && <button type="button" className="ui-button ui-button-secondary" onClick={() => setShowManagement((value) => !value)}>
          <Settings2 size={17} /> Управление
        </button>}
      </div>}

      {isOwner && showManagement && <section className="content-module-installer" aria-labelledby="content-module-installer-title">
        <div className="content-module-installer-copy">
          <span className="content-module-installer-icon"><UploadCloud size={22} /></span>
          <div>
            <h1 id="content-module-installer-title">{installation ? "Заменить Контент-завод" : "Установить Контент-завод"}</h1>
            <p>Загрузите ZIP или выберите папку готовой статической сборки. CRM найдёт <code>index.html</code>, сохранит пакет в Supabase и откроет приложение сотрудникам с выданным доступом.</p>
          </div>
        </div>
        <div className="content-module-actions">
          <input ref={archiveInput} type="file" multiple accept=".zip,.html,.css,.js,.mjs,.json,.svg,.png,.jpg,.jpeg,.webp,.gif,.woff,.woff2,.ttf,.otf,.mp4,.webm,.mp3,.wav,.pdf" hidden onChange={(event) => void install(Array.from(event.target.files ?? []))} />
          <input ref={folderInput} type="file" multiple hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(event) => void install(Array.from(event.target.files ?? []))} />
          <button type="button" className="ui-button ui-button-primary" disabled={busy || !storageReady} onClick={() => archiveInput.current?.click()}>
            {busy ? <RefreshCw className="content-module-spin" size={17} /> : <Archive size={17} />} {busy ? "Устанавливаем..." : "Архив или файлы"}
          </button>
          <button type="button" className="ui-button ui-button-secondary" disabled={busy || !storageReady} onClick={() => folderInput.current?.click()}>
            <FolderUp size={17} /> Выбрать папку
          </button>
          {installation && <button type="button" className="ui-button ui-button-danger" disabled={busy || !storageReady} onClick={() => void remove()}>
            <Trash2 size={17} /> Удалить
          </button>}
        </div>
        <div className="content-module-requirements">
          <strong>Поддерживается готовая веб-сборка</strong>
          <span>HTML, CSS, JavaScript, изображения, шрифты и медиа · до 20 МБ в ZIP · серверный код и исходники Next.js устанавливаются только после статической сборки.</span>
        </div>
      </section>}

      {!installation && !isOwner && <section className="content-module-waiting">
        <Archive size={24} />
        <h1>Контент-завод ещё не установлен</h1>
        <p>Установку выполняет руководитель. Вы получите доступ к приложению после загрузки пакета.</p>
      </section>}

      {installation && <div className="content-module-runtime">
        {frameLoading && <div className="content-module-frame-loading" aria-live="polite"><RefreshCw className="content-module-spin" size={20} /> Загружаем Контент-завод...</div>}
        <iframe
          key={installation.runtimeUrl}
          src={installation.runtimeUrl}
          title={installation.name}
          sandbox="allow-scripts allow-forms allow-modals allow-downloads allow-popups"
          onLoad={() => setFrameLoading(false)}
        />
      </div>}
    </div>
  );
}
