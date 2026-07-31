/** Small “live fleet” map markers (Uber-style cars on the browse map). */

export type LiveFleetMarkerVariant = "vehicle" | "car" | "salon" | "default";

export function ensureLiveFleetMarkerStyles() {
  if (typeof document === "undefined") return;

  const existing = document.getElementById(
    "freshup-live-fleet-marker-styles",
  ) as HTMLStyleElement | null;
  const style = existing ?? document.createElement("style");
  style.id = "freshup-live-fleet-marker-styles";
  style.textContent = `
    @keyframes freshup-fleet-pulse {
      0% { transform: rotate(var(--fleet-heading, 0deg)) scale(1); opacity: 0.9; }
      50% { transform: rotate(var(--fleet-heading, 0deg)) scale(1.04); opacity: 1; }
      100% { transform: rotate(var(--fleet-heading, 0deg)) scale(1); opacity: 0.9; }
    }
    .freshup-fleet-marker {
      position: relative;
      width: 28px;
      height: 28px;
      pointer-events: none;
    }
    .freshup-fleet-marker__car {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 14px;
      height: 22px;
      margin: -11px 0 0 -7px;
      background: #111827;
      border: 2px solid #ffffff;
      border-radius: 4px 4px 3px 3px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.32);
      transform: rotate(var(--fleet-heading, 0deg));
      animation: freshup-fleet-pulse 2.6s ease-in-out infinite;
    }
    .freshup-fleet-marker__car::before {
      content: "";
      position: absolute;
      left: 2px;
      right: 2px;
      top: 3px;
      height: 5px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.82);
    }
    .freshup-fleet-marker--vehicle .freshup-fleet-marker__car {
      background: #0f766e;
    }
    .freshup-fleet-marker--salon .freshup-fleet-marker__car {
      width: 16px;
      height: 16px;
      margin: -8px 0 0 -8px;
      border-radius: 9999px;
      background: #111827;
      animation: none;
      transform: none;
    }
    .freshup-fleet-marker--salon .freshup-fleet-marker__car::before {
      display: none;
    }
    .freshup-fleet-marker__halo {
      position: absolute;
      inset: 0;
      border-radius: 9999px;
      border: 1px solid rgba(17, 24, 39, 0.18);
      animation: freshup-fleet-halo 2.6s ease-out infinite;
    }
    .freshup-fleet-marker--salon .freshup-fleet-marker__halo {
      display: none;
    }
    @keyframes freshup-fleet-halo {
      0% { transform: scale(0.75); opacity: 0.45; }
      70% { transform: scale(1.45); opacity: 0; }
      100% { transform: scale(1.45); opacity: 0; }
    }
    @keyframes freshup-market-pulse {
      0% { transform: scale(0.92); opacity: 0.35; }
      50% { transform: scale(1); opacity: 0.65; }
      100% { transform: scale(0.92); opacity: 0.35; }
    }
    @keyframes freshup-market-ring {
      0% { transform: scale(0.6); opacity: 0.55; }
      100% { transform: scale(1.45); opacity: 0; }
    }
    .freshup-market-calculating {
      pointer-events: none;
    }
    .freshup-market-calculating__core {
      width: 88px;
      height: 88px;
      border-radius: 9999px;
      border: 2px solid rgba(17, 24, 39, 0.28);
      animation: freshup-market-pulse 1.4s ease-in-out infinite;
    }
    .freshup-market-calculating__ring {
      position: absolute;
      inset: 0;
      margin: auto;
      width: 88px;
      height: 88px;
      border-radius: 9999px;
      border: 1px solid rgba(17, 24, 39, 0.2);
      animation: freshup-market-ring 1.8s ease-out infinite;
    }
    .freshup-market-calculating__label {
      position: absolute;
      left: 50%;
      bottom: -2.25rem;
      transform: translateX(-50%);
      white-space: nowrap;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.94);
      padding: 0.35rem 0.75rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: #111827;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    }
  `;
  if (!existing) document.head.appendChild(style);
}

export function createLiveFleetMarkerElement(
  variant: LiveFleetMarkerVariant = "car",
  headingDeg = 0,
) {
  ensureLiveFleetMarkerStyles();
  const resolved =
    variant === "default" ? "car" : variant;
  const root = document.createElement("div");
  root.className = `freshup-fleet-marker freshup-fleet-marker--${resolved}`;
  root.style.setProperty("--fleet-heading", `${headingDeg}deg`);

  const halo = document.createElement("div");
  halo.className = "freshup-fleet-marker__halo";

  const car = document.createElement("div");
  car.className = "freshup-fleet-marker__car";

  root.appendChild(halo);
  root.appendChild(car);
  return root;
}

export function updateLiveFleetMarkerHeading(
  element: HTMLElement,
  headingDeg: number,
) {
  element.style.setProperty("--fleet-heading", `${headingDeg}deg`);
}
