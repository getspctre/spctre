"use client";

import { useRef, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  resetTerminologyTermInline,
  saveTerminologyTermInline,
} from "./localization-actions";

interface TerminologyRowControlsProps {
  initialValue?: string;
  label: string;
  locale: string;
  placeholder: string;
  term: string;
}

export function TerminologyOverrideInput({
  initialValue = "",
  label,
  locale,
  placeholder,
  term,
}: TerminologyRowControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const lastSavedValue = useRef(initialValue);

  const save = (value: string) => {
    const customTerm = value.trim();
    if (!customTerm || customTerm === lastSavedValue.current) return;
    startTransition(async () => {
      const result = await saveTerminologyTermInline({ locale, term, customTerm });
      if (result.error) {
        setError(result.error);
        return;
      }
      lastSavedValue.current = customTerm;
      setError(null);
      router.refresh();
    });
  };

  return <>
    <input
      aria-label={`Override ${label}`}
      className="input"
      defaultValue={initialValue}
      disabled={isPending}
      onBlur={(event) => save(event.currentTarget.value)}
      placeholder={placeholder}
    />
    {error ? <p className="meta workspaceError">{error}</p> : null}
  </>;
}

export function TerminologyResetButton({ label, locale, term }: Omit<TerminologyRowControlsProps, "initialValue" | "placeholder">) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    startTransition(async () => {
      const result = await resetTerminologyTermInline({ locale, term });
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  };

  return <>
    <button
      aria-label={`Restore ${label}`}
      className="iconButton"
      disabled={isPending}
      onClick={reset}
      title={`Restore ${label}`}
      type="button"
    >
      <RotateCcw size={16} />
    </button>
    {error ? <p className="meta workspaceError">{error}</p> : null}
  </>;
}
