import Link from "next/link";
import RoleIntakeForm from "@/components/RoleIntakeForm";

export default function Page() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Role to shortlist
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-600">
            Describe the role once. Everything downstream, the search, the
            candidate cards, the score and the outreach draft, is built from
            what you set here.
          </p>
        </div>
        <Link
          href="/data"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
        >
          Saved data
        </Link>
      </header>
      <RoleIntakeForm />
    </main>
  );
}
