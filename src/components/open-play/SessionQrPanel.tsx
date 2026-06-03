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
};

/**
 * Renders a QR code for the live session URL along with the URL text.
 * Intended for the Game Master control screen header area (courtside display).
 * Requires: pnpm add qrcode.react
 */
export function SessionQrPanel({ url }: SessionQrPanelProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-card p-4">
      <div className="rounded-md bg-white p-2">
        <QRCodeSVG
          value={url}
          size={160}
          level="M"
          marginSize={0}
          aria-label="Session live link QR code"
        />
      </div>
      <p className="max-w-[200px] break-all text-center text-[11px] text-muted-foreground">
        {url}
      </p>
    </div>
  );
}
