"use client";

import { useState, useEffect } from "react";
import { X, Printer } from "lucide-react";

interface QRData {
  qrDataUrl: string;
  asset_tag: string;
  name: string;
  serial_number: string;
  manufacturer: string;
  model: string;
}

export default function QRModal({
  assetId,
  assetName,
  assetTag,
  onClose,
}: {
  assetId: number;
  assetName: string;
  assetTag: string;
  onClose: () => void;
}) {
  const [qrData, setQrData] = useState<QRData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/assets/${assetId}/qrcode`);
        if (res.ok) {
          setQrData(await res.json());
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [assetId]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      onClick={onClose}
    >
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #qr-print-area, #qr-print-area * { visibility: visible !important; }
          #qr-print-area { position: absolute; left: 0; top: 0; }
        }
      `}</style>
      <div
        id="qr-print-area"
        className="relative bg-white rounded-xl shadow-xl p-6 w-80"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-600"
        >
          <X className="w-5 h-5" />
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-400">
            로딩 중...
          </div>
        ) : qrData ? (
          <div className="flex flex-col items-center gap-4">
            <img
              src={qrData.qrDataUrl}
              alt={`QR: ${assetTag}`}
              className="w-48 h-48"
            />
            <div className="w-full text-sm space-y-1.5">
              <InfoRow label="자산태그" value={qrData.asset_tag} />
              <InfoRow label="자산명" value={qrData.name} />
              <InfoRow label="시리얼" value={qrData.serial_number} />
              <InfoRow label="제조사" value={qrData.manufacturer} />
              <InfoRow label="모델" value={qrData.model} />
            </div>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors print:hidden"
            >
              <Printer className="w-4 h-4" />
              인쇄
            </button>
          </div>
        ) : (
          <div className="text-sm text-slate-400 text-center py-8">
            QR 코드를 불러올 수 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex">
      <span className="w-16 shrink-0 text-slate-400">{label}</span>
      <span className="text-slate-700 font-medium">{value || "-"}</span>
    </div>
  );
}
