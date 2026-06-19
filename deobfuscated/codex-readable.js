/**
 * ============================================================
 *  Codex AI Agent — Content Script (Deobfuscated & Readable)
 * ============================================================
 *
 *  Chrome extension content script that overlays an animated
 *  AI-agent cursor on web pages and manages favicon badges.
 *
 *  Architecture:
 *    1. Math Utilities          – vectors, clamping, angle helpers
 *    2. Spring Physics          – custom spring simulation engine
 *    3. Cursor Motion Paths     – Bézier curve generation & scoring
 *    4. Cursor Overlay          – DOM layer with animated cursor
 *    5. Favicon Badge Manager   – SVG-based badge injection
 *    6. Content Script Bootstrap – WXT lifecycle & shadow DOM
 * ============================================================
 */

// ─────────────────────────────────────────────────────────────
//  1. MATH UTILITIES
// ─────────────────────────────────────────────────────────────

/**
 * Clamp a number between min and max.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Euclidean distance between two points.
 */
function distance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Normalize a 2D vector (unit vector).
 * Returns {1, 0} for zero-length vectors.
 */
function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len < 0.001) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * Convert degrees to a unit direction vector.
 * Convention: 0° = up, clockwise positive.
 */
function degreesToDirection(degrees) {
  const radians = degrees * (Math.PI / 180);
  return {
    x: Math.sin(radians),
    y: -Math.cos(radians),
  };
}

/**
 * Midpoint between two points.
 */
function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Normalize angle to [0, 360) range.
 */
function normalizeAngle360(degrees) {
  const n = degrees % 360;
  return n < 0 ? n + 360 : n;
}

/**
 * Shortest angular path from `from` to `to`, result in (-180, 180].
 */
