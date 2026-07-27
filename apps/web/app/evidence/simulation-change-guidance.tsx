"use client";

import { useActionState, useState } from "react";
import {
  applySimulationChangeRecommendation,
  generateSimulationChangeRecommendation,
  type ApplySimulationChangeState,
  type GenerateSimulationChangeState,
} from "./actions";
import {
  RecommendationCard,
  RecommendationDecisionForm,
  RecommendationGenerateForm,
  RecommendationPillRow,
} from "../recommendation-ui";

interface Props {
  branchId: string;
  revisionId: string;
}

export function SimulationChangeGuidance({ branchId, revisionId }: Props) {
  const [generateState, generateAction, generating] = useActionState<GenerateSimulationChangeState, FormData>(
    generateSimulationChangeRecommendation,
    null
  );
  const [applyState, applyAction, applying] = useActionState<ApplySimulationChangeState, FormData>(
    applySimulationChangeRecommendation,
    null
  );
  const [editedSummary, setEditedSummary] = useState("");

  if (applyState && "ok" in applyState) {
    return <span className="pill pillAllow">Simulation guidance recorded</span>;
  }

  const recommendation = generateState && "ok" in generateState ? generateState.recommendation : null;

  if (!recommendation) {
    return (
      <RecommendationGenerateForm
        action={generateAction}
        buttonLabel="Review simulation guidance"
        disabled={generating}
        error={generateState && "error" in generateState ? generateState.error : undefined}
        pending={generating}
        pendingLabel="Reviewing replay..."
        title="Generate auditable guidance from this simulation"
      >
        <input type="hidden" name="branchId" value={branchId} />
        <input type="hidden" name="revisionId" value={revisionId} />
      </RecommendationGenerateForm>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <RecommendationCard
        rationale={recommendation.rationale}
        summary={recommendation.summary}
        title={<span className="pill pillNeutral">Simulation guidance</span>}
      >
        <RecommendationPillRow>
          <span className="pill pillNeutral">Confidence {recommendation.confidence}</span>
          <span className="pill pillBlock">{recommendation.newlyDeniedCount} newly denied</span>
          <span className="pill pillAllow">{recommendation.newlyAllowedCount} newly allowed</span>
          <span className="pill pillNeutral">{recommendation.sourceEventCount} source events</span>
        </RecommendationPillRow>
        <div className="policyRefs">
          {recommendation.proposals.map((proposal) => (
            <span className="ruleRef" key={`${proposal.ruleRef}-${proposal.changeType}`}>
              {proposal.ruleRef} / {proposal.affectedEvents} event(s)
            </span>
          ))}
        </div>
      </RecommendationCard>

      <RecommendationDecisionForm
        action={applyAction}
        applying={applying}
        editedSummary={editedSummary}
        error={applyState && "error" in applyState ? applyState.error : undefined}
        hiddenFields={
          <>
            <input type="hidden" name="recommendationId" value={recommendation.recommendationId} />
            <input type="hidden" name="branchId" value={recommendation.branchId} />
            <input type="hidden" name="revisionId" value={recommendation.revisionId} />
            <input type="hidden" name="runId" value={recommendation.runId} />
            <input type="hidden" name="recommendationSummary" value={recommendation.summary} />
          </>
        }
        onEditedSummaryChange={setEditedSummary}
        rationaleId={`simulation-change-rationale-${recommendation.revisionId}`}
        summaryId={`simulation-change-summary-${recommendation.revisionId}`}
      />
    </div>
  );
}
