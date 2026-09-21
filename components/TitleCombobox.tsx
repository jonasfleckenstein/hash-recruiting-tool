"use client";

import Combobox, { type ComboboxResult } from "@/components/Combobox";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

async function fetchTitles(query: string): Promise<ComboboxResult> {
  const res = await fetch("/api/title-autocomplete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = (await res.json()) as { source: string; values: string[] };
  return {
    values: data.values ?? [],
    footer:
      data.source === "crustdata"
        ? "titles present in the Crustdata index"
        : "local list, add a Crustdata key for indexed titles",
  };
}

/** Job-title type-ahead over values that exist in the Crustdata index. */
export default function TitleCombobox(props: Props) {
  return <Combobox {...props} fetchOptions={fetchTitles} />;
}
