"use client";

import { useEffect, useRef } from "react";
import DOMPurify from "dompurify";

// Lesson content: a small WYSIWYG editor (the browser's own contentEditable +
// execCommand — no editor library) that stores HTML, and RichContent, which
// shows it. Everything shown goes through sanitize(): scripts, styles and
// event handlers are stripped, and only video players from the hosts below
// may be embedded.
// ponytail: execCommand is deprecated but supported everywhere; swap for
// TipTap if we ever need tables or drag-and-drop blocks.

const EMBED_HOSTS = ["www.youtube.com", "www.youtube-nocookie.com", "www.loom.com", "player.vimeo.com"];

// A YouTube / Loom / Vimeo page link → its embeddable player URL.
export function embedUrl(url: string) {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  if (url.includes("loom.com/share/")) return url.replace("/share/", "/embed/");
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return url;
}

let hooked = false;
function sanitize(html: string) {
  if (typeof window === "undefined") return ""; // DOMPurify needs a DOM — content renders client-side only
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook("uponSanitizeElement", (node, data) => {
      if (data.tagName !== "iframe") return;
      let host = "";
      try { host = new URL((node as Element).getAttribute("src") ?? "").host; } catch {}
      if (!EMBED_HOSTS.includes(host)) node.parentNode?.removeChild(node);
    });
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }
  return DOMPurify.sanitize(html, { ADD_TAGS: ["iframe"], ADD_ATTR: ["allowfullscreen", "allow", "target"], FORBID_ATTR: ["style"] });
}

// Older lessons are plain text — blank lines become paragraphs.
function toHtml(content: string | null | undefined) {
  if (!content) return "";
  if (/<[a-z][\s\S]*>/i.test(content)) return content;
  const esc = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.split(/\n\s*\n/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

export function RichContent({ html }: { html: string | null }) {
  return <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitize(toHtml(html)) }} />;
}

const TOOLS: { icon: string; title: string; run: () => void }[] = [
  { icon: "format_bold", title: "Bold", run: () => document.execCommand("bold") },
  { icon: "format_italic", title: "Italic", run: () => document.execCommand("italic") },
  { icon: "format_underlined", title: "Underline", run: () => document.execCommand("underline") },
  { icon: "format_h2", title: "Heading", run: () => document.execCommand("formatBlock", false, "<h2>") },
  { icon: "format_h3", title: "Sub-heading", run: () => document.execCommand("formatBlock", false, "<h3>") },
  { icon: "notes", title: "Normal text", run: () => document.execCommand("formatBlock", false, "<p>") },
  { icon: "format_list_bulleted", title: "Bullet list", run: () => document.execCommand("insertUnorderedList") },
  { icon: "format_list_numbered", title: "Numbered list", run: () => document.execCommand("insertOrderedList") },
  { icon: "format_quote", title: "Quote / callout", run: () => document.execCommand("formatBlock", false, "<blockquote>") },
  {
    icon: "link",
    title: "Link (select text first)",
    run: () => {
      const url = prompt("Link URL", "https://");
      if (url && url !== "https://") document.execCommand("createLink", false, url);
    },
  },
  {
    icon: "image",
    title: "Image (paste an image URL)",
    run: () => {
      const url = prompt("Image URL", "https://");
      if (url && url !== "https://") document.execCommand("insertImage", false, url);
    },
  },
  {
    icon: "smart_display",
    title: "Embed a YouTube, Loom or Vimeo video",
    run: () => {
      const url = prompt("YouTube, Loom or Vimeo link", "https://");
      if (!url || url === "https://") return;
      const src = embedUrl(url.trim());
      let host = "";
      try { host = new URL(src).host; } catch {}
      if (!EMBED_HOSTS.includes(host)) return alert("Only YouTube, Loom and Vimeo videos can be embedded.");
      document.execCommand("insertHTML", false, `<div class="embed"><iframe src="${src.replace(/"/g, "&quot;")}" allowfullscreen></iframe></div><p><br></p>`);
    },
  },
  { icon: "horizontal_rule", title: "Divider", run: () => document.execCommand("insertHorizontalRule") },
  { icon: "format_clear", title: "Clear formatting", run: () => document.execCommand("removeFormat") },
];

// Drop-in for a <textarea name=…> inside a form: the HTML rides in a hidden input.
export function RichTextEditor({ name, defaultValue, placeholder = "Write the lesson…" }: { name: string; defaultValue?: string | null; placeholder?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const initial = toHtml(defaultValue);

  function sync() {
    const el = ref.current!;
    const empty = !el.textContent?.trim() && !el.querySelector("img, iframe, hr");
    input.current!.value = empty ? "" : el.innerHTML;
  }

  useEffect(() => {
    const el = ref.current!;
    el.innerHTML = sanitize(initial);
    sync();
    // AddLessonForm resets its form after a save — clear the editor with it.
    const form = el.closest("form");
    const reset = () => { el.innerHTML = sanitize(initial); };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--surface-card)" }}>
      <div className="flex flex-wrap gap-0.5 p-1" style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        {TOOLS.map((t) => (
          <button
            key={t.icon}
            type="button"
            title={t.title}
            aria-label={t.title}
            // mousedown + preventDefault keeps the text selection in the editor
            onMouseDown={(e) => { e.preventDefault(); ref.current?.focus(); t.run(); sync(); }}
            className="w-8 h-8 rounded flex items-center justify-center hover:bg-[var(--surface-hover)]"
            style={{ color: "var(--text-secondary)" }}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
          </button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={sync}
        onBlur={sync}
        data-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        className="rich-content rich-editor px-4 py-3 outline-none overflow-y-auto"
        style={{ minHeight: 200, maxHeight: "60vh" }}
      />
      <input type="hidden" name={name} ref={input} defaultValue={initial} />
    </div>
  );
}
