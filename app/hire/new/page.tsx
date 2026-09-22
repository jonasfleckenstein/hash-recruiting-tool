import Link from "next/link";
import RoleIntakeForm from "@/components/RoleIntakeForm";

/**
 * Step 1 of a hire: the brief.
 *
 * Lives on its own route rather than on the homepage because what is set
 * here shapes the Crustdata query and cannot be changed afterwards. A
 * page you navigate to, and can abandon without consequence, reads as a
 * more deliberate act than a form sitting under a list.
 */
export default function Page() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
        >
          ← All hires
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          New hire
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-600">
          Describe the role once. The title, location, evidence
          requirements and must-haves shape the search itself and are
          fixed once it runs. Weights, shortlist length and anything
          judged rather than filtered stay editable afterwards.
        </p>
      </header>
      <RoleIntakeForm />
    </main>
  );
}