function angleDelta(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * Compute the angle a direction vector points in degrees.
 * Convention: 0° = up, clockwise positive.
 * Falls back to -44° for zero-length vectors (default click angle).
 */
function directionToAngle(direction) {
  if (distance({ x: 0, y: 0 }, direction) < 0.001) {
    return normalizeAngle360(-44);
  }
  const unit = normalize(direction);
  return normalizeAngle360(Math.atan2(unit.y, unit.x) * (180 / Math.PI) + 90);
}

/**
 * Linear interpolation between two values.
 */
function lerp(from, to, t) {
  return from + (to - from) * t;
}

/**
 * Round to 3 decimal places (for clean CSS values).
 */
function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Check whether a point is inside a bounding rectangle with margin.
 */
function isInsideBounds(point, bounds, margin) {
  return (
    point.x >= margin &&
    point.x <= bounds.width - margin &&
    point.y >= margin &&
    point.y <= bounds.height - margin
  );
}

/**
 * High-resolution timestamp (uses performance.now when available).
 */
function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// ─────────────────────────────────────────────────────────────
//  2. CUBIC BÉZIER CURVE UTILITIES
// ─────────────────────────────────────────────────────────────

/**
 * Evaluate a cubic Bézier curve at parameter t ∈ [0, 1].
 */
function cubicBezierPoint(p0, cp1, cp2, p3, t) {
  const s = 1 - t;
  const s3 = s * s * s;
  const s2t = 3 * s * s * t;
  const st2 = 3 * s * t * t;
  const t3 = t * t * t;
  return {
    x: p0.x * s3 + cp1.x * s2t + cp2.x * st2 + p3.x * t3,
    y: p0.y * s3 + cp1.y * s2t + cp2.y * st2 + p3.y * t3,
  };
}

/**
 * Tangent (first derivative) of a cubic Bézier curve at parameter t.
 */
function cubicBezierTangent(p0, cp1, cp2, p3, t) {
  const s = 1 - t;
  return {
    x:
      3 * s * s * (cp1.x - p0.x) +
      6 * s * t * (cp2.x - cp1.x) +
      3 * t * t * (p3.x - cp2.x),
    y:
      3 * s * s * (cp1.y - p0.y) +
      6 * s * t * (cp2.y - cp1.y) +
      3 * t * t * (p3.y - cp2.y),
  };
}

// ─────────────────────────────────────────────────────────────
//  3. SPRING PHYSICS ENGINE
// ─────────────────────────────────────────────────────────────

const FIXED_TIMESTEP = 1 / 60; // 60 Hz physics step
const MAX_SCRIPT_TIME_PER_FRAME = 1; // max accumulated time per update
const SNAPSHOT_THRESHOLD = 0.001 * 60; // velocity/force threshold for "at rest"

/**
 * Create a new spring state object.
 * @param {number} value       - Current value
 * @param {number} target      - Target value
 * @param {{response: number, dampingFraction: number}} config
 */
function createSpring(value, target, config) {
  return {
    value,
    target,
    velocity: 0,
    force: 0,
    response: config.response,      // stiffness (higher = snappier)
    dampingFraction: config.dampingFraction, // 0..1 (1 = critically damped)
    simulationTime: 0,
    scriptTime: 0,
  };
}

/**
 * Instantly snap a spring to a target (no animation).
 */
function snapSpring(spring, target) {
  spring.force = 0;
  spring.simulationTime = 0;
  spring.scriptTime = 0;
  spring.target = target;
  spring.value = target;
  spring.velocity = 0;
}

/**
 * Set a spring's target to the nearest angular equivalent
 * of `target` (avoids spinning the long way around).
 */
function setSpringTargetAngle(spring, target) {
  spring.target = spring.value + wrapAngleDelta(spring.value, target);
}

/**
 * Wrap an angle delta into (-180, 180] degrees.
 */
function wrapAngleDelta(current, target) {
  let delta = target - current;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

/**
 * Advance a spring's physics simulation by `dt` seconds.
 * Uses a semi-implicit Euler integrator with a fixed timestep
 * sub-stepped for stability.
 */
function stepSpring(spring, dt) {
  const minResponse = 0.001;
  const response = Math.max(minResponse, spring.response);

  // Compute natural frequency (ω₀) and damping coefficient (ζ)
  const maxOmegaSquared = 1 / (2 * FIXED_TIMESTEP ** 2);
  const omegaSquared = Math.min((Math.PI * 2) ** 2 / response ** 2, maxOmegaSquared);
  const omega = Math.sqrt(omegaSquared);
  const dampingCoeff = omega * 2 * spring.dampingFraction;

  // Accumulate real time
  spring.scriptTime += Math.max(0, dt);

  // Sub-step simulation in fixed increments
  while (
    spring.scriptTime - spring.simulationTime > MAX_SCRIPT_TIME_PER_FRAME
  ) {
    spring.simulationTime = spring.scriptTime - FIXED_TIMESTEP;
  }
  while (spring.simulationTime < spring.scriptTime) {
    // Semi-implicit Euler step
    const halfDt = FIXED_TIMESTEP / 2;
    const halfVel = spring.velocity + spring.force * halfDt;
    spring.value += halfVel * FIXED_TIMESTEP;
    spring.force = halfVel * -dampingCoeff + (spring.target - spring.value) * omegaSquared;
    spring.velocity = halfVel + spring.force * halfDt;

    spring.simulationTime += FIXED_TIMESTEP;
  }

  // Snap to target when effectively at rest
  if (isSpringAtRest(spring)) {
    spring.value = spring.target;
  }
}

/**
 * Check if a spring has effectively stopped moving.
 */
function isSpringAtRest(spring) {
  if (
    Math.max(spring.velocity ** 2, spring.force ** 2) >
    SNAPSHOT_THRESHOLD ** 2
  ) {
    return false;
  }
  const tolerance = Math.abs(spring.target) * 0.01;
  if (tolerance === 0) return true;
  const error = spring.target - spring.value;
  return error * error <= tolerance * tolerance;
}

/**
 * Check if a spring has reached its target and is at rest.
 */
function isSpringSettled(spring) {
  return spring.value === spring.target && isSpringAtRest(spring);
}

// ─────────────────────────────────────────────────────────────
//  4. CURSOR MOTION PATHS
// ─────────────────────────────────────────────────────────────

// Default configuration for motion path generation
const MOTION_PATH_CONFIG = {
  arcFlow: 0.5783555327868779,
  arcSize: 0.2765523188064277,
  boundsMargin: 20,
  candidateCount: 20,
  clickAngleDegrees: -44,
  endpointHandle: 0.15,
  startHandle: 0.41960295031576633,
};

/**
 * Clamp a control-point handle so it stays within the bounding box.
 *
 * Starting from `origin` in direction `dir`, the handle extends by
 * `maxDistance` but is clamped to the bounds edges.
 */
function clampHandleToBounds(bounds, origin, dir, maxDistance) {
  let distance = maxDistance;

  if (dir.x < 0) distance = Math.min(distance, origin.x / -dir.x);
  if (dir.x > 0) distance = Math.min(distance, (bounds.width - origin.x) / dir.x);
  if (dir.y < 0) distance = Math.min(distance, origin.y / -dir.y);
  if (dir.y > 0) distance = Math.min(distance, (bounds.height - origin.y) / dir.y);

  return {
    x: origin.x + dir.x * Math.max(0, distance),
    y: origin.y + dir.y * Math.max(0, distance),
  };
}

/**
 * Generate multiple candidate Bézier curves from start to end.
 *
 * For each candidate, the algorithm:
 *   1. Computes start/end control handles (clamped to viewport).
 *   2. Creates a "direct" straight-ish path.
 *   3. Optionally creates arcing paths by adding a waypoint.
 *   4. Scores each candidate on length, angular energy, bounds,
 *      and alignment with the default click angle.
 *
 * Returns the best candidate path.
 */
function generateBestMotionPath({ bounds, end, start }) {
  const candidates = generateMotionPathCandidates({
    bounds,
    config: MOTION_PATH_CONFIG,
    end,
    start,
  });
  return selectBestCandidate(candidates, bounds, MOTION_PATH_CONFIG);
}

/**
 * Internal: Generate the full set of candidate paths.
 */
function generateMotionPathCandidates({ bounds, config, end, start }) {
  const clickDir = degreesToDirection(config.clickAngleDegrees);
  const totalDist = distance(start, end);
  const rawDir = { x: end.x - start.x, y: end.y - start.y };
  const unitDir = normalize(rawDir);

  // Handle distances for start/end control points
  const startHandleDist = Math.max(
    48,
    Math.min(640, totalDist * config.startHandle, totalDist * 0.9)
  );
  const endHandleDist = Math.max(
    48,
    Math.min(640, totalDist * config.endpointHandle, totalDist * 0.9)
  );

  // Control point directions: start goes toward click angle, end reverses
  const endDir = { x: -clickDir.x, y: -clickDir.y };
  const startControl = clampHandleToBounds(bounds, start, clickDir, startHandleDist);
  const endControl = clampHandleToBounds(bounds, end, endDir, endHandleDist);

  // Perpendicular to the raw direction
  const perp = { x: -unitDir.y, y: unitDir.x };
  const crossSign = perp.x * clickDir.x + perp.y * clickDir.y >= 0 ? 1 : -1;
  const naturalArcNormal = { x: perp.x * crossSign, y: perp.y * crossSign };

  // Midpoint of start → end
  const mid = midpoint(start, end);

  // Shorter control handles for arc paths
  const startControlShort = clampHandleToBounds(
    bounds, start, clickDir, startHandleDist * 0.65
  );
  const endControlShort = clampHandleToBounds(
    bounds, end, endDir, endHandleDist * 0.65
  );

  // Arc parameter ranges
  const arcDir = normalize(rawDir);
  const arcDistanceBase = Math.max(50, Math.min(520, totalDist * config.arcSize));
  const arcHandleBase = Math.max(38, Math.min(440, totalDist * config.arcFlow));
  const arcDistScales = [0.55, 0.8, 1.05];
  const arcHandleScales = [0.65, 1, 1.35];

  // Always start with the direct (non-arc) candidate
  const candidates = [
    createDirectCandidate(start, end, startControl, endControl),
    createDirectCandidate(start, end, startControlShort, endControlShort),
  ];

  // Generate arcing candidates with all scale combinations
  for (const distScale of arcDistScales) {
    for (const handleScale of arcHandleScales) {
      addArcCandidates({
        arcDistanceBase,
        arcDistanceScale: distScale,
        arcHandleDistanceBase: arcHandleBase,
        arcHandleScale: handleScale,
        arcTangent: arcDir,
        candidates,
        clickTangent: clickDir,
        end,
        endControl,
        midpoint: mid,
        naturalArcNormal,
        start,
        startControl,
        startControlDistance: startHandleDist,
      });
    }
  }

  // Return only the top N candidates
  return candidates.slice(0, config.candidateCount);
}

/**
 * Add arc-path candidates for both sides (normal & flipped).
 */
function addArcCandidates({
  arcDistanceBase, arcDistanceScale,
  arcHandleDistanceBase, arcHandleScale,
  arcTangent, candidates, clickTangent,
  end, endControl, midpoint,
  naturalArcNormal, start, startControl, startControlDistance,
}) {
  // Positive side
  buildSingleArcCandidate({
    arcDistanceBase, arcDistanceScale,
    arcHandleDistanceBase, arcHandleScale,
    arcNormal: naturalArcNormal, arcTangent,
    candidates, clickTangent,
    end, endControl, midpoint,
    start, startControl, startControlDistance,
  });
  // Negative side (flip the normal)
  buildSingleArcCandidate({
    arcDistanceBase, arcDistanceScale,
    arcHandleDistanceBase, arcHandleScale,
    arcNormal: { x: -naturalArcNormal.x, y: -naturalArcNormal.y },
    arcTangent,
    candidates, clickTangent,
    end, endControl, midpoint,
    start, startControl, startControlDistance,
  });
}

/**
 * Build one arc candidate and push it into the candidates array.
 *
 * The arc candidate has TWO Bézier segments:
 *   Segment 1: start → arc waypoint
 *   Segment 2: arc waypoint → end
 */
function buildSingleArcCandidate({
  arcDistanceBase, arcDistanceScale,
  arcHandleDistanceBase, arcHandleScale,
  arcNormal, arcTangent,
  candidates, clickTangent,
  end, endControl, midpoint,
  start, startControl, startControlDistance,
}) {
  const arcDist = arcDistanceBase * arcDistanceScale;
  const handleDist = arcHandleDistanceBase * arcHandleScale;

  // Arc waypoint = midpoint offset by the arc normal and a slight click tangent nudge
  const arc = {
    x: midpoint.x + arcNormal.x * arcDist + clickTangent.x * startControlDistance * 0.16,
    y: midpoint.y + arcNormal.y * arcDist + clickTangent.y * startControlDistance * 0.16,
  };

  // Control handles around the arc waypoint
  const arcIn  = { x: arc.x - arcTangent.x * handleDist, y: arc.y - arcTangent.y * handleDist };
  const arcOut = { x: arc.x + arcTangent.x * handleDist, y: arc.y + arcTangent.y * handleDist };

  candidates.push({
    arc,
    arcIn,
    arcOut,
    end,
    endControl,
    start,
    startControl,
    segments: [
      { control1: startControl, control2: arcIn,  end: arc },
      { control1: arcOut,      control2: endControl, end },
    ],
  });
}

/**
 * Create a direct (straight / non-arc) candidate with a single segment.
 */
function createDirectCandidate(start, end, startControl, endControl) {
  return {
    arc: null,
    arcIn: null,
    arcOut: null,
    end,
    endControl,
    start,
    startControl,
    segments: [{ control1: startControl, control2: endControl, end }],
  };
}

/**
 * Evaluate a point along a motion path at progress t ∈ [0, 1].
 * Returns { point, tangent }.
 */
function evaluateMotionPathAt(path, t) {
  const progress = clamp(t, 0, 1);

  const segmentIndex =
    progress === 1
      ? path.segments.length - 1
      : progress * path.segments.length;
  const floor = Math.floor(segmentIndex);
  const segment = path.segments[floor];

  if (segment == null) {
    throw new Error("Cursor motion path has no segment for progress");
  }

  const prevSegment = path.segments[floor - 1];
  const segStart =
    floor === 0 ? path.start : prevSegment?.end;

  if (segStart == null) {
    throw new Error("Cursor motion path segment is missing its start point");
  }

  const localT = progress === 1 ? 1 : segmentIndex - floor;

  return {
    point: cubicBezierPoint(segStart, segment.control1, segment.control2, segment.end, localT),
    tangent: cubicBezierTangent(segStart, segment.control1, segment.control2, segment.end, localT),
  };
}

/**
 * Score a candidate path based on:
 *   - Length (shorter = better, but not too short)
 *   - Angular change energy (smooth curves preferred)
 *   - Max angle change (no sharp turns)
 *   - Total turn (overall direction change)
 *   - Whether it stays inside the viewport
 */
function scoreCandidatePath(candidate, bounds, config) {
  let angleChangeEnergy = 0;
  let totalLength = 0;
  let maxAngleChange = 0;
  let totalTurn = 0;
  let prevAngle = null;

  // Start inside bounds check
  let staysInBounds =
    bounds == null || config == null
      ? true
      : isInsideBounds(candidate.start, bounds, config.boundsMargin);

  let prevPoint = candidate.start;
  let segStart = candidate.start;

  // Walk along each segment, sampling at 24 steps
  for (const segment of candidate.segments) {
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const point = cubicBezierPoint(
        segStart, segment.control1, segment.control2, segment.end, t
      );
      totalLength += distance(prevPoint, point);

      // Bounds check
      if (bounds != null && config != null) {
        staysInBounds = staysInBounds && isInsideBounds(point, bounds, config.boundsMargin);
      }

      // Angular energy
      const delta = { x: point.x - prevPoint.x, y: point.y - prevPoint.y };
      if (distance({ x: 0, y: 0 }, delta) > 0.01) {
        const angle = Math.atan2(delta.y, delta.x);
        if (prevAngle != null) {
          const dAngle = angleDelta(prevAngle, angle);
          angleChangeEnergy += dAngle * dAngle;
          maxAngleChange = Math.max(maxAngleChange, Math.abs(dAngle));
          totalTurn += Math.abs(dAngle);
        }
        prevAngle = angle;
      }

      prevPoint = point;
    }
    segStart = segment.end;
  }

  return {
    angleChangeEnergy,
    length: totalLength,
    maxAngleChange,
    staysInBounds,
    totalTurn,
  };
}

/**
 * Compute a cost score for a candidate (lower = better).
 */
function computeCandidateCost(candidate, metrics) {
  const directDist = Math.max(1, distance(candidate.start, candidate.end));
  const overshoot = Math.max(0, metrics.length / directDist - 1);
  const arcPenalty = candidate.arc == null ? 0 : 45;
  const clickAlignment = computeClickAlignment(candidate);

  return (
    metrics.length +
    overshoot * 320 +
    metrics.angleChangeEnergy * 140 +
    metrics.maxAngleChange * 180 +
    metrics.totalTurn * 18 +
    clickAlignment * 90 +
    arcPenalty
  );
}

/**
 * How misaligned the path is with the default click angle (-44°).
 * 0 = perfectly aligned, 1 = completely opposite.
 */
function computeClickAlignment(candidate) {
  const clickDir = degreesToDirection(-44);
  const pathDir = normalize({
    x: candidate.end.x - candidate.start.x,
    y: candidate.end.y - candidate.start.y,
  });
  return clamp((-(pathDir.x * clickDir.x + pathDir.y * clickDir.y) - 0.08) / 0.92, 0, 1);
}

/**
 * Select the best candidate from the list.
 * Prefers candidates that stay inside bounds; among those,
 * picks the one with the lowest cost.
 */
function selectBestCandidate(candidates, bounds, config) {
  const first = candidates[0];
  if (first == null) {
    throw new Error("Cursor motion requires at least one candidate");
  }

  let bestInBounds = first;
  let bestInBoundsScore = Number.POSITIVE_INFINITY;
  let bestOverall = first;
  let bestOverallScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const metrics = scoreCandidatePath(candidate, bounds, config);
    const cost = computeCandidateCost(candidate, metrics);

    if (metrics.staysInBounds && cost < bestInBoundsScore) {
      bestInBounds = candidate;
      bestInBoundsScore = cost;
    }
    if (cost < bestOverallScore) {
      bestOverall = candidate;
      bestOverallScore = cost;
    }
  }

  // If no candidate stays in bounds, fall back to the cheapest overall
  if (bestInBoundsScore === Number.POSITIVE_INFINITY) {
    return bestOverall;
  }
  return bestInBounds;
}

