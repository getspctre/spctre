import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  async viteFinal(existingConfig) {
    return mergeConfig(existingConfig, {
      build: {
        // Storybook's generated preview runtime currently emits a ~1 MB iframe chunk.
        // Raise the warning threshold so the build stays signal-rich for this package.
        chunkSizeWarningLimit: 1100
      }
    });
  }
};

export default config;
