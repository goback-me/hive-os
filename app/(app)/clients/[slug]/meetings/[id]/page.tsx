import { redirect } from "next/navigation";

// Older still: /meetings/<id> → the call's panel on the Weekly status tab.
export default function OldMeetingPage({ params }: { params: { slug: string; id: string } }) {
  redirect(`/clients/${params.slug}?tab=weekly&update=${encodeURIComponent(params.id)}`);
}
