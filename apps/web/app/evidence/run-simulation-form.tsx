"use client";

import { useActionState, useEffect } from "react";
import { CheckCircle2, Loader, Play } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { runSimulation } from "./actions";
import type { SimulationState } from "./actions";
import { formatProvenanceId, type AppViewMode } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";

interface Branch {
  id: string;
  name: string;
  activeRevision: string;
  scope: string;
}

interface RunSimulationFormProps {
  branches: Branch[];
  viewMode: AppViewMode;
}

function isSimulationSuccess(
  state: SimulationState,
): state is {
  newlyDenied: number;
  newlyAllowed: number;
  unchanged: number;
  total: number;
  branchId: string;
  revisionId: string;
  runId: string;
} {
  return !!state && !("error" in state);
}

export function RunSimulationForm({ branches, viewMode }: RunSimulationFormProps) {
  const [state, action, isPending] = useActionState<SimulationState, FormData>(runSimulation, null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isSimulationSuccess(state)) return;
    if (searchParams.get("sim_run") === state.runId) return;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("sim_run", state.runId);
    router.replace(`${pathname}?${nextParams.toString()}`);
  }, [pathname, router, searchParams, state]);

  return (
    <form className="simulationRunForm" action={action}>
      <div className="simulationRunControls">
        <label>
          <span>Branch</span>
          <select name="branchId" defaultValue="">
            <option value="">Latest revision</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.scope})
              </option>
            ))}
          </select>
        </label>
        <button className="button buttonPrimary" type="submit" disabled={isPending}>
          {isPending ? <Loader size={15} className="spin" /> : <Play size={15} />}
          {isPending ? "Running…" : "Run replay"}
        </button>
      </div>

      {state?.error ? (
        <p className="importError">{state.error}</p>
      ) : isSimulationSuccess(state) ? (
        <div className="simulationRunResult">
          <CheckCircle2 size={14} className="allowIcon" />
          <span className="meta">
            Simulation complete — revision{" "}
            <code>{formatProvenanceId(state.revisionId, viewMode, 12, hashToFingerprint)}</code>{" "}
            against {state.total} events:{" "}
          </span>
          {state.newlyDenied > 0 && (
            <span className="pill pillBlock">{state.newlyDenied} newly denied</span>
          )}
          {state.newlyAllowed > 0 && (
            <span className="pill pillAllow">{state.newlyAllowed} newly allowed</span>
          )}
          <span className="pill">{state.unchanged} unchanged</span>
        </div>
      ) : null}
    </form>
  );
}
