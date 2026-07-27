import { cookies } from "next/headers";
import { APP_VIEW_MODE_COOKIE, normalizeAppViewMode, type AppViewMode } from "./app-view-mode";

export async function getAppViewMode(): Promise<AppViewMode> {
  const cookieStore = await cookies();
  return normalizeAppViewMode(cookieStore.get(APP_VIEW_MODE_COOKIE)?.value);
}
