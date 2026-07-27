import { getRequestConfig } from "next-intl/server";
import { resolveI18nRequestConfig } from "@/lib/i18n/request-config";

export default getRequestConfig(async () => {
  const config = await resolveI18nRequestConfig();

  return {
    locale: config.locale,
    messages: config.messages,
  };
});
