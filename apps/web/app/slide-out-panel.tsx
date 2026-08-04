"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Drawer } from "@spctre/ui";

interface SlideOutPanelProps {
  title: string;
  eyebrow?: string;
  description?: string;
  defaultOpen?: boolean;
  width?: "standard" | "wide";
  trigger: (controls: { open: () => void; triggerId: string }) => React.ReactNode;
  children: React.ReactNode;
}

export function SlideOutPanel({
  title,
  eyebrow,
  description,
  defaultOpen = false,
  width = "standard",
  trigger,
  children,
}: SlideOutPanelProps) {
  const t = useTranslations("shared.slide_out");
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const triggerId = useId();

  return (
    <>
      {trigger({ open: () => setIsOpen(true), triggerId })}

      <Drawer
        open={isOpen}
        onClose={() => setIsOpen(false)}
        closeLabel={t("close")}
        width={width}
        eyebrow={eyebrow}
        title={title}
        description={description}
      >
        {children}
      </Drawer>
    </>
  );
}
