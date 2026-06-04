type HoneycombLogoProps = {
  size?: number;
  mode?: "idle" | "talking" | "thinking";
  className?: string;
};

export function HoneycombLogo({
  size = 28,
  mode = "idle",
  className = ""
}: HoneycombLogoProps) {
  return (
    <span
      className={`honeycombLogo honeycombLogo-${mode} ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" role="presentation">
        <path className="logoCell logoCellTop" d="M50 5 76 20v26l-9 5M33 51l-9-5V20L50 5" />
        <path className="logoCell logoCellLeft" d="m45 58-1 28-22 12L3 87V63l21-12 12 7" />
        <path className="logoCell logoCellRight" d="m55 58 1 28 22 12 19-11V63L76 51l-12 7" />
        <path className="logoCore" d="m50 36 15 9v18l-15 9-15-9V45z" />
      </svg>
    </span>
  );
}
