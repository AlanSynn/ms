import type { MechanismConfig, PhysicalKitSettings, Point } from "../../types";
import {
  FABRICATION_HOLE_RADIUS_MM,
  FABRICATION_LINKAGE_WIDTH_MM,
  fabricationLinkageSpecForSceneLength,
} from "../../utils/fabrication";
import {
  gearTrainPitchRadii,
} from "../../utils/kinematics";
import { foundryPlanetaryPlanetRotationDeg } from "../../utils/foundryPlayback";
import {
  fitMechanismSimulation,
  type MechanismPreviewSimulation,
} from "../../utils/mechanismPreview";
import { SCENE_PX_PER_MM } from "../../utils/coordinates";
import { fittedGearTrainCenters } from "../stages/foundry/foundryPreviewGeometry";
import {
  axisForAngle,
  vectorAxis,
} from "../stages/foundry/mechanismLinkagePreviewHelpers";

const TWO_PI = Math.PI * 2;

const setAttributes = (
  node: Element | undefined,
  attributes: Record<string, string | number>,
) => {
  if (!node) return;
  Object.entries(attributes).forEach(([name, value]) =>
    node.setAttribute(name, String(value)),
  );
};

const directChildren = (root: Element, selector: string) =>
  Array.from(root.children).filter((child) => child.matches(selector));

const updateLinkGeometry = (
  group: Element | undefined,
  a: Point | undefined,
  b: Point | undefined,
  key: string,
  simulation: MechanismPreviewSimulation,
  kit: PhysicalKitSettings,
  barWidth: number,
  depth: number,
  holeR: number,
) => {
  if (!a || !b) return;
  if (!group) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 0.5) return;
  const sceneLength = len / Math.max(0.0001, simulation.scale);
  const minHoleCount =
    key === "coupler"
      ? 4
      : key.includes("carrier") ||
          key === "frame" ||
          key === "driver" ||
          key === "output"
        ? 3
        : 2;
  const linkageSpec = fabricationLinkageSpecForSceneLength(
    sceneLength,
    kit.gridPitchMm,
    minHoleCount,
  );
  const templateLen =
    linkageSpec.lengthMm * SCENE_PX_PER_MM * simulation.scale;
  const outlineLen = templateLen + barWidth;
  const firstHoleX = linkageSpec.holeCentersMm[0]?.x ?? 0;
  const holeXs = linkageSpec.holeCentersMm.map(
    (point) =>
      (point.x - firstHoleX - linkageSpec.lengthMm / 2) *
      SCENE_PX_PER_MM *
      simulation.scale,
  );
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  setAttributes(group, {
    transform: `translate(${mid.x} ${mid.y}) rotate(${(Math.atan2(dy, dx) * 180) / Math.PI})`,
  });
  const thickness = group.querySelector("rect.mechanism-thickness");
  const face = group.querySelector("rect.mechanism-face");
  setAttributes(thickness ?? undefined, {
    x: -outlineLen / 2 + depth,
    y: -barWidth / 2 + depth,
    width: outlineLen,
    height: barWidth,
    rx: barWidth / 2,
  });
  setAttributes(face ?? undefined, {
    x: -outlineLen / 2,
    y: -barWidth / 2,
    width: outlineLen,
    height: barWidth,
    rx: barWidth / 2,
  });
  directChildren(group, "circle.mechanism-hole").forEach((circle, index) => {
    if (holeXs[index] !== undefined) circle.setAttribute("cx", String(holeXs[index]));
  });
};

const updateGuide = (
  group: Element | undefined,
  center: Point,
  axis: Point,
  reach: number,
) => {
  const length = Math.hypot(axis.x, axis.y) || 1;
  const ux = axis.x / length;
  const uy = axis.y / length;
  const start = { x: center.x - ux * reach, y: center.y - uy * reach };
  setAttributes(group, {
    transform: `translate(${start.x} ${start.y}) rotate(${(Math.atan2(uy, ux) * 180) / Math.PI})`,
  });
};

const updateSlot = (
  group: Element | undefined,
  center: Point,
  axis: Point,
  length: number,
  barWidth: number,
  depth: number,
  holeR: number,
) => {
  if (!group) return;
  const len = Math.max(length, barWidth * 3);
  const angle = (Math.atan2(axis.y, axis.x) * 180) / Math.PI;
  setAttributes(group, {
    transform: `translate(${center.x} ${center.y}) rotate(${angle})`,
  });
  const thickness = group.querySelector("rect.mechanism-thickness");
  const face = group.querySelector("rect.mechanism-face");
  const slot = group.querySelector("rect.mechanism-slot");
  setAttributes(thickness ?? undefined, {
    x: -len / 2 + depth,
    y: -barWidth / 2 + depth,
    width: len,
    height: barWidth,
    rx: barWidth / 2,
  });
  setAttributes(face ?? undefined, {
    x: -len / 2,
    y: -barWidth / 2,
    width: len,
    height: barWidth,
    rx: barWidth / 2,
  });
  setAttributes(slot ?? undefined, {
    x: -len / 2 + barWidth * 0.75,
    y: -holeR,
    width: len - barWidth * 1.5,
    height: holeR * 2,
    rx: holeR,
  });
  directChildren(group, "circle.mechanism-hole").forEach((circle, index) =>
    circle.setAttribute("cx", String(index === 0 ? -len / 2 : len / 2)),
  );
};