/**
 * Compute animation parameters (response & damping) for a motion path,
 * adapted to the path's geometry so the cursor feels natural.
 */
function computeMotionAnimationParams(candidate) {
  const metrics = scoreCandidatePath(candidate, null, null);
  const directDist = Math.max(1, distance(candidate.start, candidate.end));
  const overshoot = Math.max(0, metrics.length / directDist - 1);

  // Normalized factors (0..1)
  const lengthFactor   = clamp((metrics.length - 180) / 760, 0, 1);
  const overshootFactor = clamp(overshoot / 0.55, 0, 1);
  const turnFactor     = clamp(metrics.totalTurn / (Math.PI * 1.4), 0, 1);
  const energyFactor   = clamp(metrics.angleChangeEnergy / 1.25, 0, 1);
  const complexity     = clamp(overshootFactor * 0.42 + turnFactor * 0.38 + energyFactor * 0.2, 0, 1);

  const clickAlignment = computeClickAlignment(candidate);
  const arcFactor = candidate.arc == null ? 0 : 0.04;
  const alignmentWeight = clickAlignment * 0.28;
  const arcWeight = candidate.arc == null ? 1 : 0.9;

  const BASE_RESPONSE = 0.7;
  const MIN_RESPONSE  = 0.12;
  const MAX_RESPONSE  = 2.2;

  return {
    response: clamp(
      (0.42 + lengthFactor * 0.22 + complexity * 0.12 + alignmentWeight + arcFactor) * BASE_RESPONSE * arcWeight,
      MIN_RESPONSE,
      MAX_RESPONSE
    ),
    dampingFraction: 0.9, // reused from outer scope
  };
}

// ─────────────────────────────────────────────────────────────
//  5. FAVICON BADGE MANAGER
// ─────────────────────────────────────────────────────────────

const FAVICON_ATTR = 'data-codex-favicon-badge="true"';
const FAVICON_SELECTOR = 'link[rel~="icon"], link[rel="shortcut icon"]';
const CREATED_BY_CODEX_ATTR = "codexFaviconBadgeCreated";
const ORIGINAL_HREF_ATTR = "codexOriginalFaviconHref";

const BADGE_COLORS = {
  active: "black",
  deliverable: "#22c55e", // green
  handoff: "#facc15",     // yellow
};

// SVG path for the cursor/pointer icon
const CURSOR_ICON_PATH =
  "M3.04536 4.45259C2.7582 3.60299 3.60299 2.7582 4.45259 3.04536" +
  "L14.1828 6.33403C15.1637 6.66558 15.0872 8.08006 14.0715 8.39045" +
  "L10.2994 9.54319C9.93919 9.65327 9.65327 9.93919 9.54319 10.2994" +
  "L8.39046 14.0715C8.08007 15.0872 6.66558 15.1637 6.33404 14.1828" +
  "L3.04536 4.45259Z";

let activeBadges = []; // Track currently managed badge entries

/**
 * Set (or remove) the favicon badge.
 * @param {string|null} badgeType - "active" | "deliverable" | "handoff" | null
 * @param {string|null} faviconDataUrl - Original favicon as data: URL
 */
function setFaviconBadge(badgeType, faviconDataUrl) {
  clearAllBadges();
  if (badgeType == null || faviconDataUrl == null) return;

  const entries = findOrCreateFaviconLinks(badgeType, faviconDataUrl);
  activeBadges = entries;
  for (const entry of entries) {
    applyBadge(entry);
  }
}

/**
 * Remove all managed badges and restore originals.
 */
function clearAllBadges() {
  restoreManagedBadges();
  cleanupStaleBadges();
}

/**
 * Find existing favicon <link> elements or create one.
 */
function findOrCreateFaviconLinks(badgeType, faviconDataUrl) {
  const badgedHref = buildBadgedSvgDataUrl(badgeType, faviconDataUrl);
  const existingLinks = [...document.querySelectorAll(FAVICON_SELECTOR)];

  if (existingLinks.length > 0) {
    return existingLinks.map((link) => ({
      badgedHref,
      createdByCodex: false,
      originalHref: link.getAttribute("href"),
      link,
    }));
  }

  // No favicon link exists — create one
  const link = document.createElement("link");
  link.rel = "icon";
  getOrCreateHead().appendChild(link);
  return [{ badgedHref, createdByCodex: true, originalHref: null, link }];
}

/**
 * Apply a badge to a single favicon link element.
 */
function applyBadge({ badgedHref, createdByCodex, originalHref, link }) {
  link.href = badgedHref;
  link.dataset.codexFaviconBadge = "true";
  storeBadgeMetadata(link, createdByCodex, originalHref);
}

/**
 * Restore all managed badges to their original state.
 */
function restoreManagedBadges() {
  const prev = activeBadges;
  activeBadges = [];
  for (const entry of prev) {
    restoreBadge(entry);
  }
}

/**
 * Restore a single badge entry.
 */
function restoreBadge({ badgedHref, createdByCodex, originalHref, link }) {
  const currentHref = link.getAttribute("href");
  const isOurBadge = currentHref === badgedHref || isCodexBadgeSvg(currentHref);
  clearBadgeAttrs(link);
  if (isOurBadge) {
    restoreLink(link, createdByCodex, originalHref);
  }
}

