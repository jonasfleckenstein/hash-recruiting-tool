import RoleIntakeForm from "@/components/RoleIntakeForm";

export default function Page() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Role to shortlist
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-600">
          Step 1 of 5. Describe the role once. Everything downstream, the search,
          the candidate cards, the score and the outreach draft, is built from
          what you set here.
        </p>
      </header>
      <RoleIntakeForm />
    </main>
  );
}
