export const MiniFlow = () => (
  <div className="mini-flow" aria-hidden>
    <svg viewBox="0 0 420 150">
      <path className="flow" d="M90 40 C 150 40, 150 100, 210 100 C 270 100, 270 40, 330 40" stroke="#2dffa6" strokeWidth="2" fill="none" opacity=".7" />
    </svg>
    <span className="pill" style={{ left: 0, top: 22 }}>🖥 checkout</span>
    <span className="pill" style={{ left: 160, top: 84 }}>⚙ worker</span>
    <span className="pill" style={{ left: 320, top: 22 }}>🛢 inventory</span>
  </div>
);
