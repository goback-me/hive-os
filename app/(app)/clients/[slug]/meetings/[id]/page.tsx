import { redirect } from "next/navigation";

// Old path for a call's log form — emails sent before the move still link here.
export default function OldMeetingPage({ params, searchParams }: { params: { slug: string; id: string }; searchParams: { a?: string } }) {
  redirect(`/clients/${params.slug}/calls/${params.id}${searchParams.a ? `?a=${encodeURIComponent(searchParams.a)}` : ""}`);
}
