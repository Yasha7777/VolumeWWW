  import { useMemo } from 'react';
  import { createPortal } from 'react-dom';
  import { useTheme } from '../../theme/ThemeProvider';

  /* ============================================================
    Fracture — полноэкранный «разлом» при переходе в gtc.
    Рендерится порталом в body поверх всего (z-index 200), только
    пока flipping=true (ThemeProvider поднимает флаг на вход в gtc).
    ============================================================ */

  const A = `${import.meta.env.BASE_URL}swag/`;

  // 16 разлетающихся «осколков» света — свежий набор на каждый разлом
  function makeShards() {
    return Array.from({ length: 16 }, (_, i) => {
      const fromLeft = i % 2 === 0;
      const top = Math.random() * 100;
      const w = 120 + Math.random() * 320;
      const h = 2 + Math.random() * 5;
      const tx = (fromLeft ? -1 : 1) * (200 + Math.random() * 500);
      const ty = (Math.random() - 0.5) * 260;
      const rot = (Math.random() - 0.5) * 50;
      const delay = Math.random() * 0.18;
      return {
        top: `${top}%`,
        width: w,
        height: h,
        background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(220,226,236,.9), rgba(255,255,255,0))',
        boxShadow: '0 0 16px rgba(200,210,230,.6)',
        '--tx': `${tx}px`,
        '--ty': `${ty}px`,
        '--rot': `${rot}deg`,
        animation: `shardFly .95s cubic-bezier(.2,.7,.3,1) ${delay}s forwards`,
      };
    });
  }

  export default function Fracture() {
    const { flipping } = useTheme();
    const shards = useMemo(() => (flipping ? makeShards() : []), [flipping]);
    if (!flipping) return null;

    return createPortal(
      <div className="swag-fracture">
        <div className="sf-wipe" />
        <div className="sf-crack" />
        <img className="sf-ornament" src={`${A}ornament.png`} alt="" />
        {shards.map((style, i) => (
          <div key={i} className="sf-shard" style={style} />
        ))}
      </div>,
      document.body
    );
  }
