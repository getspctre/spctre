"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { ConfirmSubmitButton } from "../confirm-submit-button";
import { AdminMutationStatus } from "../mutation-status";
import { deleteIdentityProviderForm } from "./idp-actions";

function RemoveProviderButton({
  confirmMessage,
  removed,
}: {
  confirmMessage: string;
  removed: boolean;
}) {
  const t = useTranslations("admin.auth.remove_provider");
  const { pending } = useFormStatus();
  return (
    <ConfirmSubmitButton
      className="button buttonDanger"
      confirmMessage={confirmMessage}
      disabled={pending || removed}
    >
      {removed ? t("removed") : pending ? t("removing") : t("remove")}
    </ConfirmSubmitButton>
  );
}

export function RemoveIdpForm({
  providerId,
  providerName,
}: {
  providerId: string;
  providerName: string;
}) {
  const t = useTranslations("admin.auth.remove_provider");
  const [state, action] = useActionState(deleteIdentityProviderForm, null);
  const removed = Boolean(state?.ok);

  return (
    <form action={action} className="adminMutationForm">
      <input type="hidden" name="providerId" value={providerId} />
      <RemoveProviderButton confirmMessage={t("confirm", { providerName })} removed={removed} />
      <AdminMutationStatus
        error={state?.error}
        message={state?.messageCode ? t(`status.${state.messageCode}`) : state?.message}
      />
    </form>
  );
}
