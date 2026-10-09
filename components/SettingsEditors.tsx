"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  updateOnboardingStepTemplate,
  deleteOnboardingStepTemplate,
  updateModule,
  deleteModule,
  updateLesson,
  deleteLesson,
  type CreateLessonState,
} from "@/lib/actions";
import { RichTextEditor } from "@/components/RichText";

// Settings: click a row to open its text for editing (native <details>), Save
// or Delete in place. Deletes ask first — they drop every client's progress.
const inputStyle = { width: "100%", background: "var(--surface-card)", border: "1px solid var(--border)", color: "var(--text-primary)" } as const;
const inputClass = "px-3 py-2 rounded-lg outline-none text-sm";

function Buttons({ deleteAction, what }: { deleteAction: (fd: FormData) => Promise<void>; what: string }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex justify-end gap-2">
      <button
        formAction={deleteAction}
        formNoValidate
        disabled={pending}
        onClick={(e) => { if (!confirm(`Delete this ${what}? Every client's progress on it goes too.`)) e.preventDefault(); }}
        className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
        style={{ border: "1px solid var(--border)", color: "var(--danger)" }}
      >
        Delete
      </button>
      <button type="submit" disabled={pending} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50" style={{ background: "var(--primary)", color: "#fff" }}>
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function Row({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="rounded-lg" style={{ background: "var(--surface)" }}>
      <summary className="flex items-center gap-3 p-3 cursor-pointer list-none">
        <div className="flex-1 min-w-0">{summary}</div>
        <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--text-muted)" }}>edit</span>
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
}

export function StepEditor({ index, step }: { index: number; step: { id: string; title: string; description: string | null } }) {
  return (
    <Row
      summary={
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold w-5" style={{ color: "var(--text-muted)" }}>{index + 1}</span>
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{step.title}</p>
            {step.description && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{step.description}</p>}
          </div>
        </div>
      }
    >
      <form action={updateOnboardingStepTemplate} className="space-y-2">
        <input type="hidden" name="id" value={step.id} />
        <input name="title" required defaultValue={step.title} placeholder="Step title" style={inputStyle} className={inputClass} />
        <textarea name="description" defaultValue={step.description ?? ""} placeholder="Description (optional)" rows={2} style={inputStyle} className={`${inputClass} resize-y`} />
        <Buttons deleteAction={deleteOnboardingStepTemplate} what="step" />
      </form>
    </Row>
  );
}

export function ModuleEditor({ index, mod }: { index: number; mod: { id: string; title: string; lessons: { id: string; title: string; videoUrl: string | null; content: string | null }[] } }) {
  return (
    <div className="rounded-lg p-2 space-y-1" style={{ border: "1px solid var(--border)" }}>
      <Row
        summary={
          <>
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{index + 1}. {mod.title}</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{mod.lessons.length} lesson{mod.lessons.length !== 1 ? "s" : ""}</p>
          </>
        }
      >
        <form action={updateModule} className="space-y-2">
          <input type="hidden" name="id" value={mod.id} />
          <input name="title" required defaultValue={mod.title} placeholder="Module title" style={inputStyle} className={inputClass} />
          <Buttons deleteAction={deleteModule} what="module and all its lessons" />
        </form>
      </Row>
      {mod.lessons.map((l) => <LessonEditor key={l.id} lesson={l} />)}
    </div>
  );
}

function LessonEditor({ lesson }: { lesson: { id: string; title: string; videoUrl: string | null; content: string | null } }) {
  const [state, formAction] = useFormState<CreateLessonState, FormData>(updateLesson, null);
  return (
    <div className="ml-6">
      <Row summary={<p className="text-sm" style={{ color: "var(--text-primary)" }}>{lesson.title}</p>}>
        <form action={formAction} className="space-y-2">
          <input type="hidden" name="id" value={lesson.id} />
          <input name="title" required defaultValue={lesson.title} placeholder="Lesson title" style={inputStyle} className={inputClass} />
          <input name="videoUrl" type="url" defaultValue={lesson.videoUrl ?? ""} placeholder="YouTube or Loom link (optional)" style={inputStyle} className={inputClass} />
          <RichTextEditor name="content" defaultValue={lesson.content} />
          {state?.error && <p className="text-xs" style={{ color: "var(--danger)" }}>{state.error}</p>}
          <Buttons deleteAction={deleteLesson} what="lesson" />
        </form>
      </Row>
    </div>
  );
}
