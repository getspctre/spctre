"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/workspace/cookies";
import { requireAdminSession } from "../admin-session";
import {
  createWorkspaceAdmin as createWorkspaceAdminService,
  updateWorkspaceAdmin as updateWorkspaceAdminService,
  deleteWorkspaceAdmin as deleteWorkspaceAdminService,
} from "@/lib/domains/workspace/service";
import { isSupportedLocaleInput, normalizeLocale } from "@/lib/i18n/messages";
import { setTenantDefaultLocale } from "@/lib/repositories/i18n/preferences";

function revalidateWorkspaceSurfaces() {
  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/evidence");
  revalidatePath("/agents");
  revalidatePath("/compliance");
  revalidatePath("/packs");
  revalidatePath("/admin/workspace");
}

function adminWorkspaceUrl(params: Record<string, string>): string {
  return `/admin/workspace?${new URLSearchParams(params).toString()}`;
}

export async function createWorkspaceAdmin(formData: FormData): Promise<void> {
  const guard = await requireAdminSession();
  if ("error" in guard) {
    redirect(adminWorkspaceUrl({ errorCode: "admin_required" }));
  }

  const workspaceName = String(formData.get("workspaceName") ?? "").trim();
  const explicitSlug = String(formData.get("workspaceSlug") ?? "").trim();

  const result = await createWorkspaceAdminService({
    tenantId: guard.session.tenantId,
    principalId: guard.session.principalId,
    workspaceName,
    workspaceSlug: explicitSlug,
  });

  if ("error" in result) {
    redirect(`/admin/workspace?error=${encodeURIComponent(result.error)}`);
  }

  revalidateWorkspaceSurfaces();
  redirect(adminWorkspaceUrl({ okCode: "created", slug: result.slug }));
}

export async function updateWorkspaceAdmin(
  _state: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const guard = await requireAdminSession();
  if ("error" in guard) {
    redirect(adminWorkspaceUrl({ errorCode: "admin_required" }));
  }

  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const workspaceName = String(formData.get("workspaceName") ?? "").trim();
  const requestedSlug = String(formData.get("workspaceSlug") ?? "").trim();

  const result = await updateWorkspaceAdminService({
    tenantId: guard.session.tenantId,
    workspaceId,
    workspaceName,
    workspaceSlug: requestedSlug,
  });

  if ("error" in result) {
    redirect(`/admin/workspace?error=${encodeURIComponent(result.error)}`);
  }

  revalidateWorkspaceSurfaces();
  redirect(adminWorkspaceUrl({ okCode: "updated", slug: result.slug }));
}

export async function setTenantDefaultLocaleAdmin(formData: FormData): Promise<void> {
  const guard = await requireAdminSession();
  if ("error" in guard) {
    redirect(adminWorkspaceUrl({ errorCode: "admin_required" }));
  }

  const localeInput = String(formData.get("locale") ?? "").trim();
  if (!isSupportedLocaleInput(localeInput)) {
    redirect(adminWorkspaceUrl({ errorCode: "unsupported_language" }));
  }
  const locale = normalizeLocale(localeInput);

  const result = await setTenantDefaultLocale({ tenantId: guard.session.tenantId, locale });

  if (result !== "updated") {
    redirect(
      adminWorkspaceUrl({
        errorCode:
          result === "column-unavailable" ? "locale_storage_unavailable" : "database_unconfigured",
      }),
    );
  }

  revalidateWorkspaceSurfaces();
  redirect(adminWorkspaceUrl({ okCode: "locale_updated", locale }));
}

export async function deleteWorkspaceAdmin(formData: FormData): Promise<void> {
  const guard = await requireAdminSession();
  if ("error" in guard) {
    redirect(adminWorkspaceUrl({ errorCode: "admin_required" }));
  }

  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "")
    .trim()
    .toUpperCase();

  if (confirm !== "DELETE") {
    redirect(adminWorkspaceUrl({ errorCode: "delete_confirm" }));
  }

  const cookieStore = await cookies();
  const activeWorkspaceId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;

  const result = await deleteWorkspaceAdminService({
    tenantId: guard.session.tenantId,
    workspaceId,
    activeWorkspaceId,
  });

  if ("error" in result) {
    redirect(`/admin/workspace?error=${encodeURIComponent(result.error)}`);
  }

  if (result.fallbackWorkspaceId) {
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, result.fallbackWorkspaceId, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  }

  revalidateWorkspaceSurfaces();
  redirect(adminWorkspaceUrl({ okCode: "deleted", slug: result.slug }));
}
