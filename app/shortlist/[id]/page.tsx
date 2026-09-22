import LockedBrief from "@/components/LockedBrief";
import Shortlist from "@/components/Shortlist";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Shortlist renders the step nav itself: its forward button has to
          read the current selection, which is client state. LockedBrief
          is passed through as children so it can stay on the server. */}
      <Shortlist searchId={id}>
        <LockedBrief searchId={id} />
      </Shortlist>
    </main>
  );
}
