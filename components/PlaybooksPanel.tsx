"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal, useFormState, useFormStatus } from "react-dom";
import type { CreateLessonState } from "@/lib/actions";

type Lesson = { id: string; title: string; videoUrl: string | null; content: string | null };
type ModuleWithLessons = { id: string; title: string; lessons: Lesson[] };

// Lives inside the lesson <form> so useFormStatus can see it — closes the
// "Add lesson" modal once a submit finishes with no error, but leaves it
// open (with the error shown) if the link check or anything else failed.
function AddLessonSubmit({ onDone }: { onDone: (success: boolean) => void }) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) onDone(true);
    wasPending.current = pending;
  }, [pending, onDone]);

  return (
    <button type="submit" disabled={pending} className="px-4 py-2 rounded-lg text-sm font-bold btn-cta disabled:opacity-50" style={{ background: "var(--secondary)", color: "#fff" }}>
      {pending ? "Checking link…" : "Add lesson"}
    </button>
  );
}

export default function PlaybooksPanel({
  clientId,
  modules,
  completedLessonIds,
  onToggle,
  onCreateModule,
  onCreateLesson,
}: {
  clientId: string;
  modules: ModuleWithLessons[];
  completedLessonIds: string[];
  onToggle: (clientId: string, lessonId: string, completed: boolean) => Promise<void>;
  onCreateModule: (formData: FormData) => Promise<void>;
  onCreateLesson: (prevState: CreateLessonState, formData: FormData) => Promise<CreateLessonState>;
}) {
  const [completed, setCompleted] = useState<Set<string>>(new Set(completedLessonIds));
  const [openLesson, setOpenLesson] = useState<Lesson | null>(null);
  const [addOpen, setAddOpen] = useState<"module" | "lesson" | null>(null);
  const [mounted, setMounted] = useState(false);
  const [, startTransition] = useTransition();
  const [lessonState, lessonFormAction] = useFormState<CreateLessonState, FormData>(onCreateLesson, null);

  useEffect(() => setMounted(true), []);

  const totalLessons = modules.reduce((sum, m) => sum + m.lessons.length, 0);

  function toggle(lessonId: string) {
    const next = new Set(completed);
    const willComplete = !next.has(lessonId);
    if (willComplete) next.add(lessonId);
    else next.delete(lessonId);
    setCompleted(next);
    startTransition(() => {
      onToggle(clientId, lessonId, willComplete);
    });
  }

  function embedUrl(url: string) {
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
    if (url.includes("loom.com/share/")) return url.replace("/share/", "/embed/");
    return url;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-2">
          <button
            onClick={() => setAddOpen("module")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
            style={{ background: "var(--primary)", color: "#fff" }}
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Add module
          </button>
          <button
            onClick={() => setAddOpen("lesson")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
            style={{ border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Add lesson
          </button>
        </div>
      </div>

      <div className="card rounded-2xl p-5 mb-4 flex justify-between items-center">
        <div>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Our exact growth playbooks</p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Step-by-step systems — read as many as you can, especially before strategy calls.
          </p>
        </div>
        <div className="text-right shrink-0 ml-4">
          <p className="font-heading text-2xl font-bold" style={{ color: "var(--primary)" }}>{completed.size}</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>of {totalLessons} modules</p>
        </div>
      </div>

      <div className="space-y-3">
        {modules.map((mod, i) => (
          <div key={mod.id} className="card rounded-xl overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-3 justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center gap-3">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: "var(--primary)", color: "#fff" }}
                >
                  {i + 1}
                </div>
                <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{mod.title}</p>
              </div>
              <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
                {mod.lessons.filter((l) => completed.has(l.id)).length}/{mod.lessons.length} modules
              </span>
            </div>
            <div>
              {mod.lessons.map((lesson) => {
                const done = completed.has(lesson.id);
                return (
                  <div
                    key={lesson.id}
                    className="flex items-center justify-between px-4 py-3 cursor-pointer"
                    style={{ borderBottom: "1px solid var(--border)" }}
                    onClick={() => setOpenLesson(lesson)}
                  >
                    <span className="text-sm" style={{ color: "var(--text-primary)" }}>{lesson.title}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggle(lesson.id); }}
                      className="w-6 h-6 rounded flex items-center justify-center shrink-0"
                      style={{ background: done ? "var(--primary)" : "var(--surface-hover)", color: done ? "#fff" : "var(--text-muted)" }}
                    >
                      <span className="material-symbols-outlined text-[16px]">check</span>
                    </button>
                  </div>
                );
              })}
              {mod.lessons.length === 0 && (
                <p className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>No lessons in this module yet.</p>
              )}
            </div>
          </div>
        ))}
        {modules.length === 0 && (
          <p style={{ color: "var(--text-secondary)" }}>No playbook modules created yet — click "Add module" above.</p>
        )}
      </div>

      {openLesson && mounted && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setOpenLesson(null)}
        >
          <div className="card rounded-2xl overflow-hidden" style={{ width: "100%", maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
            <div className="p-4 flex justify-between items-center" style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{openLesson.title}</p>
              <button onClick={() => setOpenLesson(null)} style={{ color: "var(--text-muted)" }}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            {openLesson.videoUrl && (
              <div style={{ aspectRatio: "16/9" }}>
                <iframe src={embedUrl(openLesson.videoUrl)} style={{ width: "100%", height: "100%", border: "none" }} allowFullScreen />
              </div>
            )}
            {openLesson.content && (
              <div className="p-5 text-sm" style={{ color: "var(--text-secondary)" }}>{openLesson.content}</div>
            )}
          </div>
        </div>,
        document.body
      )}

      {addOpen === "module" && mounted && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setAddOpen(null)}>
          <div className="card rounded-2xl overflow-hidden" style={{ width: "100%", maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="p-5 flex justify-between items-center" style={{ borderBottom: "1px solid var(--border)" }}>
              <h3 className="font-heading font-bold text-lg" style={{ color: "var(--text-primary)" }}>Add module</h3>
              <button onClick={() => setAddOpen(null)} style={{ color: "var(--text-muted)" }}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form
              action={async (fd) => { await onCreateModule(fd); setAddOpen(null); }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>Module title</label>
                <input name="title" required autoFocus style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} className="px-3 py-2 rounded-lg outline-none text-sm" placeholder="e.g. IG & YT Content" />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAddOpen(null)} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-lg text-sm font-bold" style={{ background: "var(--primary)", color: "#fff" }}>Add module</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {addOpen === "lesson" && mounted && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setAddOpen(null)}>
          <div className="card rounded-2xl overflow-hidden" style={{ width: "100%", maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="p-5 flex justify-between items-center" style={{ borderBottom: "1px solid var(--border)" }}>
              <h3 className="font-heading font-bold text-lg" style={{ color: "var(--text-primary)" }}>Add lesson</h3>
              <button onClick={() => setAddOpen(null)} style={{ color: "var(--text-muted)" }}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form action={lessonFormAction} className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>Module</label>
                <select name="moduleId" required style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} className="px-3 py-2 rounded-lg outline-none text-sm">
                  <option value="">Choose a module...</option>
                  {modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>Lesson title</label>
                <input name="title" required style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} className="px-3 py-2 rounded-lg outline-none text-sm" placeholder="e.g. Messaging mastery" />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>YouTube or Loom link (optional)</label>
                <input name="videoUrl" type="url" style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} className="px-3 py-2 rounded-lg outline-none text-sm" placeholder="https://youtube.com/watch?v=..." />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>Written content (optional)</label>
                <textarea name="content" rows={3} style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} className="px-3 py-2 rounded-lg outline-none text-sm resize-none" />
              </div>
              {lessonState?.error && (
                <p className="text-xs" style={{ color: "var(--danger)" }}>{lessonState.error}</p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setAddOpen(null)} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Cancel</button>
                <AddLessonSubmit onDone={() => { if (!lessonState?.error) setAddOpen(null); }} />
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}