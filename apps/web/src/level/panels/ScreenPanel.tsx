import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { rv } from '../../sim/client';
import { paintFramebuffer } from './rv';

const W = 320;
const H = 200;

/** Screen (DEV-06): the 320x200 8-bit framebuffer, scaled by whole pixels. */
export function ScreenPanel() {
  const version = useEditor((s) => s.rv?.fbVersion ?? -1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const s = Math.min(el.clientWidth / W, el.clientHeight / H);
      // Whole multiples stay crisp; below 1x, shrink smoothly.
      setScale(s >= 1 ? Math.floor(s) : Math.max(0.25, s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redraw when the frame changed; drop requests that arrive while one is in flight.
  const busy = useRef(false);
  const again = useRef(false);
  useEffect(() => {
    const draw = async () => {
      if (busy.current) {
        again.current = true;
        return;
      }
      busy.current = true;
      try {
        const fb = await rv.framebuffer();
        const ctx = canvas.current?.getContext('2d');
        if (fb === null) setMissing(true);
        if (!fb || !ctx) return;
        setMissing(false);
        const img = ctx.createImageData(W, H);
        paintFramebuffer(fb.pixels, fb.palette, img.data);
        ctx.putImageData(img, 0, 0);
      } finally {
        busy.current = false;
        if (again.current) {
          again.current = false;
          void draw();
        }
      }
    };
    void draw();
  }, [version]);

  return (
    <div className="dk-screen" ref={box}>
      <canvas
        ref={canvas}
        width={W}
        height={H}
        className="dk-screen-canvas"
        style={{ width: W * scale, height: H * scale }}
        role="img"
        aria-label={t('panels.rv.screen.label')}
      />
      {missing && <p className="dk-empty">{t('panels.rv.screen.none')}</p>}
    </div>
  );
}
