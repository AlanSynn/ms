import type { ProjectState } from "../../../types";
import { formatGridLabel } from "../../../utils/units";

export const OptionsPreviewCanvas = ({
  settings,
}: {
  settings: ProjectState["settings"];
}) => (
  <div className="path-canvas-shell options-preview-shell workspace overflow-hidden p-6">
    <svg
      viewBox="0 0 640 420"
      className="options-preview-canvas w-full h-full"
      role="img"
      aria-label="Options preview canvas"
    >
      <defs>
        <pattern
          id="options-grid"
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M40 0H0V40"
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect
        x="34"
        y="24"
        width="572"
        height="372"
        rx="24"
        fill="white"
        stroke="#d6dbe8"
      />
      <rect
        x="34"
        y="24"
        width="572"
        height="372"
        rx="24"
        fill="url(#options-grid)"
        opacity=".9"
      />
      <text x="58" y="64" fill="#94a3b8" fontSize="18" fontWeight="800">
        {formatGridLabel(settings.physicalKit, settings.gridUnit)}
      </text>
      <g transform="translate(300 210)">
        <rect
          x="-70"
          y="-90"
          width="140"
          height="180"
          rx="32"
          fill="#cbd5e1"
          opacity=".55"
        />
        <circle cx="0" cy="-115" r="38" fill="#d8dee8" />
        <path
          d="M 70 -52 C 142 -24 122 58 78 94"
          fill="none"
          stroke="#8b5cf6"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d="M -70 -54 C -126 -18 -116 60 -68 94"
          fill="none"
          stroke="#10b981"
          strokeWidth="6"
          strokeLinecap="round"
          opacity=".7"
        />
      </g>
      <text
        x="58"
        y="362"
        fill="#64748b"
        fontSize="14"
        fontWeight="800"
      >
        {settings.theme} theme · {settings.animationSpeed.toFixed(1)}x speed ·{" "}
        {settings.physicalKit.defaultExportFormat} export
      </text>
    </svg>
  </div>
);
