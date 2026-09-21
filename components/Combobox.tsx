"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface ComboboxResult {
  values: string[];
  /** Small line under the list saying where the options came from. */
  footer?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Fired when an option is picked, after onChange. */
  onSelect?: (value: string) => void;
  fetchOptions: (query: string) => Promise<ComboboxResult>;
  placeholder?: string;
  className?: string;
  minChars?: number;
  debounceMs?: number;
}

/**
 * Debounced type-ahead over a remote list.
 *
 * Generic on purpose: the title field and the city field want identical
 * behaviour over different endpoints, and the interesting part of each is the
 * fetch, not the keyboard handling.
 */
export default function Combobox({
  value,
  onChange,
  onSelect,
  fetchOptions,
  placeholder,
  className,
  minChars = 2,
  debounceMs = 200,
}: Props) {
  const [options, setOptions] = useState<string[]>([]);
  const [footer, setFooter] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const listId = useId();
  const focused = useRef(false);
  const suppressNext = useRef("");

  useEffect(() => {
    const q = value.trim();

    // Do not immediately re-query the value the user just picked.
    if (q && q === suppressNext.current) return;

    if (q.length < minChars) {
      setOptions([]);
      setOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const result = await fetchOptions(q);
        const values = result.values ?? [];
        setOptions(values);
        setFooter(result.footer);
        setHighlight(-1);
        if (focused.current && values.length > 0) setOpen(true);
      } catch {
        setOptions([]);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
    // fetchOptions is recreated per render by most callers, so keying on it
    // would refetch on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, minChars, debounceMs]);

  const choose = (option: string) => {
    suppressNext.current = option;
    onChange(option);
    onSelect?.(option);
    setOpen(false);
    setHighlight(-1);
    setOptions([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || options.length === 0) {
      if (e.key === "ArrowDown" && options.length > 0) {
        e.preventDefault();
        setOpen(true);
        setHighlight(0);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? options.length - 1 : h - 1));
    } else if (e.key === "Enter" && highlight >= 0) {
      // Stops the surrounding form from submitting the half-typed value.
      e.preventDefault();
      choose(options[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
    }
  };

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          suppressNext.current = "";
          onChange(e.target.value);
        }}
        onFocus={() => {
          focused.current = true;
          if (options.length > 0) setOpen(true);
        }}
        onBlur={() => {
          focused.current = false;
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        className={
          className ??
          "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base font-normal outline-none focus:border-neutral-900"
        }
      />

      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {options.map((option, i) => (
            <li key={option} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                // mousedown fires before blur, so the click is not lost.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(option);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  i === highlight ? "bg-neutral-100" : ""
                }`}
              >
                {option}
              </button>
            </li>
          ))}
          {footer && (
            <li className="mt-1 border-t border-neutral-100 px-3 pt-1 text-[10px] text-neutral-400">
              {footer}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