const updateGearParts = (
  template: Element,
  mechanism: MechanismConfig,
  simulation: MechanismPreviewSimulation,
) => {
  const gears = Array.from(template.querySelectorAll("g.mechanism-gear-part"));
  const s = simulation.state;
  const update = (key: string, center: Point | undefined, rotation: number) => {
    const gear = gears.find((item) => item.getAttribute("data-mechanism-gear-key") === key);
    if (!gear || !center) return;
    setAttributes(gear, {
      transform: `translate(${center.x} ${center.y}) rotate(${rotation})`,
    });
    if (gear.hasAttribute("data-rotation-deg"))
      gear.setAttribute("data-rotation-deg", rotation.toFixed(2));
  };
  const driveAngleDeg = simulation.driveAngleDeg;
  if (mechanism.type === "rack-pinion") {
    update("rack-pinion-gear", s.p1, driveAngleDeg);
    return;
  }
  if (mechanism.type === "gear" || mechanism.type === "gear_linkage") {
    const radii = gearTrainPitchRadii(mechanism);
    const centers = fittedGearTrainCenters(radii, s.p1, s.p2);
    radii.forEach((radius, index) => {
      const coupled = radii.length > 2 || index === 0;
      const ratio = coupled
        ? index === 0
          ? 1
          : ((index % 2 === 1 ? -1 : 1) * radii[0]) / radius
        : 0;
      update(
        `gear-${index}`,
        centers[index] ?? (index === 0 ? s.p1 : s.p2),
        driveAngleDeg * ratio +
          (index === radii.length - 1
            ? ((mechanism.phase ?? 0) * 180) / Math.PI
            : 0),
      );
    });
    return;
  }
  if (mechanism.type === "planetary_gear") {
    update("ring", s.p1, 0);
    update("sun", s.p1, driveAngleDeg);
    update(
      "planet-1",
      s.p2,
      foundryPlanetaryPlanetRotationDeg(mechanism, driveAngleDeg, 0, 1),
    );
  }
};

