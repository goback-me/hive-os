import { redirect } from "next/navigation";

// Old link to a call's log page (emails sent before the update panel): the
// client's Weekly status tab with the call's panel open.
export default function OldCallPage({ params }: { params: { slug: string; id: string } }) {
  redirect(`/clients/${params.slug}?tab=weekly&update=${encodeURIComponent(params.id)}`);
}