/**
 * Clean up stale badges left by previous script injections.
 */
function cleanupStaleBadges() {
  for (const el of document.querySelectorAll(`link[${FAVICON_ATTR}]`)) {
    const href = el.getAttribute("href");
    if (!isCodexBadgeSvg(href)) {
      clearBadgeAttrs(el);
      continue;
    }
    const createdByCodex = el.dataset[CREATED_BY_CODEX_ATTR] === "true";
    const originalHref = el.dataset[ORIGINAL_HREF_ATTR] ?? null;
    clearBadgeAttrs(el);
    restoreLink(el, createdByCodex, originalHref);
  }
}

function storeBadgeMetadata(link, createdByCodex, originalHref) {
  if (createdByCodex) {
    link.dataset[CREATED_BY_CODEX_ATTR] = "true";
  } else {
    delete link.dataset[CREATED_BY_CODEX_ATTR];
  }
  if (originalHref == null) {
    delete link.dataset[ORIGINAL_HREF_ATTR];
  } else {
    link.dataset[ORIGINAL_HREF_ATTR] = originalHref;
  }
}

function restoreLink(link, createdByCodex, originalHref) {
  if (createdByCodex) {
    link.remove();
  } else if (originalHref == null) {
    link.removeAttribute("href");
  } else {
    link.href = originalHref;
  }
}

function getOrCreateHead() {
  if (document.head) return document.head;
  const head = document.createElement("head");
  document.documentElement.prepend(head);
  return head;
}

function clearBadgeAttrs(link) {
  delete link.dataset.codexFaviconBadge;
  delete link.dataset[CREATED_BY_CODEX_ATTR];
  delete link.dataset[ORIGINAL_HREF_ATTR];
}

/**
 * Build an SVG data URL containing the original favicon + a badge overlay.
 */
