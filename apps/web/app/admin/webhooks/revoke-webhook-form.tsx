"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { ConfirmSubmitButton } from "../confirm-submit-button";
import { AdminMutationStatus } from "../mutation-status";
import { revokeGatewayWebhook } from "./actions";

function RevokeButton({ confirmMessage, revoked }: { confirmMessage: string; revoked: boolean }) {
  const t = useTranslations("admin.webhooks.revoke");
  const { pending } = useFormStatus();
  return (
    <ConfirmSubmitButton
      className="button buttonDanger"
      confirmMessage={confirmMessage}
      disabled={pending || revoked}
    >
      {revoked ? t("revoked") : pending ? t("revoking") : t("revoke")}
    </ConfirmSubmitButton>
  );
}

export function RevokeWebhookForm({
  registrationId,
  label,
}: {
  registrationId: string;
  label: string;
}) {
  const t = useTranslations("admin.webhooks.revoke");
  const [state, action] = useActionState(revokeGatewayWebhook, null);
  const revoked = Boolean(state?.ok);

  return (
    <form action={action} className="adminMutationForm">
      <input type="hidden" name="registrationId" value={registrationId} />
      <RevokeButton confirmMessage={t("confirm", { label })} revoked={revoked} />
      <AdminMutationStatus
        error={state?.errorCode ? t(`status.${state.errorCode}`) : state?.error}
        message={state?.messageCode ? t(`status.${state.messageCode}`) : state?.message}
      />
    </form>
  );
}
