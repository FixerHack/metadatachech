import { useCallback, useEffect, useState } from "react";
import { api, can, UNAUTHORIZED_EVENT, type FileListItem, type Project, type User } from "./api";
import { Sidebar } from "./components/Sidebar";
import { FileView } from "./components/FileView";
import { AuthScreen } from "./components/AuthScreen";
import { ProjectSettings } from "./components/ProjectSettings";
import { useAppEvent, useEventStream } from "./events";

function readHash() {
  return window.location.hash.replace(/^#\/?/, "") || null;
}

/** Gate: resolves the session first, then renders the workspace or the login screen. */
export function App() {
  const [auth, setAuth] = useState<{ user: User | null; firstRun: boolean } | null>(null);

  useEffect(() => {
    api.me().then(setAuth, () => setAuth({ user: null, firstRun: false }));
    const onUnauthorized = () => setAuth((a) => ({ user: null, firstRun: a?.firstRun ?? false }));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (!auth) return <div className="muted pad">Завантаження…</div>;
  if (!auth.user) return <AuthScreen firstRun={auth.firstRun} onAuthed={(user) => setAuth({ user, firstRun: false })} />;
  return (
    <Workspace
      key={auth.user.id}
      user={auth.user}
      onLogout={async () => {
        await api.logout().catch(() => undefined);
        setAuth({ user: null, firstRun: false });
      }}
    />
  );
}

const PROJECT_KEY = "mc:project";
const readProjectPref = () => {
  try {
    return localStorage.getItem(PROJECT_KEY) || "all";
  } catch {
    return "all";
  }
};

function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [files, setFiles] = useState<FileListItem[]>([]);
  const [projects, setProjects] = useState<Project[] | null>(null);
  /** "all" or a project id. */
  const [current, setCurrent] = useState<string>(readProjectPref);
  const [settings, setSettings] = useState<{ project: Project | null } | null>(null);
  const [selected, setSelected] = useState<string | null>(readHash);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped after batch edits so the open file reloads. */
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [f, p] = await Promise.all([api.list(), api.projects()]);
      setFiles(f);
      setProjects(p);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onHash = () => setSelected(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [refresh]);

  useEventStream(true);
  useAppEvent((e) => {
    // Anything that changes counters, lists or access: refresh the sidebar.
    if (e.type !== "mention") refresh();
  });

  // Fall back to "all" if the remembered project disappeared or access was revoked.
  useEffect(() => {
    if (projects && current !== "all" && !projects.some((p) => p.id === current)) setCurrent("all");
  }, [projects, current]);

  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_KEY, current);
    } catch {
      /* storage unavailable */
    }
  }, [current]);

  const select = (id: string | null) => {
    window.location.hash = id ? `/${id}` : "";
    setSelected(id);
  };

  const currentProject = projects?.find((p) => p.id === current) ?? null;
  const uploadTarget =
    currentProject && can(currentProject.role, "editor")
      ? currentProject
      : current === "all"
        ? projects?.find((p) => can(p.role, "editor")) ?? null
        : null;
  const visibleFiles = current === "all" ? files : files.filter((f) => f.project_id === current);

  const upload = async (list: File[]) => {
    if (!list.length) return;
    if (!uploadTarget) {
      setError("Немає проєкту, куди тобі можна завантажувати. Створи свій або попроси роль «Редактор».");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const res = await api.upload(list, uploadTarget.id);
      if (res.errors.length) setError(res.errors.map((e) => `${e.name}: ${e.error}`).join("; "));
      await refresh();
      if (res.results[0]) select(res.results[0].id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    await api.remove(id);
    if (selected === id) select(null);
    refresh();
  };

  return (
    <div className="layout">
      <Sidebar
        files={visibleFiles}
        showProject={current === "all"}
        projects={projects ?? []}
        current={current}
        onProject={(id) => {
          setCurrent(id);
          select(null);
        }}
        onNewProject={() => setSettings({ project: null })}
        onProjectSettings={() => currentProject && setSettings({ project: currentProject })}
        uploadTarget={uploadTarget}
        selected={selected}
        onSelect={select}
        onUpload={upload}
        uploading={uploading}
        user={user}
        onLogout={onLogout}
        onBatchDone={() => {
          refresh();
          setReloadKey((k) => k + 1);
        }}
      />
      <main className="main">
        {error && (
          <div className="banner error" role="alert">
            {error}
            <button className="link" onClick={() => setError(null)}>Закрити</button>
          </div>
        )}
        {selected ? (
          <FileView
            key={`${selected}:${reloadKey}`}
            id={selected}
            user={user}
            projects={projects ?? []}
            onDelete={remove}
            onChanged={refresh}
          />
        ) : projects && projects.length === 0 ? (
          <div className="hero-drop static">
            <div className="hero-icon" aria-hidden>▣</div>
            <h1>Почни з проєкту</h1>
            <p>
              Файли живуть у проєктах. Створи проєкт і додай колег з потрібними ролями, або попроси когось додати тебе до
              свого.
            </p>
            <button className="btn primary" onClick={() => setSettings({ project: null })}>Створити проєкт</button>
          </div>
        ) : (
          <EmptyState onUpload={upload} uploading={uploading} target={uploadTarget} />
        )}
      </main>
      {settings && (
        <ProjectSettings
          project={settings.project}
          me={user}
          onClose={() => setSettings(null)}
          onChanged={(createdId, deleted) => {
            if (createdId) setCurrent(createdId);
            if (deleted) setCurrent("all");
            refresh();
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ onUpload, uploading, target }: { onUpload: (f: File[]) => void; uploading: boolean; target: Project | null }) {
  const [over, setOver] = useState(false);
  if (!target) {
    return (
      <div className="hero-drop static">
        <div className="hero-icon" aria-hidden>⌕</div>
        <h1>Тут лише перегляд</h1>
        <p>У цьому проєкті ти не можеш завантажувати файли. Обери файл ліворуч або попроси власника проєкту роль «Редактор».</p>
      </div>
    );
  }
  return (
    <label
      className={`hero-drop ${over ? "over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onUpload([...e.dataTransfer.files]);
      }}
    >
      <input type="file" multiple hidden onChange={(e) => onUpload([...(e.target.files ?? [])])} />
      <div className="hero-icon" aria-hidden>⌕</div>
      <h1>Що розповідає твій файл?</h1>
      <p>
        Перетягни сюди фото, відео, аудіо, PDF чи документ. Витягнемо всі метадані: EXIF, XMP, IPTC, GPS, MakerNotes,
        серійні номери, історію редагувань, і покажемо, що з цього небезпечно.
      </p>
      <span className="btn primary">{uploading ? "Аналізуємо…" : "Обрати файли"}</span>
      <span className="muted small">Буде завантажено в проєкт «{target.name}»</span>
    </label>
  );
}
