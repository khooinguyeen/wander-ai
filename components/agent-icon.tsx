/** Friendly bold face icon — works in both light and dark themes. */
export function AgentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
    >
      {/* Outer head + hair — always dark */}
      <path
        d="M32 2C17 2, 4 14, 4 30 C4 32, 4 34, 5 36 C5 36, 7 33, 11 33 L11 42 C11 54, 20 62, 32 62 C44 62, 53 54, 53 42 L53 33 C57 33, 59 36, 59 36 C60 34, 60 32, 60 30 C60 14, 47 2, 32 2Z"
        fill="#2d2d2d"
      />

      {/* Face area — always light */}
      <path
        d="M15 28 C15 22, 20 18, 32 18 C44 18, 49 22, 49 28 L49 42 C49 52, 42 58, 32 58 C22 58, 15 52, 15 42Z"
        fill="#f5f0eb"
      />

      {/* Hair shine */}
      <path d="M27 8 Q31 6, 33 12" stroke="#555" strokeWidth="3.5" strokeLinecap="round" />

      {/* Left ear */}
      <ellipse cx="8" cy="35" rx="5" ry="6" fill="#2d2d2d" />
      <ellipse cx="8" cy="35" rx="2.5" ry="3.5" fill="#f5f0eb" />

      {/* Right ear */}
      <ellipse cx="56" cy="35" rx="5" ry="6" fill="#2d2d2d" />
      <ellipse cx="56" cy="35" rx="2.5" ry="3.5" fill="#f5f0eb" />

      {/* Left eye */}
      <path d="M21 36 C21 29, 29 29, 29 36" stroke="#2d2d2d" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="25" cy="37.5" r="2" fill="#2d2d2d" />

      {/* Right eye */}
      <path d="M35 36 C35 29, 43 29, 43 36" stroke="#2d2d2d" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="39" cy="37.5" r="2" fill="#2d2d2d" />

      {/* Smile */}
      <path d="M27 46 Q32 51, 37 46" stroke="#2d2d2d" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
