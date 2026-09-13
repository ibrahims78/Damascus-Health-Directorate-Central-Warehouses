import { useEffect, useRef, useState } from 'react';
import { Button, Field } from './ui';

/**
 * ماسح الباركود: يستخدم BarcodeDetector المدمج في Chromium عند توفّره،
 * مع إدخال يدوي كبديل دائم (أجهزة قراءة الباركود تعمل كلوحة مفاتيح).
 */

type DetectorCtor = new (options?: { formats?: string[] }) => {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
};

export default function BarcodeScanner({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let cancelled = false;

    const Detector = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setError('تعذّر الوصول إلى الكاميرا. يمكنك إدخال الباركود يدويًا بالأسفل.');
        return;
      }

      if (!Detector) {
        setSupported(false);
        return;
      }

      const detector = new Detector({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code'] });
      timer = window.setInterval(async () => {
        if (cancelled || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const value = codes[0]?.rawValue;
          if (value) {
            onDetected(value);
            onClose();
          }
        } catch {
          /* إطار غير قابل للقراءة — يُتجاهل */
        }
      }, 600);
    };

    void start();

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onDetected, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="card w-full max-w-lg space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">مسح الباركود</h3>
          <Button variant="ghost" onClick={onClose}>
            إغلاق
          </Button>
        </div>

        {error && <Alert>{error}</Alert>}
        {!supported && !error && (
          <Alert kind="warn">
            الماسح التلقائي غير متاح على هذه النسخة، استخدم الإدخال اليدوي أو جهاز قراءة الباركود.
          </Alert>
        )}

        <div className="overflow-hidden rounded-2xl border border-line bg-black">
          <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
        </div>

        <form
          className="flex items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!manual.trim()) return;
            onDetected(manual.trim());
            setManual('');
            onClose();
          }}
        >
          <div className="flex-1">
            <Field label="إدخال يدوي / جهاز قراءة" value={manual} onChange={setManual} placeholder="امسح أو اكتب الرمز" />
          </div>
          <Button type="submit">تأكيد</Button>
        </form>
      </div>
    </div>
  );
}

function Alert({ children, kind = 'err' }: { children: React.ReactNode; kind?: 'err' | 'warn' }) {
  return (
    <div
      className={`rounded-xl px-4 py-3 text-sm font-semibold ${
        kind === 'warn' ? 'bg-warn-50 text-warn-700' : 'bg-danger-50 text-danger-700'
      }`}
    >
      {children}
    </div>
  );
}
