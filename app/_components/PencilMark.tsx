// A hand-drawn circle around a cited photo. Dark ink over a white halo, so it
// stays visible on any frame color. Each photo gets a slightly different tilt
// so the marks don't look stamped.

const CIRCLE = "M52 5 C80 3 97 27 95 52 C93 79 66 97 45 95 C18 93 3 69 5 45 C7 21 29 5 58 8";

export function PencilMark({ seed }: { seed: number }) {
  const tilt = ((seed * 37) % 14) - 7; // -7..6 degrees, stable per photo
  return (
    <svg
      className="pencil-mark pointer-events-none absolute -inset-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)] overflow-visible"
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      {/* pathLength=1: the draw animation works in fractions of the path, whatever the size */}
      <path d={CIRCLE} fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" pathLength={1} />
      <path d={CIRCLE} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" pathLength={1} />
    </svg>
  );
}
