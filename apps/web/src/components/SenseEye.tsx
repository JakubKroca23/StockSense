/** Original Sense eye geometry (outer lids + inner arcs + pupil). */
export const SENSE_EYE_VIEWBOX = "0 0 80 42";

/** Shared green — aligned with portfolio gain / --ok */
export const SENSE_GREEN = "#5dde8a";

export function SenseEyePaths({
  stroke = "currentColor",
  fill = "currentColor",
}: {
  stroke?: string;
  fill?: string;
}) {
  return (
    <g fill="none" stroke={stroke} strokeLinecap="round" strokeLinejoin="round">
      {/* Outer upper lid — open left, tapers to right tip */}
      <path
        d="M5 21C14 8.5 27 4 40 4c10.5 0 20 4.2 30 12.5 2.8 2.3 4.6 4.2 5 4.5"
        strokeWidth="3.2"
      />
      {/* Outer lower lid — open left, meets right tip */}
      <path
        d="M9 23.5C17 34.5 28 38.5 40 38.5c9.5 0 18.5-3.2 27-10.5 3.2-2.7 5.8-5.5 7-7"
        strokeWidth="3.2"
      />
      {/* Inner upper arc */}
      <path d="M26 16.5c6.5-4.2 14-5 22-2.8" strokeWidth="2.4" />
      {/* Inner lower arc */}
      <path d="M27 26c6.5 4 14.5 4.5 22.5 1.2" strokeWidth="2.4" />
      {/* Pupil */}
      <circle cx="42" cy="21" r="4.6" fill={fill} stroke="none" />
    </g>
  );
}

/** Sense eye mark — brand for the Sense analysis tech */
export function SenseEye({
  className = "",
  size = 14,
}: {
  className?: string;
  size?: number;
}) {
  const h = size * (42 / 80);
  return (
    <svg
      width={size}
      height={h}
      viewBox={SENSE_EYE_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <SenseEyePaths />
    </svg>
  );
}
