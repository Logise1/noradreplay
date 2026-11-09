/* NORAD Tracks Santa replay — current clock time, mapped onto 24 December. */

const TAKEOFF_MS = Date.parse("2025-12-24T11:00:00Z");
const LANDING_MS = Date.parse("2025-12-25T10:15:15Z");
const FLIGHT_SECONDS = (LANDING_MS - TAKEOFF_MS) / 1000;
const TOTAL_PRESENTS = 8231970628;
const MODEL_URI = "Santa.gltf";

const state = {
  destinations: [],
  viewer: null,
  santa: null,
  position: new Cesium.Cartesian3(),
  orientation: Cesium.Quaternion.clone(Cesium.Quaternion.IDENTITY),
  heading: 0,
  mode3D: true,
  cameraRange: 14000,
  cameraYaw: Math.PI,
  cameraPitch: Cesium.Math.toRadians(-42),
  geodesic: null,
  legFrom: -1,
  legTo: -1,
};

function simulatedNow() {
  const now = new Date();
  const mapped = new Date(
    2025,
    11,
    24,
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  );
  return mapped.getTime();
}

function formatPlace(stop) {
  if (!stop) return "—";
  return stop.region ? `${stop.city}, ${stop.region}` : stop.city;
}

function formatRemaining(ms) {
  if (ms <= 0) return "now";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) {
    return `in ${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  return `in ${minutes} minute${minutes === 1 ? "" : "s"}, ${seconds} second${seconds === 1 ? "" : "s"}`;
}

function formatGifts(count) {
  return Math.max(0, Math.floor(count)).toLocaleString("en-US");
}

function presentsAt(timeMs) {
  if (timeMs <= TAKEOFF_MS) return 0;
  if (timeMs >= LANDING_MS) return TOTAL_PRESENTS;
  const t = (timeMs - TAKEOFF_MS) / 1000;
  return (t / FLIGHT_SECONDS) * TOTAL_PRESENTS;
}

function findLeg(destinations, timeMs) {
  if (timeMs <= destinations[0].arrival) {
    return { from: 0, to: 1, t: 0, status: timeMs < TAKEOFF_MS ? "preparing" : "flying" };
  }
  const last = destinations.length - 1;
  if (timeMs >= destinations[last].arrival) {
    return { from: last, to: last, t: 1, status: timeMs >= LANDING_MS ? "stopped" : "flying" };
  }
  for (let i = 0; i < last; i++) {
    const a = destinations[i].arrival;
    const b = destinations[i + 1].arrival;
    if (timeMs >= a && timeMs < b) {
      const t = b === a ? 1 : (timeMs - a) / (b - a);
      return { from: i, to: i + 1, t, status: "flying" };
    }
  }
  return { from: last, to: last, t: 1, status: "flying" };
}

function stopCartographic(stop, height) {
  return Cesium.Cartographic.fromDegrees(
    stop.location_coords.lng,
    stop.location_coords.lat,
    height || 0
  );
}

function cruiseHeight(distance) {
  return Cesium.Math.clamp(distance * 0.12, 18000, 160000);
}

function setLevelOrientation(heading) {
  if (!Number.isFinite(heading)) heading = state.heading || 0;
  state.heading = heading;
  if (Cesium.Cartesian3.magnitudeSquared(state.position) < 1) return;
  const hpr = new Cesium.HeadingPitchRoll(state.heading, 0, 0);
  Cesium.Transforms.headingPitchRollQuaternion(
    state.position,
    hpr,
    Cesium.Ellipsoid.WGS84,
    undefined,
    state.orientation
  );
}

function interpolatePose(destinations, timeMs) {
  const leg = findLeg(destinations, timeMs);
  const from = destinations[leg.from];
  const to = destinations[leg.to];

  if (leg.from === leg.to || !to) {
    const carto = stopCartographic(from, 25000);
    Cesium.Cartographic.toCartesian(carto, Cesium.Ellipsoid.WGS84, state.position);
    setLevelOrientation(state.heading);
    return { ...leg, last: from, next: from, remaining: Math.max(0, LANDING_MS - timeMs) };
  }

  const start = stopCartographic(from, 0);
  const end = stopCartographic(to, 0);
  if (state.legFrom !== leg.from || state.legTo !== leg.to) {
    state.geodesic = new Cesium.EllipsoidGeodesic(start, end);
    state.legFrom = leg.from;
    state.legTo = leg.to;
  }

  const distance = state.geodesic.surfaceDistance;
  const height = 22000 + Math.sin(Math.PI * leg.t) * cruiseHeight(distance);
  const along = state.geodesic.interpolateUsingFraction(leg.t);
  along.height = height;
  Cesium.Cartographic.toCartesian(along, Cesium.Ellipsoid.WGS84, state.position);

  let heading = state.geodesic.startHeading;
  try {
    const aheadFraction = Math.min(1, leg.t + 0.002);
    if (aheadFraction > leg.t) {
      const ahead = state.geodesic.interpolateUsingFraction(aheadFraction);
      heading = new Cesium.EllipsoidGeodesic(along, ahead).startHeading;
    }
  } catch (error) {
    heading = state.heading;
  }
  setLevelOrientation(heading);

  return {
    ...leg,
    last: from,
    next: to,
    remaining: Math.max(0, to.arrival - timeMs),
  };
}

function startSnow(canvas) {
  const ctx = canvas.getContext("2d");
  const flakes = Array.from({ length: 140 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.8 + 0.4,
    s: Math.random() * 0.55 + 0.15,
    drift: Math.random() * 6,
  }));

  function frame(time) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    for (const flake of flakes) {
      flake.y += flake.s * 0.0032;
      flake.x += Math.sin((time / 900 + flake.drift + flake.y * 8) ) * 0.00035;
      if (flake.y > 1) {
        flake.y = 0;
        flake.x = Math.random();
      }
      if (flake.x < 0) flake.x += 1;
      if (flake.x > 1) flake.x -= 1;
      ctx.beginPath();
      ctx.arc(flake.x * canvas.width, flake.y * canvas.height, flake.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function addImagery(viewer) {
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      credit: "Esri",
      maximumLevel: 18,
    })
  );
}

function updateHud(pose, timeMs) {
  const lastEl = document.getElementById("lastSpotted");
  const nextEl = document.getElementById("headedFor");
  const giftsEl = document.getElementById("giftsDelivered");
  const banner = document.getElementById("statusBanner");

  lastEl.textContent = formatPlace(pose.last);
  giftsEl.textContent = formatGifts(presentsAt(timeMs));

  if (pose.status === "preparing") {
    nextEl.textContent = "North Pole, Arctic";
    banner.textContent = "Current conditions at the North Pole indicate good weather for flying";
    banner.classList.remove("hidden");
  } else if (pose.status === "stopped") {
    nextEl.textContent = "Santa has returned to the North Pole";
    banner.textContent = "Santa has completed his deliveries";
    banner.classList.remove("hidden");
  } else {
    nextEl.textContent = `${formatPlace(pose.next)} ${formatRemaining(pose.remaining)}`;
    banner.classList.add("hidden");
  }
}

function updateCamera() {
  if (!state.viewer || !Cesium.defined(state.position)) return;
  if (state.mode3D) {
    state.viewer.camera.lookAt(
      state.position,
      new Cesium.HeadingPitchRange(state.cameraYaw, state.cameraPitch, state.cameraRange)
    );
    return;
  }
  state.viewer.camera.lookAt(
    state.position,
    new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), state.cameraRange * 12)
  );
}

function tick() {
  const timeMs = simulatedNow();
  const pose = interpolatePose(state.destinations, timeMs);
  updateHud(pose, timeMs);
  updateCamera();
}

async function createViewer() {
  const viewer = new Cesium.Viewer("cesiumContainer", {
    baseLayer: false,
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: true,
  });

  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.skyAtmosphere.brightnessShift = 0.05;
  viewer.scene.fog.enabled = true;
  viewer.scene.backgroundColor = Cesium.Color.BLACK;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 40;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 2.5e7;
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
    Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
  );

  addImagery(viewer);
  return viewer;
}

function addSanta(viewer) {
  return viewer.entities.add({
    id: "santa",
    position: new Cesium.CallbackProperty(() => state.position, false),
    orientation: new Cesium.CallbackProperty(() => state.orientation, false),
    model: {
      uri: MODEL_URI,
      scale: 80,
      runAnimations: true,
    },
  });
}

function bindUi(viewer) {
  const controller = viewer.scene.screenSpaceCameraController;
  controller.enableRotate = false;
  controller.enableTranslate = false;
  controller.enableZoom = false;
  controller.enableTilt = false;
  controller.enableLook = false;

  const MIN_RANGE = 2500;
  const MAX_RANGE = 2e7;
  const canvas = viewer.cesiumWidget.canvas;
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1.22 : 1 / 1.22;
      state.cameraRange = Cesium.Math.clamp(state.cameraRange * factor, MIN_RANGE, MAX_RANGE);
    },
    { passive: false }
  );

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerup", () => {
    dragging = false;
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    state.cameraYaw += dx * 0.005;
    state.cameraPitch = Cesium.Math.clamp(
      state.cameraPitch - dy * 0.004,
      Cesium.Math.toRadians(-89),
      Cesium.Math.toRadians(-6)
    );
  });
}

async function main() {
  startSnow(document.getElementById("snow"));
  const response = await fetch("route/destinations.json");
  state.destinations = await response.json();

  state.viewer = await createViewer();
  interpolatePose(state.destinations, simulatedNow());
  state.santa = addSanta(state.viewer);
  bindUi(state.viewer);

  state.viewer.clock.onTick.addEventListener(tick);
  tick();
  updateCamera();

  document.getElementById("loader").classList.add("hidden");
}

main().catch((error) => {
  const loader = document.getElementById("loader");
  loader.querySelector("h1").textContent = "Signal lost";
  loader.querySelector("p").textContent = String(error && error.message ? error.message : error);
});