function buildBadgedSvgDataUrl(badgeType, faviconDataUrl) {
  const opacityAttr = badgeType === "active" ? ' opacity="0.3"' : "";
  const escapedUrl = escapeXml(faviconDataUrl);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<image href="${escapedUrl}" width="32" height="32"${opacityAttr} />` +
    getBadgeSvgOverlay(badgeType) +
    `</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Return the SVG element for the badge overlay.
 */
function getBadgeSvgOverlay(badgeType) {
  switch (badgeType) {
    case "active":
      return `<path d="${CURSOR_ICON_PATH}" fill="${BADGE_COLORS.active}" ` +
        `stroke="white" stroke-width="1.5" stroke-linejoin="round" ` +
        `paint-order="stroke fill" transform="translate(-2 -2) scale(2.1)" />`;
    case "deliverable":
      return `<circle cx="24" cy="24" r="7" fill="${BADGE_COLORS.deliverable}" />`;
    case "handoff":
      return `<circle cx="24" cy="24" r="7" fill="${BADGE_COLORS.handoff}" />`;
  }
  return "";
}

/**
 * Check if a data URL is a Codex badge SVG.
 */
function isCodexBadgeSvg(dataUrl) {
  if (dataUrl == null || !dataUrl.startsWith("data:image/svg+xml,")) return false;
  try {
    return decodeURIComponent(dataUrl.slice(19)).includes(
      'data-codex-favicon-badge="codex-favicon-badge"'
    );
  } catch {
    return false;
  }
}

function escapeXml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ─────────────────────────────────────────────────────────────
//  6. CURSOR OVERLAY (DOM + Animation Controller)
// ─────────────────────────────────────────────────────────────

// Cursor dimensions
const CURSOR_SIZE = 24;
const CURSOR_HALF = CURSOR_SIZE / 2;
const CURSOR_IMG_HEIGHT = 23;
const CURSOR_IMG_WIDTH = 24;
const CURSOR_OFFSET_X = 12;
const CURSOR_OFFSET_Y = -2.5;
const CURSOR_ROTATION = 44; // degrees
const CURSOR_BASE_BLUR = 5;
const CURSOR_SCALE_IN = 0.4;
const CURSOR_MIN_STRETCH = 0;
const CURSOR_STRETCH_RESPONSE = 1.41;
const CURSOR_STRETCH_FREQ = 0.66;
const CURSOR_WOBBLE_AMP = 12.5;
const CURSOR_POSITION_FREQ = 0.58;
const CURSOR_VIEWPORT_FREQ = 0.55;

// Animation thresholds
const FRAME_DURATION = 1 / 60;
const ARRIVAL_DIST_THRESHOLD = 0.85;
const ARRIVAL_VEL_THRESHOLD = 12;
const VISIBLE_THRESHOLD = 0.001;
const MIN_DELTA_TIME = 1 / 240;

// Spring configurations for the cursor animation system
const SPRING_CONFIG = {
  stretch:     { dampingFraction: 0.85, response: 0.2  },
  visibility:  { dampingFraction: 0.86, response: 0.42 },
  scoot:       { dampingFraction: 0.94, response: 0.19 },
  position:    { dampingFraction: 0.9,  response: 0.19 },
  rotation:    { dampingFraction: 0.9,  response: 0.12 },
  slowScoot:   { dampingFraction: 0.82, response: 0.055 },
  scootRotate: { dampingFraction: 0.86, response: 0.12 },
};

/**
 * Project a tangent vector to a rotation angle (degrees).
 */
function tangentToRotation(tangent) {
  if (distance({ x: 0, y: 0 }, tangent) < 0.001) {
    return normalizeAngle360(-44);
  }
  const unit = normalize(tangent);
  return normalizeAngle360(Math.atan2(unit.y, unit.x) * (180 / Math.PI) + 90);
}

/**
 * Compute cursor spring response from motion path response.
 * This makes the cursor feel "heavy" or "light" based on path complexity.
 */
function computeCursorResponse(motionResponse) {
  return clamp(motionResponse * 0.18, 0.035, 0.12);
}

/**
 * Compute stretch factor based on cursor speed.
 * Faster movement = more squished.
 */
function computeStretchFromSpeed(speed) {
  return clamp(1 - speed / 5500, 0.65, 1);
}

/**
 * Compute scoot-stretch factor (for the scoot animation wiggle).
 */
function computeScootStretch(progress) {
  return lerp(
    1,
    lerp(1, CURSOR_MIN_STRETCH, Math.sin(clamp(progress, 0, 1) * Math.PI)),
    0.15
  );
}

/**
 * Create the cursor overlay in the given container element.
 *
 * @param {HTMLElement} container  - Where to append the overlay
 * @param {string}      assetUrl  - URL for the cursor image
 * @param {string}      dataTestId - test-id for the cursor element
 * @param {function}    onArrived - Callback when cursor reaches its target
 * @returns {{ destroy: () => void, setState: (state) => void }}
 */
function createCursorOverlay(container, { assetUrl, dataTestId = "browser-agent-cursor", onArrived }) {
  // Create DOM elements
  const { cursor, layer } = createCursorDOM(container, assetUrl, dataTestId);

  let animFrameId = null;
  let lastTimestamp = now();
  let currentState = null;
  let lastArrivalKey = null;
  let expectedArrivalKey = null;
  let currentTurnKey = null;
  let lastFadeInTurnKey = null;
  let isTeleporting = false;
  let isDestroyed = false;

  /**
   * Fire the onArrived callback when appropriate.
   */
  const maybeNotifyArrived = () => {
    if (lastArrivalKey == null || expectedArrivalKey == null) return;
    if (lastArrivalKey !== expectedArrivalKey) return;
    onArrived?.(lastArrivalKey);
  };

  /**
   * Start the animation loop (idempotent).
   */
  const startAnimation = () => {
    if (animFrameId != null || currentState == null || isDestroyed) return;

    animFrameId = requestAnimationFrame((timestamp) => {
      animFrameId = null;
      const state = currentState;
      if (state == null) return;

      // Compute delta time
      const dt = isTeleporting
        ? FRAME_DURATION
        : Math.max(FRAME_DURATION, (timestamp - lastTimestamp) / 1000);
      isTeleporting = false;
      lastTimestamp = timestamp;

      // Advance physics
      const arrived = updateCursorPhysics(state, dt, timestamp);
      renderCursor(cursor, state);

      if (arrived) maybeNotifyArrived();
      if (isCursorAnimating(state)) startAnimation();
    });
  };

  return {
    /**
     * Tear down the overlay and stop all animation.
     */
    destroy() {
      isDestroyed = true;
      if (animFrameId != null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      layer.remove();
    },

    /**
     * Update cursor state from external messages.
     */
    setState(newState) {
      const turnKey = newState.turnKey ?? "";
      const hasCursor = newState.cursor != null;
      const point = computeDefaultPoint({
        cursorX: newState.cursor?.x,
        cursorY: newState.cursor?.y,
        viewportHeight: newState.viewportSize.height,
        viewportWidth: newState.viewportSize.width,
      });
      const isVisible = newState.isVisible !== false && newState.cursor?.visible !== false;
      const shouldAnimate = newState.cursor?.animateMovement !== false;
      const justBecameVisible = isVisible && !hasCursor;

      lastArrivalKey = newState.cursor?.moveSequence ?? null;
      expectedArrivalKey = lastArrivalKey == null ? null : `${turnKey}:${lastArrivalKey}`;

      // Initialize state on first call
      if (currentState == null) {
        currentState = createCursorState(point, isVisible);
      }
      currentState.visibilitySpring.target = isVisible ? 1 : 0;

      // Handle fade-in (cursor just appeared)
      if (justBecameVisible && currentTurnKey !== turnKey) {
        currentTurnKey = turnKey;
        snapSpring(currentState.visibilitySpring, 1);
        currentState.thinkStartedAt = now();
      }

      // No cursor position — just set visibility
      if (!hasCursor) {
        teleportCursor(currentState, point);
        renderCursor(cursor, currentState);
        startAnimation();
        return;
      }

      // Handle cursor appearing from invisible → visible
      const shouldFlashIn =
        newState.cursor?.moveSequence != null &&
        isVisible &&
        currentState.visibilitySpring.value <= VISIBLE_THRESHOLD &&
        lastFadeInTurnKey !== turnKey;

      currentState.thinkStartedAt = null;

      const dist = distance(currentState.point, point);

      // Short distance or no animation → snap directly
      if (!shouldAnimate || shouldFlashIn || dist < 0.5) {
        if (shouldFlashIn) {
          lastFadeInTurnKey = turnKey;
          snapSpring(currentState.visibilitySpring, 1);
        }
        teleportCursor(currentState, point);
        if (!shouldAnimate) {
          currentState.stretchSpring.force = 0;
          currentState.stretchSpring.value = 1;
          currentState.stretchSpring.velocity = 0;
        }
        renderCursor(cursor, currentState);
        maybeNotifyArrived();
        startAnimation();
        return;
      }

      // Long distance → animate along a motion path
      startAnimatedMove(currentState, point, newState.viewportSize);
      isTeleporting = true;
      renderCursor(cursor, currentState);
      startAnimation();
    },
  };
}

/**
 * Create the cursor DOM elements.
 */
function createCursorDOM(container, assetUrl, dataTestId) {
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "inset:0;overflow:hidden;pointer-events:none;position:absolute;z-index:20";

  const cursor = document.createElement("div");
  cursor.dataset.testid = dataTestId;
  cursor.style.cssText = `height:${CURSOR_SIZE}px;left:0;position:absolute;top:0;` +
    `transform-origin:${CURSOR_HALF}px ${CURSOR_HALF}px;will-change:transform;width:${CURSOR_SIZE}px`;

  const inner = document.createElement("div");
  inner.style.transform = `translate3d(${CURSOR_OFFSET_X}px, ${CURSOR_OFFSET_Y}px, 0)`;

  const img = document.createElement("img");
  img.alt = "";
  img.dataset.browserAgentCursorAsset = "";
  img.dataset.testid = `${dataTestId}-asset`;
  img.draggable = false;
  img.height = CURSOR_IMG_HEIGHT;
  img.src = assetUrl;
  img.style.cssText = `display:block;transform:rotate(${CURSOR_ROTATION}deg) scale(1);transform-origin:0 0;width:${CURSOR_IMG_WIDTH}`;

  inner.appendChild(img);
  cursor.appendChild(inner);
  layer.appendChild(cursor);
  container.appendChild(layer);

  return { cursor, layer };
}

/**
 * Create the initial cursor animation state with all springs.
 */
function createCursorState(point, isVisible) {
  const initialVisibility = isVisible ? 1 : 0;
  const initialRotation = normalizeAngle360(-44);

  return {
    point,
    motion: null,              // current motion (bezier or scoot)
    positionXSpring:   createSpring(point.x, point.x, SPRING_CONFIG.position),
    positionYSpring:   createSpring(point.y, point.y, SPRING_CONFIG.position),
    rotation:          initialRotation,
    rotationSpring:    createSpring(initialRotation, initialRotation, SPRING_CONFIG.rotation),
    scootAxisRotation: 0,
    scootAxisSpring:   createSpring(0, 0, SPRING_CONFIG.rotation),
    scootRotationSpring: createSpring(0, 0, SPRING_CONFIG.scootRotate),
    scootStretchSpring: createSpring(1, 1, SPRING_CONFIG.scootRotate),
    stretchSpring:      createSpring(1, 1, SPRING_CONFIG.stretch),
    thinkStartedAt:     null,  // timestamp of "thinking" idle animation
    visibilitySpring:   createSpring(initialVisibility, initialVisibility, SPRING_CONFIG.visibility),
  };
}

/**
 * Start an animated cursor move (long distance → Bézier path, short → scoot).
 */
function startAnimatedMove(state, target, viewportSize) {
  state.thinkStartedAt = null;
  const origin = { x: state.point.x, y: state.point.y };

  if (distance(origin, target) <= 196) {
    // Short distance → use "scoot" animation
    startScootMove(state, origin, target);
  } else {
    // Long distance → use Bézier motion path
    startBezierMove(state, origin, target, viewportSize);
  }
}

/**
 * Start a Bézier-path animated move.
 */
function startBezierMove(state, origin, target, viewportSize) {
  const bestPath = generateBestMotionPath({
    bounds: viewportSize,
    end: target,
    start: origin,
  });
  const animParams = computeMotionAnimationParams(bestPath);

  setPositionSpringsResponse(state, computeCursorResponse(animParams.response), animParams.dampingFraction);

  state.motion = {
    mode: "bezier",
    path: bestPath,
    progressSpring: createSpring(0, 1, animParams),
  };
}

/**
 * Start a short-distance "scoot" animated move.
 */
function startScootMove(state, origin, target) {
  const scootParams = computeScootParams(origin, target);

  setPositionSpringsResponse(state, SPRING_CONFIG.position.response, SPRING_CONFIG.position.dampingFraction);
  state.positionXSpring.target = target.x;
  state.positionYSpring.target = target.y;
  setSpringTargetAngle(state.rotationSpring, normalizeAngle360(-44));
  setSpringTargetAngle(state.scootAxisSpring, scootParams.axisRotation);

  state.motion = {
    mode: "scoot",
    start: origin,
    end: target,
    axisRotation: scootParams.axisRotation,
    rotationTarget: scootParams.rotationTarget,
    progressSpring: createSpring(0, 1, SPRING_CONFIG.scoot),
  };
}

/**
 * Compute the scoot animation parameters (rotation axis and target skew).
 */
function computeScootParams(origin, target) {
  const dir = normalize({ x: target.x - origin.x, y: target.y - origin.y });
  return {
    axisRotation: distance({ x: 0, y: 0 }, dir) < 0.001
      ? 0
      : Math.atan2(dir.y, dir.x) * (180 / Math.PI),
    rotationTarget: clamp(dir.x * 0.75 + -dir.y * 0.62, -1, 1) * 70,
  };
}

/**
 * Set response/damping for position springs (used during animated moves).
 */
function setPositionSpringsResponse(state, response, dampingFraction) {
  state.positionXSpring.response = response;
  state.positionYSpring.response = response;
  state.positionXSpring.dampingFraction = dampingFraction;
  state.positionYSpring.dampingFraction = dampingFraction;
}

/**
 * Main physics update step. Returns `true` if the cursor just arrived.
 */
function updateCursorPhysics(state, dt, timestamp) {
  const arrived = updateMotionProgress(state, dt);
  stepSpring(state.visibilitySpring, dt);
  stepSpring(state.stretchSpring, dt);
  stepSpring(state.scootStretchSpring, dt);
  stepSpring(state.scootRotationSpring, dt);
  return arrived;
}

/**
 * Update the motion progress (bezier or scoot). Returns true on arrival.
 */
function updateMotionProgress(state, dt) {
  if (state.motion == null) {
    state.stretchSpring.target = 1;
    state.scootStretchSpring.target = 1;
    state.scootRotationSpring.target = 0;
    return false;
  }

  const clampedDt = Math.max(0, dt);
  state.thinkStartedAt = null;

  if (state.motion.mode === "scoot") {
    return updateScootMotion(state, clampedDt, now());
  }
  return updateBezierMotion(state, clampedDt, now());
}

/**
 * Update Bézier-path motion. Returns true when cursor arrives.
 */
function updateBezierMotion(state, dt, timestamp) {
  if (state.motion?.mode !== "bezier") return false;

  state.scootStretchSpring.target = 1;
  state.scootRotationSpring.target = 0;
  stepSpring(state.motion.progressSpring, dt);

  const progress = clamp(state.motion.progressSpring.value, 0, 1);
  const { point, tangent } = evaluateMotionPathAt(state.motion.path, progress);
  const angle = tangentToRotation(tangent);

  state.positionXSpring.target = point.x;
  state.positionYSpring.target = point.y;
  setSpringTargetAngle(state.rotationSpring, angle);
  setSpringTargetAngle(state.scootAxisSpring, 0);

  const speed = computeCursorSpeed(state, dt);
  state.stretchSpring.target = computeStretchFromSpeed(speed.speed);

  // Check arrival
  if (
    progress >= 0.999 &&
    Math.abs(state.motion.progressSpring.velocity) < 0.01 &&
    isNearTarget(state, point)
  ) {
    // Arrived!
    const finalPoint = evaluateMotionPathAt(state.motion.path, 1);
    const finalAngle = tangentToRotation(finalPoint.tangent);
    snapToPoint(state, finalPoint.point);
    snapSpring(state.rotationSpring, finalAngle);
    state.rotation = finalAngle;
    snapSpring(state.scootAxisSpring, 0);
    state.scootAxisRotation = 0;
    snapSpring(state.stretchSpring, 1);
    state.motion = null;
    state.thinkStartedAt = timestamp;
    return true;
  }

  return false;
}

/**
 * Update scoot motion. Returns true when cursor arrives.
 */
function updateScootMotion(state, dt, timestamp) {
  if (state.motion?.mode !== "scoot") return false;

  stepSpring(state.motion.progressSpring, dt);
  state.positionXSpring.target = state.motion.end.x;
  state.positionYSpring.target = state.motion.end.y;
  setSpringTargetAngle(state.scootAxisSpring, state.motion.axisRotation);
  setSpringTargetAngle(state.rotationSpring, normalizeAngle360(-44));

  const speed = computeCursorSpeed(state, dt);
  const projection = projectPointOntoSegment(speed.point, state.motion.start, state.motion.end);
  const squashFactor = Math.sin(Math.min(1, projection) * Math.PI);

  state.stretchSpring.target = 1;
  state.scootStretchSpring.target = computeScootStretch(projection);
  state.scootRotationSpring.target = state.motion.rotationTarget * squashFactor;

  // Check arrival
  if (
    projection >= 0.999 &&
    Math.abs(state.motion.progressSpring.velocity) < 0.01 &&
    isNearTarget(state, state.motion.end)
  ) {
    snapToPoint(state, state.motion.end);
    snapSpring(state.rotationSpring, normalizeAngle360(-44));
    state.rotation = state.rotationSpring.value;
    resetScootSprings(state);
    snapSpring(state.stretchSpring, 1);
    state.motion = null;
    state.thinkStartedAt = timestamp;
    return true;
  }

  return false;
}

/**
 * Check if the cursor is still animating (any spring or motion is active).
 */
function isCursorAnimating(state) {
  return (
    state.motion != null ||
    state.thinkStartedAt != null ||
    !isSpringSettled(state.positionXSpring) ||
    !isSpringSettled(state.positionYSpring) ||
    !isSpringSettled(state.rotationSpring) ||
    !isSpringSettled(state.scootAxisSpring) ||
    !isSpringSettled(state.scootRotationSpring) ||
    !isSpringSettled(state.scootStretchSpring) ||
    !isSpringSettled(state.stretchSpring) ||
    !isSpringSettled(state.visibilitySpring)
  );
}

/**
 * Snap cursor to a point instantly (no animation).
 */
function teleportCursor(state, point) {
  state.motion = null;
  snapToPoint(state, point);
  snapSpring(state.rotationSpring, normalizeAngle360(-44));
  state.rotation = state.rotationSpring.value;
  resetScootSprings(state);
  snapSpring(state.stretchSpring, 1);
}

/**
 * Snap position springs to a target point.
 */
function snapToPoint(state, point) {
  snapSpring(state.positionXSpring, point.x);
  snapSpring(state.positionYSpring, point.y);
}

/**
 * Reset all scoot-related springs to their defaults.
 */
function resetScootSprings(state) {
  snapSpring(state.scootAxisSpring, 0);
  snapSpring(state.scootRotationSpring, 0);
  snapSpring(state.scootStretchSpring, 1);
  state.scootAxisRotation = 0;
}

/**
 * Compute the current cursor speed and update position state.
 */
function computeCursorSpeed(state, dt) {
  const prevPoint = state.point;
  stepSpring(state.positionXSpring, dt);
  stepSpring(state.positionYSpring, dt);
  stepSpring(state.rotationSpring, dt);
  stepSpring(state.scootAxisSpring, dt);

  const currentPoint = { x: state.positionXSpring.value, y: state.positionYSpring.value };
  const speed = distance(prevPoint, currentPoint) / Math.max(dt, MIN_DELTA_TIME);

  state.point = currentPoint;
  state.rotation = state.rotationSpring.value;
  state.scootAxisRotation = state.scootAxisSpring.value;

  return { point: currentPoint, speed };
}

/**
 * Check if cursor is close enough to target and slow enough to be "arrived".
 */
function isNearTarget(state, target) {
  return (
    distance(state.point, target) <= ARRIVAL_DIST_THRESHOLD &&
    Math.abs(state.positionXSpring.velocity) <= ARRIVAL_VEL_THRESHOLD &&
    Math.abs(state.positionYSpring.velocity) <= ARRIVAL_VEL_THRESHOLD
  );
}

/**
 * Project a point onto a line segment, returning parameter t ∈ [0, 1].
 */
function projectPointOntoSegment(point, segmentStart, segmentEnd) {
  const seg = { x: segmentEnd.x - segmentStart.x, y: segmentEnd.y - segmentStart.y };
  const lenSq = seg.x * seg.x + seg.y * seg.y;
  if (lenSq < 0.001) return 1;
  return clamp(
    ((point.x - segmentStart.x) * seg.x + (point.y - segmentStart.y) * seg.y) / lenSq,
    0,
    1
  );
}

/**
 * Compute the default cursor point (center of viewport if not specified).
 */
function computeDefaultPoint({ cursorX, cursorY, viewportHeight, viewportWidth }) {
  return {
    x: clamp(cursorX ?? Math.round(viewportWidth * 0.58), 0, viewportWidth),
    y: clamp(cursorY ?? Math.round(viewportHeight * 0.55), 0, viewportHeight),
  };
}

/**
 * Compute the "thinking" idle wobble angle.
 */
function computeThinkingRotation(state, timestamp) {
  if (state.thinkStartedAt == null) return state.rotation;

  const elapsed = (timestamp - state.thinkStartedAt) / 1000 - 2.5; // 2.5s delay
  if (elapsed < 0) return state.rotation;

  const progress = Math.min(1, elapsed / 1.41);
  const envelope = Math.sin(progress * Math.PI);
  const wobble = Math.sin(elapsed / 0.66 * Math.PI * 2) * envelope;

  if (progress >= 1) {
    state.thinkStartedAt = null;
    return state.rotation;
  }
  return state.rotation + wobble * 12.5;
}

/**
 * Render the cursor's visual state to the DOM element.
 */
function renderCursor(cursorEl, state) {
  const rotation = computeThinkingRotation(state, now());
  const visual = buildVisualProps({
    point: state.point,
    rotation,
    scootAxisRotation: state.scootAxisRotation,
    scootRotation: state.scootRotationSpring.value,
    scootStretch: state.scootStretchSpring.value,
    stretch: state.stretchSpring.value,
    visibility: state.visibilitySpring.value,
  });
  cursorEl.style.transform = visual.transform;
  cursorEl.style.opacity = `${visual.opacity}`;
  cursorEl.style.filter = visual.filter;
}

/**
 * Build CSS transform, opacity, and filter for the cursor.
 */
function buildVisualProps({
  point, rotation, scootAxisRotation, scootRotation, scootStretch, stretch, visibility,
}) {
  const v = clamp(visibility, 0, 1);
  const scale = lerp(CURSOR_SCALE_IN, 1, v);
  const blur = lerp(CURSOR_BASE_BLUR, 0, v);
  const stretchY = clamp(scootStretch, CURSOR_MIN_STRETCH, 1);

  const transforms = [`translate3d(${round3(point.x - CURSOR_HALF)}px, ${round3(point.y - CURSOR_HALF)}px, 0)`];

  // Add scoot distortion (rotate → scale → counter-rotate for directional squash)
  if (Math.abs(wrapAngleDelta(0, scootAxisRotation)) > 0.001 || Math.abs(stretchY - 1) > 0.001) {
    transforms.push(
      `rotate(${round3(scootAxisRotation)}deg)`,
      `scale(1, ${round3(stretchY)})`,
      `rotate(${round3(-scootAxisRotation)}deg)`
    );
  }

  // Main rotation + stretch
  transforms.push(
    `rotate(${round3(normalizeAngle360(rotation + scootRotation))}deg)`,
    `scale(${round3(stretch * scale)}, ${round3(scale)})`
  );

  return {
    transform: transforms.join(" "),
    opacity: round3(v),
    filter: `blur(${round3(blur)}px)`,
  };
}

// ─────────────────────────────────────────────────────────────
//  7. AGENT OVERLAY MOUNT (Content Script Entry Point)
// ─────────────────────────────────────────────────────────────

const IS_TOP_FRAME = window.top === window.self;
const CURSOR_GLOW_FILTER =
  "drop-shadow(0 0 6px rgba(51, 156, 255, 0.9)) drop-shadow(0 0 15px rgba(51, 156, 255, 0.48))";

/**
 * Validate and normalize an incoming cursor state message.
 */
function parseCursorState(raw) {
  if (!raw || typeof raw !== "object") {
    return { cursor: null, isVisible: false, sessionId: null, turnId: null };
  }

  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : null;
  const turnId = typeof raw.turnId === "string" ? raw.turnId : null;

  return {
    cursor: parseCursor(raw.cursor),
    isVisible: raw.isVisible === true && sessionId != null,
    sessionId,
    turnId,
  };
}

/**
 * Validate a cursor object.
 */
function parseCursor(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (
    typeof raw.visible !== "boolean" ||
    typeof raw.x !== "number" ||
    typeof raw.y !== "number" ||
    !Number.isFinite(raw.x) ||
    !Number.isFinite(raw.y)
  ) {
    return null;
  }
  return {
    visible: raw.visible,
    x: raw.x,
    y: raw.y,
    ...(typeof raw.animateMovement === "boolean" ? { animateMovement: raw.animateMovement } : {}),
    ...(Number.isInteger(raw.moveSequence) ? { moveSequence: raw.moveSequence } : {}),
  };
}

/**
 * Mount the agent overlay into a container element.
 * Sets up the cursor, Chrome message listeners, and resize handlers.
 */
function mountAgentOverlay(container) {
  let cursorState = { cursor: null, isVisible: false, sessionId: null, turnId: null };
  let cursorController = null;

  // Create the overlay div
  const overlayDiv = document.createElement("div");
  overlayDiv.className = "codex-agent-overlay";
  overlayDiv.setAttribute("aria-hidden", "true");

  // Only create the animated cursor if we're in the top frame
  if (IS_TOP_FRAME) {
    cursorController = createCursorOverlay(overlayDiv, {
      assetUrl: chrome.runtime.getURL("images/cursor-chat.png"),
      onArrived(moveSequence) {
        if (cursorState.sessionId == null || cursorState.turnId == null) return;
        chrome.runtime.sendMessage({
          type: "AGENT_CURSOR_ARRIVED",
          moveSequence,
          sessionId: cursorState.sessionId,
          turnId: cursorState.turnId,
        }).catch(() => {});
      },
    });

    // Apply glow filter to cursor image (only in top frame)
    const cursorAsset = overlayDiv.querySelector("[data-browser-agent-cursor-asset]");
    if (cursorAsset != null) {
      cursorAsset.style.filter = CURSOR_GLOW_FILTER;
    }
  }

  /**
   * Push current state to the cursor controller.
   */
  function syncCursorToDOM() {
    cursorController?.setState({
      cursor: cursorState.cursor,
      isVisible: cursorState.isVisible && cursorState.sessionId != null,
      turnKey: cursorState.sessionId == null ? null : `${cursorState.sessionId}:${cursorState.turnId ?? ""}`,
      viewportSize: getViewportSize(),
    });
  }

  function handleNewState(newState) {
    cursorState = newState;
    syncCursorToDOM();
  }

  // Chrome message handler
  function onMessage(message, sender, sendResponse) {
    if (message?.type !== "AGENT_CURSOR_STATE") return false;
    if (cursorController == null) {
      sendResponse({ ok: false });
      return true;
    }
    handleNewState(parseCursorState(message.state));
    sendResponse({ ok: true });
    return true;
  }

  // Set up listeners
  chrome.runtime.onMessage.addListener(onMessage);
  window.addEventListener("resize", syncCursorToDOM);
  window.visualViewport?.addEventListener("resize", syncCursorToDOM);

  // Mount to DOM
  container.replaceChildren(overlayDiv);
  syncCursorToDOM();

  // Request initial state
  chrome.runtime.sendMessage({ type: "GET_AGENT_CURSOR_STATE" })
    .then((response) => {
      if (response?.ok) handleNewState(parseCursorState(response.state));
    })
    .catch(() => {});

  // Return cleanup function
  return () => {
    cursorController?.destroy();
    chrome.runtime.onMessage.removeListener(onMessage);
    window.removeEventListener("resize", syncCursorToDOM);
    window.visualViewport?.removeEventListener("resize", syncCursorToDOM);
    container.replaceChildren();
  };
}

/**
 * Get current viewport size (respects visualViewport API).
 */
function getViewportSize() {
  return {
    height: window.visualViewport?.height ?? window.innerHeight,
    width: window.visualViewport?.width ?? window.innerWidth,
  };
}

// ─────────────────────────────────────────────────────────────
//  8. CONTENT SCRIPT BOOTSTRAP (WXT Framework)
// ─────────────────────────────────────────────────────────────

const OVERLAY_CSS = `.codex-agent-overlay {
  all: initial;
  z-index: 2147483646;
  pointer-events: none;
  position: fixed;
  inset: 0;
}
@media print {
  .codex-agent-overlay { display: none; }
}`;

const ROOT_ELEMENT_ID = "codex-agent-overlay-root";
const ROOT_CREATED_ATTR = "codexAgentOverlayRoot";

let isRunning = false;
let rootElement = null;
let mutationObserver = null;
let observedNodes = [];
let cleanupFn = null;

/**
 * Main entry point called by the WXT content script manager.
 */
function startOverlay() {
  if (isRunning) {
    ensureOverlayMounted();
    return;
  }

  isRunning = true;
  ensureOverlayMounted();

  // Listen for Chrome messages
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isContentPing(message)) {
      sendResponse({ ok: true });
      return true;
    }
    if (isFaviconBadgeMessage(message)) {
      setFaviconBadge(message.badge, message.faviconDataUrl);
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
}

function isContentPing(msg) {
  return isNonNullObject(msg) && msg.type === "CONTENT_PING";
}

function isFaviconBadgeMessage(msg) {
  if (!isNonNullObject(msg) || msg.type !== "TAB_FAVICON_BADGE") return false;
  const { badge } = msg;
  if (badge == null) return msg.faviconDataUrl == null;
  return (
    typeof msg.faviconDataUrl === "string" &&
    (badge === "active" || badge === "deliverable" || badge === "handoff")
  );
}

function isNonNullObject(value) {
  return typeof value === "object" && value !== null;
}

/**
 * Ensure the shadow-DOM overlay is mounted in the document.
 */
function ensureOverlayMounted() {
  // Already mounted and connected — just observe parent
  if (rootElement?.isConnected === true && document.getElementById(ROOT_ELEMENT_ID) === rootElement) {
    const parent = rootElement.parentNode;
    if (parent != null) observeParentForRemoval(parent);
    return true;
  }

  // Clean up previous observer & state
  disconnectMutationObserver();
  cleanupFn?.();
  cleanupFn = null;
  rootElement = null;

  // Remove any stale root element
  const existingRoot = document.getElementById(ROOT_ELEMENT_ID);
  if (existingRoot != null) {
    if (existingRoot instanceof HTMLDivElement) {
      if (existingRoot.dataset[ROOT_CREATED_ATTR] === "true") {
        existingRoot.remove();
      } else {
        const parent = existingRoot.parentNode;
        if (parent != null) observeParentForRemoval(parent);
        return false;
      }
    } else {
      const parent = existingRoot.parentNode;
      if (parent != null) observeParentForRemoval(parent);
      return false;
    }
  }

  // Create new root element
  const html = document.documentElement;
  if (!html) {
    observeParentForRemoval(document);
    return false;
  }

  const root = document.createElement("div");
  root.id = ROOT_ELEMENT_ID;
  root.dataset[ROOT_CREATED_ATTR] = "true";
  html.appendChild(root);

  // Attach shadow DOM
  const shadow = root.attachShadow({ mode: "closed" });

  // Inject CSS
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);

  // Mount agent overlay
  const container = document.createElement("div");
  shadow.appendChild(container);
  cleanupFn = mountAgentOverlay(container);

  rootElement = root;
  observeParentForRemoval(html);
  return true;
}

/**
 * Watch a node (and its parent) for removal using MutationObserver.
 */
function observeParentForRemoval(node) {
  const targets = node.parentNode == null ? [node] : [node, node.parentNode];

  // Only re-observe if the target list changed
  if (
    targets.length === observedNodes.length &&
    targets.every((t, i) => t === observedNodes[i])
  ) {
    return;
  }

  if (mutationObserver == null) {
    mutationObserver = new MutationObserver(() => {
      if (rootElement?.isConnected === true) {
        const parent = rootElement.parentNode;
        if (parent != null) observeParentForRemoval(parent);
        return;
      }
      // Root was removed — re-mount
      ensureOverlayMounted();
    });
  } else if (observedNodes.length > 0) {
    mutationObserver.disconnect();
  }

  observedNodes = targets;
  for (const target of targets) {
    mutationObserver.observe(target, { childList: true });
  }
}

function disconnectMutationObserver() {
  mutationObserver?.disconnect();
  observedNodes = [];
}

// Identity function (used for config passthrough)
function identity(value) { return value; }

// ─────────────────────────────────────────────────────────────
//  9. WXT CONTENT SCRIPT DEFINITION
// ─────────────────────────────────────────────────────────────

const contentScriptDefinition = {
  cssInjectionMode: "manifest",
  matchAboutBlank: true,
  matches: ["<all_urls>"],
  registration: "runtime",
  runAt: "document_start",

  /**
   * Main function — called by the WXT content script lifecycle.
   */
  main() {
    startOverlay();
  },
};

// ─────────────────────────────────────────────────────────────
//  10. WXT CONTENT SCRIPT LIFECYCLE MANAGER
// ─────────────────────────────────────────────────────────────

// Logger (disabled in production)
const log = {
  debug: (...args) => { /* no-op */ },
  log:   (...args) => { /* no-op */ },
  warn:  (...args) => { /* no-op */ },
  error: (...args) => { /* no-op */ },
};

// Browser API reference (supports both chrome and browser namespaces)
const browserAPI = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

/**
 * Custom event fired on location change.
 */
class LocationChangeEvent extends Event {
  static EVENT_NAME = prefixEvent("wxt:locationchange");

  constructor(newUrl, oldUrl) {
    super(LocationChangeEvent.EVENT_NAME, {});
    this.newUrl = newUrl;
    this.oldUrl = oldUrl;
  }
}

function prefixEvent(name) {
  return `${browserAPI?.runtime?.id}:codex:${name}`;
}

// Check for Navigation API support
const hasNavigationAPI = typeof globalThis.navigation?.addEventListener === "function";

/**
 * Create a location change watcher.
 */
function createLocationWatcher(abortController) {
  let lastUrl;
  let started = false;

  return {
    run() {
      if (started) return;
      started = true;
      lastUrl = new URL(location.href);

      if (hasNavigationAPI) {
        globalThis.navigation.addEventListener(
          "navigate",
          (event) => {
            const newUrl = new URL(event.destination.url);
            if (newUrl.href !== lastUrl.href) {
              window.dispatchEvent(new LocationChangeEvent(newUrl, lastUrl));
              lastUrl = newUrl;
            }
          },
          { signal: abortController.signal }
        );
      } else {
        abortController.setInterval(() => {
          const newUrl = new URL(location.href);
          if (newUrl.href !== lastUrl.href) {
            window.dispatchEvent(new LocationChangeEvent(newUrl, lastUrl));
            lastUrl = newUrl;
          }
        }, 1000);
      }
    },
  };
}

/**
 * WXT ContentScript class — manages lifecycle, invalidation,
 * timers, and event listeners.
 */
class ContentScript {
  static SCRIPT_STARTED_MESSAGE_TYPE = prefixEvent("wxt:content-script-started");

  /** @param {string} name @param {object} options */
  constructor(name, options) {
    this.contentScriptName = name;
    this.options = options;
    this.id = Math.random().toString(36).slice(2);
    this.abortController = new AbortController();
    this.locationWatcher = createLocationWatcher(this);

    this.stopOldScripts();
    this.listenForNewerScripts();
  }

  get signal() {
    return this.abortController.signal;
  }

  abort(reason) {
    return this.abortController.abort(reason);
  }

  /** True if this script has been invalidated. */
  get isInvalid() {
    if (browserAPI.runtime?.id == null) {
      this.notifyInvalidated();
    }
    return this.signal.aborted;
  }

  get isValid() {
    return !this.isInvalid;
  }

  onInvalidated(callback) {
    const handler = callback;
    this.signal.addEventListener("abort", handler);
    return () => this.signal.removeEventListener("abort", handler);
  }

  /** Returns a promise that never resolves (keeps the script alive). */
  block() {
    return new Promise(() => {});
  }

  /** setInterval that auto-clears on invalidation. */
  setInterval(fn, ms) {
    const id = setInterval(() => { if (this.isValid) fn(); }, ms);
    this.onInvalidated(() => clearInterval(id));
    return id;
  }

  /** setTimeout that auto-clears on invalidation. */
  setTimeout(fn, ms) {
    const id = setTimeout(() => { if (this.isValid) fn(); }, ms);
    this.onInvalidated(() => clearTimeout(id));
    return id;
  }

  /** requestAnimationFrame that auto-cancels on invalidation. */
  requestAnimationFrame(fn) {
    const id = requestAnimationFrame((...args) => {
      if (this.isValid) fn(...args);
    });
    this.onInvalidated(() => cancelAnimationFrame(id));
    return id;
  }

  /** requestIdleCallback that auto-cancels on invalidation. */
  requestIdleCallback(fn, options) {
    const id = requestIdleCallback(
      (...args) => { if (!this.signal.aborted) fn(...args); },
      options
    );
    this.onInvalidated(() => cancelIdleCallback(id));
    return id;
  }

  /** addEventListener with automatic cleanup on invalidation. */
  addEventListener(target, event, handler, options) {
    if (event === "wxt:locationchange" && this.isValid) {
      this.locationWatcher.run();
    }
    target.addEventListener?.(
      handler.startsWith("wxt:") ? prefixEvent(handler) : handler,
      options,
      { ...options, signal: this.signal }
    );
  }

  /**
   * Notify that this content script context has been invalidated
   * (e.g., the extension was updated or reloaded).
   */
  notifyInvalidated() {
    this.abort("Content script context invalidated");
    log.debug(`Content script "${this.contentScriptName}" context invalidated`);
  }

  /**
   * Broadcast a message so older instances of this content script
   * know to terminate.
   */
  stopOldScripts() {
    document.dispatchEvent(
      new CustomEvent(ContentScript.SCRIPT_STARTED_MESSAGE_TYPE, {
        detail: { contentScriptName: this.contentScriptName, messageId: this.id },
      })
    );
    window.postMessage(
      {
        type: ContentScript.SCRIPT_STARTED_MESSAGE_TYPE,
        contentScriptName: this.contentScriptName,
        messageId: this.id,
      },
      "*"
    );
  }

  /**
   * Check if a "script started" event is from a NEWER instance
   * (same script name, different ID).
   */
  verifyScriptStartedEvent(event) {
    const sameName = event.detail?.contentScriptName === this.contentScriptName;
    const differentId = event.detail?.messageId !== this.id;
    return sameName && differentId;
  }

  /**
   * Listen for newer script instances and invalidate ourselves.
   */
  listenForNewerScripts() {
    const handler = (event) => {
      if (!(event instanceof CustomEvent)) return;
      if (!this.verifyScriptStartedEvent(event)) return;
      this.notifyInvalidated();
    };
    document.addEventListener(ContentScript.SCRIPT_STARTED_MESSAGE_TYPE, handler);
    this.onInvalidated(() => {
      document.removeEventListener(ContentScript.SCRIPT_STARTED_MESSAGE_TYPE, handler);
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  11. SCRIPT BOOTSTRAP
// ─────────────────────────────────────────────────────────────

// Immediately-invoked async bootstrap
const bootstrap = (async () => {
  try {
    const { main, ...options } = contentScriptDefinition;
    const ctx = new ContentScript("codex", options);
    await main(ctx);
  } catch (error) {
    log.error('The content script "codex" crashed on startup!', error);
    throw error;
  }
})();

// Export for external access
return bootstrap;
