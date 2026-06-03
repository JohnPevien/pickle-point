"use client";

import dynamic from "next/dynamic";

const QRCodeSVG = dynamic(
  () => import("qrcode.react").then((mod) => ({ default: mod.QRCodeSVG })),
  {
    ssr: false,
    loading: () => (
      <div className="flex size-[160px] items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
        Loading QR…
      </div>
    ),
  }
);

type SessionQrPanelProps = {
  url: string;
  title?: string;
  ariaLabel?: string;
};

/**
 * Renders a QR code for a public live URL along with the URL text.
 * Intended for Game Master control screens and courtside display.
 */
export function SessionQrPanel({
  url,
  title = "Live link",
  ariaLabel = "Live link QR code",
}: SessionQrPanelProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-card p-4 print:border-0 print:bg-white">
      <p className="text-sm font-medium text-foreground print:text-black">{title}</p>
      <div className="rounded-md bg-white p-2">
        <QRCodeSVG
          value={url}
          size={160}
          level="M"
          marginSize={0}
          aria-label={ariaLabel}
        />
      </div>
      <p className="max-w-[200px] break-all text-center text-[11px] text-muted-foreground">
        {url}
      </p>
    </div>
  );
}
