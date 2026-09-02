"use client";

import { useRouter } from "next/navigation";

export default function ClientFilter({
  clients,
  activeSlug,
}: {
  clients: { slug: string; name: string }[];
  activeSlug: string;
}) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-sm bg-white px-md py-sm rounded-lg border border-primary/10">
      <span className="material-symbols-outlined text-body-md text-on-surface-variant">filter_list</span>
      <span className="font-label-md text-on-surface-variant">Client:</span>
      <select
        value={activeSlug}
        onChange={(e) => router.push(`/leads?client=${e.target.value}`)}
        className="font-label-md text-primary bg-transparent outline-none cursor-pointer"
      >
        {clients.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
