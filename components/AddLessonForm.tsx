"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createLesson, type CreateLessonState } from "@/lib/actions";

// Lives inside the <form> so useFormStatus can see it. Resets the
// (uncontrolled) inputs after a successful submit — needed now that the
// action is client-intercepted rather than a full page navigation, which
// used to reset the form for free.
function SubmitButton({ formRef, hasError }: { formRef: RefObject<HTMLFormElement>; hasError: boolean }) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !hasError) formRef.current?.reset();
    wasPending.current = pending;
  }, [pending, hasError, formRef]);

  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 rounded-lg text-sm font-bold btn-cta disabled:opacity-50"
      style={{ background: "var(--secondary)", color: "#fff" }}
    >
      {pending ? "Checking link…" : "Add lesson"}
    </button>
  );
}

export default function AddLessonForm({ modules }: { modules: { id: string; title: string }[] }) {
  const [state, formAction] = useFormState<CreateLessonState, FormData>(createLesson, null);
  const formRef = useRef<HTMLFormElement>(null);

  const inputStyle = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" } as const;

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <select name="moduleId" required style={inputStyle} className="px-3 py-2 rounded-lg outline-none text-sm">
        <option value="">Choose a module...</option>
        {modules.map((m) => (
          <option key={m.id} value={m.id}>
            {m.title}
          </option>
        ))}
      </select>
      <input name="title" required placeholder="Lesson title" style={inputStyle} className="px-3 py-2 rounded-lg outline-none text-sm" />
      <input
        name="videoUrl"
        type="url"
        placeholder="YouTube or Loom link (optional) — e.g. https://..."
        style={inputStyle}
        className="px-3 py-2 rounded-lg outline-none text-sm"
      />
      <textarea name="content" placeholder="Written content (optional)" rows={3} style={inputStyle} className="px-3 py-2 rounded-lg outline-none text-sm resize-none" />
      {state?.error && (
        <p className="text-xs" style={{ color: "var(--danger)" }}>
          {state.error}
        </p>
      )}
      <SubmitButton formRef={formRef} hasError={Boolean(state?.error)} />
    </form>
  );
}
