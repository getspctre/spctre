import type { Preview } from "@storybook/react";
import "@spctre/design-tokens/styles.css";
import "../../../apps/web/app/globals.css";
import "../src/styles.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    backgrounds: {
      default: "surface",
      values: [
        { name: "surface", value: "oklch(0.973 0.006 236)" }
      ]
    }
  }
};

export default preview;
