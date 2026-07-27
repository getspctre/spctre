import { defaultConfig, readStoredConfig, writeConfig } from "./config";
import { isSupportedLocaleInput, normalizeLocale, supportedLocales } from "./i18n";

export async function configSet(key: string, value: string): Promise<void> {
  if (key !== "locale") {
    console.error(`Error: unsupported config key "${key}". Supported keys: locale.`);
    process.exit(1);
  }

  if (!isSupportedLocaleInput(value)) {
    console.error(`Error: unsupported locale "${value}". Supported locales: ${supportedLocales.join(", ")}.`);
    process.exit(1);
  }

  const config = readStoredConfig() ?? defaultConfig();
  const locale = normalizeLocale(value);
  writeConfig({ ...config, locale });
  console.log(`Config updated: locale=${locale}`);
}