const updateParts = (
  template: Element,
  mechanism: MechanismConfig,
  simulation: MechanismPreviewSimulation,
  kit: PhysicalKitSettings,
) => {
  const s = simulation.state;
  const depth = 2.2;
  const holeR = Math.max(
    1.8,
    Math.min(3.4, FABRICATION_HOLE_RADIUS_MM * SCENE_PX_PER_MM * simulation.scale),
  );
  const barWidth = Math.max(
    FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM * simulation.scale,
    holeR * 3.5,
    8,
  );
  const trackAxis = axisForAngle(mechanism.groundAngle ?? 0);
  const normalAxis = { x: -trackAxis.y, y: trackAxis.x };
  const radius = (length: number, min = 8, max = 28) =>
    Math.max(min, Math.min(max, length * simulation.scale));
  const parts = directChildren(template, "g.mechanism-part");
  let partIndex = 0;
  const next = () => parts[partIndex++];
  const link = (a: Point | undefined, b: Point | undefined, key: string) =>
    updateLinkGeometry(next(), a, b, key, simulation, kit, barWidth, depth, holeR);
  const guide = (center: Point, axis: Point, reach = 42) =>
    updateGuide(next(), center, axis, reach);
  const slot = (center: Point, axis: Point, length: number) =>
    updateSlot(next(), center, axis, length, barWidth, depth, holeR);
  if (mechanism.type === "crank") {
    link(s.p1, s.j1, "driver");
    link(s.j1, s.effector, "output");
  } else if (mechanism.type === "4bar") {
    link(s.p1, s.p2, "frame");
    link(s.p1, s.j1, "driver");
    link(s.j1, s.j2, "coupler");
    link(s.p2, s.j2, "rocker");
  } else if (mechanism.type === "5bar") {
    link(s.p1, s.p2, "frame");
    link(s.p1, s.j1, "driver-a");
    link(s.p2, s.aux, "driver-b");
    link(s.j1, s.j2, "rod-a");
    link(s.aux, s.j2, "rod-b");
    link(s.j2, s.effector, "output");
  } else if (mechanism.type === "6bar") {
    link(s.p1, s.p2, "frame");
    link(s.p1, s.j1, "driver");
    link(s.j1, s.j2, "coupler");
    link(s.p2, s.j2, "rocker");
    link(s.j2, s.aux, "dyad");
    link(s.p2, s.aux, "follower");
  } else if (mechanism.type === "piston") {
    guide(s.j2, trackAxis);
    link(s.p1, s.j1, "driver");
    link(s.j1, s.j2, "slider-link");
    link(s.j2, s.effector, "output");
  } else if (mechanism.type === "yoke") {
    guide(s.j2, trackAxis);
    slot(s.j2, normalAxis, radius(mechanism.crankLength, 28, 72));
    link(s.p1, s.j1, "driver");
    link(s.j2, s.effector, "output");
  } else if (mechanism.type === "cam") {
    guide(s.j2, trackAxis);
    setAttributes(next(), {
      transform: `translate(${s.p1.x} ${s.p1.y}) rotate(${simulation.driveAngleDeg})`,
    });
    setAttributes(next(), {
      transform: `translate(${s.j2.x} ${s.j2.y}) rotate(${(Math.atan2(normalAxis.y, normalAxis.x) * 180) / Math.PI})`,
    });
  } else if (mechanism.type === "rack-pinion") {
    const rackAxis = vectorAxis(s.j2, s.effector, trackAxis);
    const rawInputAngle =
      ((-Math.atan2(s.j1.y - s.p1.y, s.j1.x - s.p1.x) % TWO_PI) + TWO_PI) % TWO_PI;
    const travel = Math.max(1, mechanism.crankLength) * (rawInputAngle - Math.PI) * simulation.scale;
    const fixedGuideCenter = {
      x: s.j2.x - rackAxis.x * travel,
      y: s.j2.y - rackAxis.y * travel,
    };
    const rackVisualLength = radius(mechanism.rockerLength, 56, 160);
    guide(fixedGuideCenter, rackAxis, rackVisualLength / 2 + radius(mechanism.crankLength, 8, 34));
    setAttributes(next(), {
      transform: `translate(${s.j2.x} ${s.j2.y}) rotate(${(Math.atan2(rackAxis.y, rackAxis.x) * 180) / Math.PI})`,
    });
    link(s.p1, s.j1, "pinion-radius");
    link(s.j2, s.effector, "rack-output");
  } else if (mechanism.type === "quick-return") {
    link(s.p1, s.p2, "frame");
    link(s.p1, s.j1, "driver");
    slot(
      { x: (s.p2.x + s.j2.x) / 2, y: (s.p2.y + s.j2.y) / 2 },
      vectorAxis(s.p2, s.j2, trackAxis),
      Math.hypot(s.j2.x - s.p2.x, s.j2.y - s.p2.y),
    );
    link(s.j2, s.effector, "output");
  } else if (mechanism.type === "gear_linkage") {
    link(s.j1, s.effector, "drive-l4-linkage");
    link(s.j2, s.effector, "output-l4-linkage");
    slot(s.effector, vectorAxis(s.j2, s.effector, trackAxis), barWidth * 3.2);
  } else if (mechanism.type === "planetary_gear") {
    link(s.p1, s.p2, "carrier-1");
    link(s.p2, s.effector, "carrier-output");
  } else if (mechanism.type !== "gear") {
    link(s.p1, s.p2, "frame");
    link(s.p1, s.j1, "driver");
    link(s.j1, s.j2, "coupler");
    link(s.j2, s.p2, "rocker");
    link(s.j1, s.effector, "output");
  }
};

export const updateClassroomGeneratedLoop = (
  root: SVGSVGElement,
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings,
  phase: number,
) => {
  const simulation = fitMechanismSimulation(mechanism, phase, 160, 96, 56);
  root.querySelector(":scope > path")?.setAttribute("d", simulation.pathD);
  const linkage = root.querySelector('[data-testid="classroom-generated-loop-linkage"]');
  const template = linkage?.firstElementChild;
  if (!template) return;
  updateGearParts(template, mechanism, simulation);
  updateParts(template, mechanism, simulation, kit);
  const pins = directChildren(template, "circle.mechanism-pin");
  const pinPoints =
    mechanism.type === "cam"
      ? [simulation.state.p1, simulation.state.j2]
      : [
          simulation.state.p1,
          simulation.state.p2,
          simulation.state.j1,
          simulation.state.j2,
          simulation.state.aux,
        ].filter((point): point is Point => Boolean(point));
  pins.forEach((pin, index) => {
    const point = pinPoints[index];
    if (point) setAttributes(pin, { cx: point.x, cy: point.y });
  });
  const effector = template.querySelector("circle.mechanism-effector");
  setAttributes(effector ?? undefined, {
    cx: simulation.state.effector.x,
    cy: simulation.state.effector.y,
  });
};
