import clsx from "clsx";

type OptiaiLogoProps = {
  className?: string;
  compact?: boolean;
  symbolOnly?: boolean;
};

export function OptiaiLogo({ className, compact = false, symbolOnly = false }: OptiaiLogoProps) {
  return (
    <span
      className={clsx("optiai-logo", compact && "optiai-logo-compact", symbolOnly && "optiai-logo-symbol-only", className)}
      role="img"
      aria-label="OptiAI"
    >
      <span className="optiai-logo-icon" aria-hidden="true">
        <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g className="optiai-logo-orbits" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round">
            <ellipse cx="32" cy="32" rx="22" ry="11" />
            <ellipse cx="32" cy="32" rx="22" ry="11" transform="rotate(45 32 32)" />
            <ellipse cx="32" cy="32" rx="22" ry="11" transform="rotate(90 32 32)" />
            <ellipse cx="32" cy="32" rx="22" ry="11" transform="rotate(135 32 32)" />
          </g>
        </svg>
      </span>
      {!symbolOnly && <span className="optiai-logo-text">OptiAI</span>}
    </span>
  );
}
