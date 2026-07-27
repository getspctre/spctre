import React from "react";

interface BrandLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

export function BrandLogo({ size = 24, className, ...props }: BrandLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* S-curve continuous monoline path outlining shield and curving into Sigma (Σ) */}
      <path d="M 30,12 L 18,12 L 28,20 L 18,28 L 30,28 C 34,28 38,28 38,25 C 38,34.5 32.5,39.5 24,43 C 15.5,39.5 10,34.5 10,23.5 L 10,9 C 10,9 15,6.8 24,5 C 33,6.8 38,9 38,9 L 38,21" />
    </svg>
  );
}
