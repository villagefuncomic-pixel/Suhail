import * as THREE from 'three';
import { VEHICLE_MAP } from '../data/vehicles';
import { RimFinish, TuningConfig, VehicleId } from '../types/game';
import { ProceduralTextureSet } from './textures';

export interface VehicleRig {
  root: THREE.Group;
  chassisGroup: THREE.Group;
  bikeLeanPivot: THREE.Group;
  steerPivots: THREE.Group[];
  spinWheels: THREE.Group[];
  brakeMeshes: THREE.Mesh[];
  brakeMaterial: THREE.MeshStandardMaterial;
  exhaustFlames: THREE.Mesh[];
  underglowMesh: THREE.Mesh;
  underglowMat: THREE.MeshBasicMaterial;
  paintMaterial: THREE.MeshPhysicalMaterial;
  rimMaterial: THREE.MeshStandardMaterial;
  wingGroup?: THREE.Group;
  drsFlap?: THREE.Mesh;
  rainLightMat?: THREE.MeshStandardMaterial;
  f1SidewallMats?: THREE.MeshBasicMaterial[];
  isBike: boolean;
  isF1: boolean;
  wheelRadius: number;
  baseChassisY: number;
  applyTuning: (tuning: TuningConfig) => void;
  updateVisuals: (params: {
    speedKmh: number;
    steer: number;
    leanAngleRad: number;
    throttle: number;
    braking: boolean;
    nitroActive: boolean;
    drsActive?: boolean;
    pitchRad?: number;
    rollRad?: number;
    dt: number;
  }) => void;
  dispose: () => void;
}

const RIM_COLORS: Record<RimFinish, { color: number; metalness: number; roughness: number }> = {
  titanium: { color: 0xcbd5e1, metalness: 0.92, roughness: 0.22 },
  forged_gold: { color: 0xeab308, metalness: 0.9, roughness: 0.18 },
  gloss_black: { color: 0x111827, metalness: 0.78, roughness: 0.14 },
  bronze: { color: 0x92400e, metalness: 0.86, roughness: 0.26 },
};

function createWheelAssembly(
  radius: number,
  width: number,
  rimMat: THREE.Material,
  tireMat: THREE.Material,
  caliperMat: THREE.Material,
  options?: {
    isBikeWheel?: boolean;
    f1SidewallMat?: THREE.Material;
    turbineBlades?: boolean;
  },
): THREE.Group {
  const wheel = new THREE.Group();

  const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 32);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.castShadow = true;
  tire.receiveShadow = true;
  wheel.add(tire);

  // Colored F1 Pirelli sidewall ring discs
  if (options?.f1SidewallMat) {
    const ringGeo = new THREE.CircleGeometry(radius * 0.96, 28);
    [-1, 1].forEach((side) => {
      const cap = new THREE.Mesh(ringGeo, options.f1SidewallMat!);
      cap.position.x = side * (width / 2 + 0.004);
      cap.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      wheel.add(cap);
    });
  }

  const rimR = radius * 0.67;
  const rimGeo = new THREE.CylinderGeometry(rimR, rimR, width + 0.015, 24);
  rimGeo.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, rimMat);
  wheel.add(rim);

  const coreGeo = new THREE.CylinderGeometry(rimR * 0.84, rimR * 0.84, width + 0.02, 18);
  coreGeo.rotateZ(Math.PI / 2);
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.55, metalness: 0.45 });
  const core = new THREE.Mesh(coreGeo, coreMat);
  wheel.add(core);

  const spokeCount = options?.isBikeWheel ? 6 : options?.turbineBlades ? 10 : 5;
  const spokeGeo = new THREE.BoxGeometry(width + 0.032, rimR * 1.88, radius * (options?.turbineBlades ? 0.065 : 0.095));
  for (let i = 0; i < spokeCount; i++) {
    const spoke = new THREE.Mesh(spokeGeo, rimMat);
    spoke.rotation.x = (i / spokeCount) * Math.PI;
    wheel.add(spoke);
  }

  // Center-lock nut
  const nutGeo = new THREE.CylinderGeometry(radius * 0.14, radius * 0.14, width + 0.05, 12);
  nutGeo.rotateZ(Math.PI / 2);
  const nut = new THREE.Mesh(nutGeo, caliperMat);
  wheel.add(nut);

  const discGeo = new THREE.CylinderGeometry(rimR * 0.72, rimR * 0.72, 0.025, 22);
  discGeo.rotateZ(Math.PI / 2);
  const discMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.28 });
  const disc = new THREE.Mesh(discGeo, discMat);
  wheel.add(disc);

  const calGeo = new THREE.BoxGeometry(0.08, radius * 0.34, radius * 0.22);
  const cal = new THREE.Mesh(calGeo, caliperMat);
  cal.position.set(0, rimR * 0.42, -rimR * 0.35);
  wheel.add(cal);

  return wheel;
}

function createExtrudedProfile(
  points: [number, number][],
  width: number,
  bevelSize = 0.06,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize,
    bevelThickness: bevelSize,
  });
  geo.rotateY(Math.PI / 2);
  geo.translate(-width / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

function addSideMirrors(
  chassisGroup: THREE.Group,
  halfWidth: number,
  yPos: number,
  zPos: number,
  mat: THREE.Material,
) {
  const armGeo = new THREE.BoxGeometry(0.16, 0.04, 0.06);
  const capGeo = new THREE.BoxGeometry(0.18, 0.09, 0.14);
  [-1, 1].forEach((side) => {
    const arm = new THREE.Mesh(armGeo, mat);
    arm.position.set(side * (halfWidth + 0.04), yPos, zPos);
    chassisGroup.add(arm);

    const cap = new THREE.Mesh(capGeo, mat);
    cap.position.set(side * (halfWidth + 0.13), yPos + 0.03, zPos + 0.02);
    chassisGroup.add(cap);
  });
}

export function buildVehicleMesh(
  vehicleId: VehicleId,
  tuning: TuningConfig,
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): VehicleRig {
  const spec = VEHICLE_MAP[vehicleId];
  const isBike = spec.category === 'bike';
  const isF1 = spec.category === 'f1';

  const root = new THREE.Group();
  const bikeLeanPivot = new THREE.Group();
  const chassisGroup = new THREE.Group();
  bikeLeanPivot.add(chassisGroup);
  root.add(bikeLeanPivot);

  const paintMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tuning.paintColor),
    metalness: tuning.paintFinish === 'matte' ? 0.24 : 0.88,
    roughness: tuning.paintFinish === 'matte' ? 0.56 : 0.16,
    clearcoat: tuning.paintFinish === 'matte' ? 0.12 : 1.0,
    clearcoatRoughness: 0.07,
    envMapIntensity: 1.45,
  });

  const rimSpec = RIM_COLORS[tuning.rimFinish];
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: rimSpec.color,
    metalness: rimSpec.metalness,
    roughness: rimSpec.roughness,
  });

  const carbonMat = new THREE.MeshStandardMaterial({
    map: textures.carbon,
    roughness: 0.3,
    metalness: 0.42,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x16181d,
    roughness: isF1 ? 0.65 : 0.86,
    metalness: 0.05,
  });

  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: 0x0f1218,
    roughness: 0.48,
    metalness: 0.38,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.96,
    roughness: 0.12,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1220,
    metalness: 0.18,
    roughness: 0.05,
    clearcoat: 1.0,
    transmission: isSoftwareGl ? 0 : 0.42,
    transparent: true,
    opacity: isSoftwareGl ? 0.72 : 0.92,
    ior: 1.5,
  });

  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    emissive: 0xe0f2fe,
    emissiveIntensity: 2.5,
    roughness: 0.08,
  });

  const amberDrlsMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: 0xf59e0b,
    emissiveIntensity: 2.6,
    roughness: 0.1,
  });

  const brakeMaterial = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 1.2,
    roughness: 0.2,
  });

  const caliperMat = new THREE.MeshStandardMaterial({
    color: vehicleId === 'ferrari_f1' ? 0xdc2626 : 0xf59e0b,
    metalness: 0.55,
    roughness: 0.28,
  });

  const flameMat = new THREE.MeshBasicMaterial({
    color: vehicleId === 'suhailll' ? 0xf59e0b : 0x38bdf8,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const underglowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(tuning.underglowColor),
    transparent: true,
    opacity: tuning.underglow ? 0.42 : 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const shadowW = isBike ? 1.15 : spec.trackWidth + 0.7;
  const shadowL = isBike ? 2.45 : spec.wheelBase + 2.0;
  const contactGeo = new THREE.PlaneGeometry(shadowW, shadowL);
  contactGeo.rotateX(-Math.PI / 2);
  const contactMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadow,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const contactShadow = new THREE.Mesh(contactGeo, contactMat);
  contactShadow.position.y = 0.03;
  root.add(contactShadow);

  const underglowGeo = new THREE.PlaneGeometry(shadowW * 0.9, shadowL * 0.88);
  underglowGeo.rotateX(-Math.PI / 2);
  const underglowMesh = new THREE.Mesh(underglowGeo, underglowMat);
  underglowMesh.position.y = 0.04;
  underglowMesh.visible = tuning.underglow;
  root.add(underglowMesh);

  const steerPivots: THREE.Group[] = [];
  const spinWheels: THREE.Group[] = [];
  const brakeMeshes: THREE.Mesh[] = [];
  const exhaustFlames: THREE.Mesh[] = [];
  let wingGroup: THREE.Group | undefined;
  let drsFlap: THREE.Mesh | undefined;
  let rainLightMat: THREE.MeshStandardMaterial | undefined;
  const f1SidewallMats: THREE.MeshBasicMaterial[] = [];

  // ======================== 1. REAL FORMULA 1 OPEN-WHEEL RACE CARS ========================
  if (isF1) {
    const teamAccentHex =
      spec.f1Team === 'ferrari'
        ? 0xfacc15 // Ferrari yellow stripe
        : spec.f1Team === 'mercedes'
        ? 0x00d2be // Petronas cyan
        : spec.f1Team === 'redbull'
        ? 0xe11d48 // Red Bull crimson/yellow
        : 0xd97706; // Rolex gold

    const accentMat = new THREE.MeshStandardMaterial({
      color: teamAccentHex,
      metalness: 0.6,
      roughness: 0.25,
    });

    // Ground-effect carbon floor & Venturi bargeboards
    const floorGeo = new THREE.BoxGeometry(1.56, 0.05, 4.35);
    const floor = new THREE.Mesh(floorGeo, carbonMat);
    floor.position.set(0, 0.08, 0.05);
    floor.castShadow = true;
    chassisGroup.add(floor);

    // Sculpted Monocoque Survival Cell + Long Low Needle Nose Cone
    const monoProfile: [number, number][] = [
      [-2.18, 0.14], // Rear gearbox tail
      [-2.12, 0.62], // Engine cover exit
      [-0.75, 0.98], // Airbox / T-cam shoulder
      [0.05, 0.68], // Cockpit rim
      [0.95, 0.56], // Nose bridge
      [2.45, 0.22], // Low needle nose tip
      [2.38, 0.12],
      [-2.1, 0.12],
    ];
    const monoGeo = createExtrudedProfile(monoProfile, 0.54, 0.045);
    const monoMesh = new THREE.Mesh(monoGeo, paintMaterial);
    monoMesh.castShadow = true;
    chassisGroup.add(monoMesh);

    // Sculpted Undercut Sidepods (Left & Right)
    const sidepodProfile: [number, number][] = [
      [-1.72, 0.14],
      [-1.65, 0.34],
      [-0.5, 0.54],
      [0.42, 0.52],
      [0.52, 0.2],
      [-1.68, 0.14],
    ];
    const podGeo = createExtrudedProfile(sidepodProfile, 0.42, 0.05);
    [-1, 1].forEach((side) => {
      const pod = new THREE.Mesh(podGeo, paintMaterial);
      pod.position.set(side * 0.48, 0, 0);
      pod.castShadow = true;
      chassisGroup.add(pod);

      // Dark cooling inlet mouth
      const inlet = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.12), darkTrimMat);
      inlet.position.set(side * 0.48, 0.36, -0.5);
      chassisGroup.add(inlet);

      // Team livery sidepod stripe
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 1.85), accentMat);
      stripe.position.set(side * 0.72, 0.34, 0.45);
      chassisGroup.add(stripe);
    });

    // Shark-fin Engine Cover + Overhead Airbox Scoop + T-Cam
    const finGeo = new THREE.BoxGeometry(0.05, 0.36, 1.35);
    const fin = new THREE.Mesh(finGeo, paintMaterial);
    fin.position.set(0, 0.94, 1.15);
    chassisGroup.add(fin);

    const airbox = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.35), darkTrimMat);
    airbox.position.set(0, 0.95, 0.42);
    chassisGroup.add(airbox);

    const tcam = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.08), accentMat);
    tcam.position.set(0, 1.12, 0.48);
    chassisGroup.add(tcam);

    // Driver Helmet & Titanium HALO Safety Hoop
    const helmetMat = new THREE.MeshPhysicalMaterial({
      color: teamAccentHex,
      clearcoat: 1.0,
      roughness: 0.1,
      metalness: 0.3,
    });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), helmetMat);
    helmet.position.set(0, 0.68, 0.15);
    chassisGroup.add(helmet);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.16), glassMat);
    visor.position.set(0, 0.7, 0.04);
    chassisGroup.add(visor);

    // Halo arch (front central pillar + curved hoop)
    const haloPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.38, 10), carbonMat);
    haloPillar.position.set(0, 0.74, -0.32);
    haloPillar.rotation.x = 0.65;
    chassisGroup.add(haloPillar);

    const haloHoop = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.032, 10, 24, Math.PI * 1.15),
      carbonMat,
    );
    haloHoop.rotation.x = Math.PI / 2;
    haloHoop.rotation.z = -Math.PI * 0.075;
    haloHoop.position.set(0, 0.82, 0.05);
    chassisGroup.add(haloHoop);

    // Multi-Element Wide Front Wing + Endplates
    const frontWing = new THREE.Group();
    frontWing.position.set(0, 0.12, -2.42);
    const fwMain = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.04, 0.42), carbonMat);
    frontWing.add(fwMain);
    const fwFlap = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.035, 0.24), paintMaterial);
    fwFlap.position.set(0, 0.045, 0.08);
    fwFlap.rotation.x = 0.18;
    frontWing.add(fwFlap);
    const fwAccent = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.025, 0.12), accentMat);
    fwAccent.position.set(0, 0.07, 0.14);
    fwAccent.rotation.x = 0.24;
    frontWing.add(fwAccent);
    [-0.99, 0.99].forEach((ex) => {
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.54), paintMaterial);
      ep.position.set(ex, 0.08, 0.02);
      frontWing.add(ep);
    });
    chassisGroup.add(frontWing);

    // F1 Rear Wing with Animated DRS Flap
    wingGroup = new THREE.Group();
    wingGroup.position.set(0, 0.65, 2.16);
    const rwPylon = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.22), carbonMat);
    rwPylon.position.set(0, 0.1, 0);
    wingGroup.add(rwPylon);

    const rwMain = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.04, 0.26), carbonMat);
    rwMain.position.set(0, 0.28, 0);
    wingGroup.add(rwMain);

    drsFlap = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.035, 0.22), paintMaterial);
    drsFlap.position.set(0, 0.36, 0.08);
    drsFlap.rotation.x = -0.35; // Closed high-downforce angle
    wingGroup.add(drsFlap);

    [-0.58, 0.58].forEach((ex) => {
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.46, 0.42), accentMat);
      ep.position.set(ex, 0.22, 0.02);
      wingGroup!.add(ep);
    });
    chassisGroup.add(wingGroup);

    // Central F1 Rain Light (flashes under braking / ERS harvest)
    rainLightMat = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 2.0,
    });
    const rainLight = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.08), rainLightMat);
    rainLight.position.set(0, 0.28, 2.26);
    chassisGroup.add(rainLight);
    brakeMeshes.push(rainLight);

    // Central F1 Exhaust + Nitro/ERS Flame
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.2, 12).rotateX(Math.PI / 2),
      rimMaterial,
    );
    pipe.position.set(0, 0.4, 2.24);
    chassisGroup.add(pipe);

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.085, 0.65, 10).rotateX(Math.PI / 2),
      flameMat,
    );
    flame.position.set(0, 0.4, 2.62);
    flame.visible = false;
    chassisGroup.add(flame);
    exhaustFlames.push(flame);

    // Exposed Carbon-Fiber Wishbone Suspension Arms + 4 Wide Open-Wheel Slicks
    const halfWB = spec.wheelBase / 2;
    const halfTrack = spec.trackWidth / 2;
    const armGeo = new THREE.BoxGeometry(0.55, 0.03, 0.06);
    [-1, 1].forEach((sx) => {
      [-halfWB, halfWB].forEach((wz) => {
        const arm1 = new THREE.Mesh(armGeo, carbonMat);
        arm1.position.set(sx * 0.52, 0.34, wz - 0.12);
        arm1.rotation.y = sx * 0.18;
        chassisGroup.add(arm1);

        const arm2 = new THREE.Mesh(armGeo, carbonMat);
        arm2.position.set(sx * 0.52, 0.22, wz + 0.12);
        arm2.rotation.y = -sx * 0.18;
        chassisGroup.add(arm2);
      });
    });

    const tireTex =
      tuning.tireCompound === 'medium_f1'
        ? textures.f1TireMedium
        : tuning.tireCompound === 'hard_f1'
        ? textures.f1TireHard
        : textures.f1TireSoft;

    const wheelPositions: [number, number, boolean][] = [
      [-halfTrack, -halfWB, true],
      [halfTrack, -halfWB, true],
      [-halfTrack, halfWB, false],
      [halfTrack, halfWB, false],
    ];
    wheelPositions.forEach(([wx, wz, isFront]) => {
      const sideMat = new THREE.MeshBasicMaterial({ map: tireTex, transparent: false });
      f1SidewallMats.push(sideMat);

      const pivot = new THREE.Group();
      pivot.position.set(wx, spec.wheelRadius, wz);
      const wheel = createWheelAssembly(
        spec.wheelRadius,
        isFront ? 0.36 : 0.44,
        rimMaterial,
        tireMat,
        caliperMat,
        { f1SidewallMat: sideMat },
      );
      pivot.add(wheel);
      root.add(pivot);
      spinWheels.push(wheel);
      if (isFront) steerPivots.push(pivot);
    });
  }

  // ======================== 2. FLAGSHIP HYPERCAR: SUHAILLL ========================
  else if (vehicleId === 'suhailll') {
    const bodyWidth = spec.trackWidth - 0.1;

    // Ultra-sculpted hypercar wedge profile
    const profile: [number, number][] = [
      [-2.24, 0.2],
      [-2.3, 0.66],
      [-1.4, 0.78],
      [-0.48, 1.02], // Teardrop canopy crest
      [0.54, 0.72],
      [1.62, 0.43],
      [2.3, 0.2],
      [2.22, 0.08],
      [-2.14, 0.08],
    ];
    const bodyGeo = createExtrudedProfile(profile, bodyWidth, 0.095);
    const bodyMesh = new THREE.Mesh(bodyGeo, paintMaterial);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    chassisGroup.add(bodyMesh);

    // Sculpted wide-body rear haunches + front wheel arch swells
    [-1, 1].forEach((side) => {
      const haunch = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.38, 4.25), paintMaterial);
      haunch.position.set(side * (bodyWidth * 0.46), 0.38, 0.02);
      haunch.castShadow = true;
      chassisGroup.add(haunch);

      const aeroBlade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 1.2), carbonMat);
      aeroBlade.position.set(side * (bodyWidth * 0.54), 0.42, 0.35);
      chassisGroup.add(aeroBlade);
    });

    // Teardrop panoramic glass canopy + exposed carbon roof spine
    const canopyProfile: [number, number][] = [
      [-1.18, 0.76],
      [-0.42, 1.05],
      [0.5, 0.74],
      [0.12, 0.68],
      [-0.95, 0.68],
    ];
    const canopy = new THREE.Mesh(createExtrudedProfile(canopyProfile, bodyWidth * 0.68, 0.04), glassMat);
    chassisGroup.add(canopy);

    // Glowing W16 Spine Core visible through engine louver deck
    const engineCore = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.95), amberDrlsMat);
    engineCore.position.set(0, 0.79, 1.32);
    chassisGroup.add(engineCore);

    // Carbon Splitter, Side Skirts & Aggressive Venturi Diffuser
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth + 0.22, 0.06, 0.72), carbonMat);
    splitter.position.set(0, 0.1, -2.1);
    chassisGroup.add(splitter);

    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.94, 0.2, 0.48), carbonMat);
    diffuser.position.set(0, 0.17, 2.12);
    chassisGroup.add(diffuser);

    // Active Split Aero Rear Wing
    wingGroup = new THREE.Group();
    wingGroup.position.set(0, 0.78, 1.98);
    [-0.46, 0.46].forEach((px) => {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.36, 0.24), carbonMat);
      pylon.position.set(px, 0.17, 0);
      wingGroup!.add(pylon);
    });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth + 0.28, 0.05, 0.36), carbonMat);
    blade.position.set(0, 0.36, 0.06);
    wingGroup.add(blade);
    drsFlap = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth + 0.12, 0.03, 0.18), paintMaterial);
    drsFlap.position.set(0, 0.42, 0.16);
    wingGroup.add(drsFlap);
    chassisGroup.add(wingGroup);

    // Signature Amber-Gold Blade DRLs + Full-Width Hypercar Rear Light Bar
    [-0.68, 0.68].forEach((hx) => {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.055, 0.16), amberDrlsMat);
      hl.position.set(hx, 0.35, -2.22);
      hl.rotation.y = hx < 0 ? 0.22 : -0.22;
      chassisGroup.add(hl);
    });

    const tl = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.92, 0.075, 0.09), brakeMaterial);
    tl.position.set(0, 0.58, 2.27);
    chassisGroup.add(tl);
    brakeMeshes.push(tl);

    addSideMirrors(chassisGroup, bodyWidth * 0.5, 0.64, -0.45, carbonMat);

    // Quad Titanium Exhausts + Gold/Amber Afterburner Cones
    const exGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.2, 12).rotateX(Math.PI / 2);
    const flameGeo = new THREE.ConeGeometry(0.085, 0.72, 10).rotateX(Math.PI / 2);
    [-0.32, -0.12, 0.12, 0.32].forEach((ex) => {
      const pipe = new THREE.Mesh(exGeo, rimMaterial);
      pipe.position.set(ex, 0.3, 2.28);
      chassisGroup.add(pipe);

      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(ex, 0.3, 2.68);
      flame.visible = false;
      chassisGroup.add(flame);
      exhaustFlames.push(flame);
    });

    const halfWB = spec.wheelBase / 2;
    const halfTrack = spec.trackWidth / 2;
    const wheelPositions: [number, number, boolean][] = [
      [-halfTrack, -halfWB, true],
      [halfTrack, -halfWB, true],
      [-halfTrack, halfWB, false],
      [halfTrack, halfWB, false],
    ];
    wheelPositions.forEach(([wx, wz, isFront]) => {
      const pivot = new THREE.Group();
      pivot.position.set(wx, spec.wheelRadius, wz);
      const wheel = createWheelAssembly(
        spec.wheelRadius,
        isFront ? 0.3 : 0.36,
        rimMaterial,
        tireMat,
        caliperMat,
        { turbineBlades: true },
      );
      pivot.add(wheel);
      root.add(pivot);
      spinWheels.push(wheel);
      if (isFront) steerPivots.push(pivot);
    });
  }

  // ======================== 3. REAL BMW M4 COMPETITION (G82) ========================
  else if (vehicleId === 'bmw_m4') {
    const bodyWidth = spec.trackWidth - 0.12;

    const bmwProfile: [number, number][] = [
      [-2.18, 0.22], // Rear bumper
      [-2.22, 0.84], // Trunk deck
      [-1.45, 0.92], // Rear glass base
      [-0.45, 1.32], // Coupe roofline
      [0.35, 1.26], // Windshield top
      [0.95, 0.88], // Hood cowl
      [2.12, 0.72], // Muscular hood nose
      [2.24, 0.32], // Front bumper lip
      [2.12, 0.14],
      [-2.08, 0.14],
    ];
    const bodyMesh = new THREE.Mesh(createExtrudedProfile(bmwProfile, bodyWidth, 0.08), paintMaterial);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    chassisGroup.add(bodyMesh);

    // Flared M4 Rear & Front Arches
    [-1, 1].forEach((side) => {
      const flare = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 4.18), paintMaterial);
      flare.position.set(side * (bodyWidth * 0.46), 0.44, 0);
      chassisGroup.add(flare);
    });

    // Tinted Coupe Greenhouse + Carbon Fiber Roof Panel
    const cabinGlass = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.82, 0.38, 1.95), glassMat);
    cabinGlass.position.set(0, 1.08, 0.15);
    chassisGroup.add(cabinGlass);

    const carbonRoof = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.78, 0.05, 1.15), carbonMat);
    carbonRoof.position.set(0, 1.35, 0.1);
    chassisGroup.add(carbonRoof);

    // Signature BMW Twin-Kidney Vertical Grille
    [-0.17, 0.17].forEach((kx) => {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.42, 0.08), darkTrimMat);
      frame.position.set(kx, 0.44, -2.28);
      chassisGroup.add(frame);

      for (let slat = -2; slat <= 2; slat++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 0.1), chromeMat);
        bar.position.set(kx, 0.44 + slat * 0.07, -2.29);
        chassisGroup.add(bar);
      }
    });

    // Sharp Dual-L BMW Angel Eye Headlights
    [-0.64, 0.64].forEach((hx) => {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.12), headlightMat);
      hl.position.set(hx, 0.62, -2.22);
      hl.rotation.y = hx < 0 ? 0.15 : -0.15;
      chassisGroup.add(hl);
    });

    // L-Shaped BMW Rear Taillights + Carbon Trunk Lip
    [-0.66, 0.66].forEach((tx) => {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.09, 0.1), brakeMaterial);
      tl.position.set(tx, 0.74, 2.24);
      chassisGroup.add(tl);
      brakeMeshes.push(tl);
    });

    const lipSpoiler = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.84, 0.06, 0.16), carbonMat);
    lipSpoiler.position.set(0, 0.9, 2.15);
    chassisGroup.add(lipSpoiler);

    addSideMirrors(chassisGroup, bodyWidth * 0.5, 0.88, -0.45, carbonMat);

    // Quad M Exhausts + Nitro Flames
    const exGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.18, 12).rotateX(Math.PI / 2);
    const flameGeo = new THREE.ConeGeometry(0.065, 0.55, 10).rotateX(Math.PI / 2);
    [-0.58, -0.42, 0.42, 0.58].forEach((ex) => {
      const pipe = new THREE.Mesh(exGeo, rimMaterial);
      pipe.position.set(ex, 0.24, 2.24);
      chassisGroup.add(pipe);

      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(ex, 0.24, 2.55);
      flame.visible = false;
      chassisGroup.add(flame);
      exhaustFlames.push(flame);
    });

    const halfWB = spec.wheelBase / 2;
    const halfTrack = spec.trackWidth / 2;
    const wheelPositions: [number, number, boolean][] = [
      [-halfTrack, -halfWB, true],
      [halfTrack, -halfWB, true],
      [-halfTrack, halfWB, false],
      [halfTrack, halfWB, false],
    ];
    wheelPositions.forEach(([wx, wz, isFront]) => {
      const pivot = new THREE.Group();
      pivot.position.set(wx, spec.wheelRadius, wz);
      const wheel = createWheelAssembly(spec.wheelRadius, 0.29, rimMaterial, tireMat, caliperMat);
      pivot.add(wheel);
      root.add(pivot);
      spinWheels.push(wheel);
      if (isFront) steerPivots.push(pivot);
    });
  }

  // ======================== 4. REAL PORSCHE 911 GT3 RS (992) ========================
  else if (vehicleId === 'porsche_911_gt3rs') {
    const bodyWidth = spec.trackWidth - 0.12;

    // Iconic 911 Sloping Fastback Silhouette
    const porscheProfile: [number, number][] = [
      [-2.08, 0.2], // Rear diffuser
      [-2.14, 0.74], // Rear deck
      [-1.05, 0.94], // Sloping fastback glass
      [-0.18, 1.24], // Teardrop roof crest
      [0.65, 0.88], // Windshield base
      [1.68, 0.56], // Low sloping hood
      [2.14, 0.34], // Front bumper
      [2.08, 0.12],
      [-1.98, 0.12],
    ];
    const bodyMesh = new THREE.Mesh(createExtrudedProfile(porscheProfile, bodyWidth, 0.09), paintMaterial);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    chassisGroup.add(bodyMesh);

    // Classic 911 Frog-Eye Raised Front Fenders + Wide Rear Hip Haunches
    [-1, 1].forEach((side) => {
      const frontFender = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 1.35), paintMaterial);
      frontFender.position.set(side * (bodyWidth * 0.44), 0.48, -1.35);
      chassisGroup.add(frontFender);

      const rearHaunch = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.44, 1.65), paintMaterial);
      rearHaunch.position.set(side * (bodyWidth * 0.46), 0.48, 1.15);
      chassisGroup.add(rearHaunch);

      // GT3 RS Side Air Intake
      const sideScoop = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.55), carbonMat);
      sideScoop.position.set(side * (bodyWidth * 0.52), 0.48, 0.65);
      chassisGroup.add(sideScoop);
    });

    // Tinted 911 Greenhouse
    const cabinProfile: [number, number][] = [
      [-1.18, 0.86],
      [-0.22, 1.25],
      [0.62, 0.86],
      [0.2, 0.78],
      [-0.95, 0.78],
    ];
    const cabin = new THREE.Mesh(createExtrudedProfile(cabinProfile, bodyWidth * 0.7, 0.04), glassMat);
    chassisGroup.add(cabin);

    // Carbon Front Splitter & Hood Aero Vents
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth + 0.18, 0.05, 0.55), carbonMat);
    splitter.position.set(0, 0.13, -1.96);
    chassisGroup.add(splitter);

    const hoodVent = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.04, 0.45), carbonMat);
    hoodVent.position.set(0, 0.64, -1.35);
    hoodVent.rotation.x = 0.25;
    chassisGroup.add(hoodVent);

    // Signature Round/Oval Porsche PDLS Headlamps
    const pdlsGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.08, 18);
    pdlsGeo.rotateX(Math.PI / 2 - 0.35);
    [-0.64, 0.64].forEach((hx) => {
      const hl = new THREE.Mesh(pdlsGeo, headlightMat);
      hl.position.set(hx, 0.58, -1.92);
      chassisGroup.add(hl);
    });

    // Massive Swan-Neck GT3 RS Rear Wing
    wingGroup = new THREE.Group();
    wingGroup.position.set(0, 0.82, 1.88);
    [-0.45, 0.45].forEach((px) => {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.48, 0.22), carbonMat);
      pylon.position.set(px, 0.22, 0);
      wingGroup!.add(pylon);
    });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth + 0.24, 0.055, 0.38), carbonMat);
    blade.position.set(0, 0.46, 0.06);
    wingGroup.add(blade);
    drsFlap = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth + 0.14, 0.03, 0.16), paintMaterial);
    drsFlap.position.set(0, 0.52, 0.16);
    wingGroup.add(drsFlap);
    chassisGroup.add(wingGroup);

    // Signature Full-Width Porsche Rear Light Bar
    const tl = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.9, 0.06, 0.08), brakeMaterial);
    tl.position.set(0, 0.66, 2.16);
    chassisGroup.add(tl);
    brakeMeshes.push(tl);

    addSideMirrors(chassisGroup, bodyWidth * 0.48, 0.78, -0.35, carbonMat);

    // Center-Exit Twin GT3 Exhausts
    const exGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.18, 12).rotateX(Math.PI / 2);
    const flameGeo = new THREE.ConeGeometry(0.075, 0.58, 10).rotateX(Math.PI / 2);
    [-0.1, 0.1].forEach((ex) => {
      const pipe = new THREE.Mesh(exGeo, rimMaterial);
      pipe.position.set(ex, 0.24, 2.16);
      chassisGroup.add(pipe);

      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(ex, 0.24, 2.48);
      flame.visible = false;
      chassisGroup.add(flame);
      exhaustFlames.push(flame);
    });

    const halfWB = spec.wheelBase / 2;
    const halfTrack = spec.trackWidth / 2;
    const wheelPositions: [number, number, boolean][] = [
      [-halfTrack, -halfWB, true],
      [halfTrack, -halfWB, true],
      [-halfTrack, halfWB, false],
      [halfTrack, halfWB, false],
    ];
    wheelPositions.forEach(([wx, wz, isFront]) => {
      const pivot = new THREE.Group();
      pivot.position.set(wx, spec.wheelRadius, wz);
      const wheel = createWheelAssembly(
        spec.wheelRadius,
        isFront ? 0.28 : 0.34,
        rimMaterial,
        tireMat,
        caliperMat,
        { turbineBlades: true },
      );
      pivot.add(wheel);
      root.add(pivot);
      spinWheels.push(wheel);
      if (isFront) steerPivots.push(pivot);
    });
  }

  // ======================== 5. OTHER SUPERCARS ========================
  else if (spec.category === 'supercar') {
    const isValkyrie = vehicleId === 'valkyrie_rgt';
    const bodyWidth = spec.trackWidth - 0.14;

    const profile: [number, number][] = isValkyrie
      ? [
          [-2.18, 0.18],
          [-2.24, 0.62],
          [-1.35, 0.74],
          [-0.45, 0.98],
          [0.52, 0.72],
          [1.55, 0.44],
          [2.24, 0.22],
          [2.18, 0.09],
          [-2.05, 0.09],
        ]
      : [
          [-2.1, 0.18],
          [-2.15, 0.66],
          [-1.15, 0.78],
          [-0.25, 1.04],
          [0.62, 0.75],
          [1.65, 0.48],
          [2.16, 0.24],
          [2.1, 0.1],
          [-1.98, 0.1],
        ];

    const bodyMesh = new THREE.Mesh(createExtrudedProfile(profile, bodyWidth, 0.09), paintMaterial);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    chassisGroup.add(bodyMesh);

    const fenderGeo = new THREE.BoxGeometry(0.28, 0.34, 4.15);
    [-1, 1].forEach((side) => {
      const fender = new THREE.Mesh(fenderGeo, paintMaterial);
      fender.position.set(side * (bodyWidth * 0.46), 0.38, 0.02);
      fender.castShadow = true;
      chassisGroup.add(fender);

      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, 0.95), carbonMat);
      intake.position.set(side * (bodyWidth * 0.52), 0.42, 0.42);
      chassisGroup.add(intake);
    });

    const canopyProfile: [number, number][] = [
      [-1.08, 0.74],
      [-0.38, 1.02],
      [0.48, 0.75],
      [0.15, 0.68],
      [-0.9, 0.68],
    ];
    const canopy = new THREE.Mesh(createExtrudedProfile(canopyProfile, bodyWidth * 0.68, 0.04), glassMat);
    chassisGroup.add(canopy);

    const splitter = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth + 0.16, 0.06, 0.65), carbonMat);
    splitter.position.set(0, 0.12, -2.02);
    chassisGroup.add(splitter);

    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.92, 0.18, 0.45), carbonMat);
    diffuser.position.set(0, 0.18, 2.04);
    chassisGroup.add(diffuser);

    wingGroup = new THREE.Group();
    wingGroup.position.set(0, 0.76, 1.88);
    [-0.42, 0.42].forEach((px) => {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.22), carbonMat);
      pylon.position.set(px, 0.16, 0);
      wingGroup!.add(pylon);
    });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth + 0.22, 0.05, 0.34), carbonMat);
    blade.position.set(0, 0.34, 0.05);
    blade.castShadow = true;
    wingGroup.add(blade);
    chassisGroup.add(wingGroup);

    [-0.66, 0.66].forEach((hx) => {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.14), headlightMat);
      hl.position.set(hx, 0.36, -2.14);
      hl.rotation.y = hx < 0 ? 0.18 : -0.18;
      chassisGroup.add(hl);
    });

    const tl = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.86, 0.07, 0.08), brakeMaterial);
    tl.position.set(0, 0.56, 2.2);
    chassisGroup.add(tl);
    brakeMeshes.push(tl);

    addSideMirrors(chassisGroup, bodyWidth * 0.48, 0.64, -0.45, carbonMat);

    const exGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.18, 12).rotateX(Math.PI / 2);
    const flameGeo = new THREE.ConeGeometry(0.075, 0.62, 10).rotateX(Math.PI / 2);
    [-0.28, -0.11, 0.11, 0.28].forEach((ex) => {
      const pipe = new THREE.Mesh(exGeo, rimMaterial);
      pipe.position.set(ex, 0.28, 2.22);
      chassisGroup.add(pipe);

      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(ex, 0.28, 2.58);
      flame.visible = false;
      chassisGroup.add(flame);
      exhaustFlames.push(flame);
    });

    const halfWB = spec.wheelBase / 2;
    const halfTrack = spec.trackWidth / 2;
    const wheelPositions: [number, number, boolean][] = [
      [-halfTrack, -halfWB, true],
      [halfTrack, -halfWB, true],
      [-halfTrack, halfWB, false],
      [halfTrack, halfWB, false],
    ];
    wheelPositions.forEach(([wx, wz, isFront]) => {
      const pivot = new THREE.Group();
      pivot.position.set(wx, spec.wheelRadius, wz);
      const wheel = createWheelAssembly(
        spec.wheelRadius,
        isFront ? 0.29 : 0.34,
        rimMaterial,
        tireMat,
        caliperMat,
      );
      pivot.add(wheel);
      root.add(pivot);
      spinWheels.push(wheel);
      if (isFront) steerPivots.push(pivot);
    });
  }

  // ======================== 6. XUVs ========================
  else if (spec.category === 'xuv') {
    const isDakar = vehicleId === 'atlas_dakar';
    const bodyWidth = spec.trackWidth - 0.18;

    const xuvProfile: [number, number][] = [
      [-2.18, 0.24],
      [-2.24, 1.02],
      [-1.78, 1.48],
      [0.25, 1.52],
      [0.98, 1.04],
      [2.05, 0.96],
      [2.26, 0.56],
      [2.16, 0.22],
      [-2.05, 0.22],
    ];
    const bodyMesh = new THREE.Mesh(createExtrudedProfile(xuvProfile, bodyWidth, 0.08), paintMaterial);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    chassisGroup.add(bodyMesh);

    const flareGeo = new THREE.BoxGeometry(0.16, 0.38, 1.12);
    [-1, 1].forEach((s) => {
      [-spec.wheelBase / 2, spec.wheelBase / 2].forEach((wz) => {
        const flare = new THREE.Mesh(flareGeo, darkTrimMat);
        flare.position.set(s * (bodyWidth * 0.5 + 0.04), 0.42, wz);
        chassisGroup.add(flare);
      });
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 1.9), darkTrimMat);
      step.position.set(s * (bodyWidth * 0.53), 0.22, 0);
      chassisGroup.add(step);
    });

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.88, 0.44, 2.35), glassMat);
    cabin.position.set(0, 1.24, -0.35);
    chassisGroup.add(cabin);

    const grille = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.72, 0.34, 0.14), darkTrimMat);
    grille.position.set(0, 0.68, -2.24);
    chassisGroup.add(grille);

    const skid = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.68, 0.12, 0.42), rimMaterial);
    skid.position.set(0, 0.24, -2.14);
    chassisGroup.add(skid);

    const rack = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.78, 0.09, 1.85), darkTrimMat);
    rack.position.set(0, 1.62, -0.38);
    chassisGroup.add(rack);

    const ledBar = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.72, 0.08, 0.12), headlightMat);
    ledBar.position.set(0, 1.64, -1.28);
    chassisGroup.add(ledBar);

    addSideMirrors(chassisGroup, bodyWidth * 0.5, 1.04, -0.82, darkTrimMat);

    if (isDakar) {
      const spare = createWheelAssembly(0.42, 0.28, rimMaterial, tireMat, caliperMat);
      spare.rotation.y = Math.PI / 2;
      spare.position.set(0, 0.92, 2.34);
      chassisGroup.add(spare);
    } else {
      const roofSpoiler = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.82, 0.06, 0.28), carbonMat);
      roofSpoiler.position.set(0, 1.54, 1.88);
      chassisGroup.add(roofSpoiler);
    }

    [-0.72, 0.72].forEach((hx) => {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.12), headlightMat);
      hl.position.set(hx, 0.8, -2.26);
      chassisGroup.add(hl);
    });
    [-0.7, 0.7].forEach((tx) => {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.1), brakeMaterial);
      tl.position.set(tx, 0.86, 2.26);
      chassisGroup.add(tl);
      brakeMeshes.push(tl);
    });

    const flameGeo = new THREE.ConeGeometry(0.09, 0.7, 10).rotateX(Math.PI / 2);
    [-0.58, 0.58].forEach((ex) => {
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.2, 12).rotateX(Math.PI / 2),
        rimMaterial,
      );
      pipe.position.set(ex, 0.28, 2.26);
      chassisGroup.add(pipe);

      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(ex, 0.28, 2.66);
      flame.visible = false;
      chassisGroup.add(flame);
      exhaustFlames.push(flame);
    });

    const halfWB = spec.wheelBase / 2;
    const halfTrack = spec.trackWidth / 2;
    const wheelPositions: [number, number, boolean][] = [
      [-halfTrack, -halfWB, true],
      [halfTrack, -halfWB, true],
      [-halfTrack, halfWB, false],
      [halfTrack, halfWB, false],
    ];
    wheelPositions.forEach(([wx, wz, isFront]) => {
      const pivot = new THREE.Group();
      pivot.position.set(wx, spec.wheelRadius, wz);
      const wheel = createWheelAssembly(spec.wheelRadius, 0.34, rimMaterial, tireMat, caliperMat);
      pivot.add(wheel);
      root.add(pivot);
      spinWheels.push(wheel);
      if (isFront) steerPivots.push(pivot);
    });
  }

  // ======================== 7. SUPERBIKES ========================
  else {
    const isDucati = vehicleId === 'ducati_v4_corsa';

    const fairingProfile: [number, number][] = [
      [-0.95, 0.76],
      [-0.45, 0.62],
      [-0.1, 0.72],
      [0.36, 0.88],
      [0.72, 0.78],
      [1.02, 0.58],
      [0.62, 0.28],
      [-0.42, 0.24],
    ];
    const bodyMesh = new THREE.Mesh(createExtrudedProfile(fairingProfile, 0.36, 0.05), paintMaterial);
    bodyMesh.castShadow = true;
    chassisGroup.add(bodyMesh);

    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.36, 0.68), darkTrimMat);
    engine.position.set(0, 0.42, 0.05);
    chassisGroup.add(engine);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.48), tireMat);
    seat.position.set(0, 0.7, 0.42);
    chassisGroup.add(seat);

    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.34), glassMat);
    screen.position.set(0, 0.92, -0.58);
    screen.rotation.x = 0.68;
    chassisGroup.add(screen);

    const winglet = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.03, 0.16), carbonMat);
    winglet.position.set(0, 0.68, -0.78);
    chassisGroup.add(winglet);

    const swing = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, 0.64), rimMaterial);
    swing.position.set(0, 0.34, 0.46);
    chassisGroup.add(swing);

    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.045, 0.52, 12).rotateX(Math.PI / 2 - 0.22),
      rimMaterial,
    );
    pipe.position.set(0.2, 0.36, 0.56);
    chassisGroup.add(pipe);

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.5, 10).rotateX(Math.PI / 2),
      flameMat,
    );
    flame.position.set(0.2, 0.43, 0.98);
    flame.visible = false;
    chassisGroup.add(flame);
    exhaustFlames.push(flame);

    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.08), headlightMat);
    hl.position.set(0, 0.65, -0.96);
    chassisGroup.add(hl);

    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.08), brakeMaterial);
    tl.position.set(0, 0.78, 0.96);
    chassisGroup.add(tl);
    brakeMeshes.push(tl);

    const frontSteerPivot = new THREE.Group();
    frontSteerPivot.position.set(0, 0, -spec.wheelBase / 2);

    const forkMat = isDucati
      ? new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9, roughness: 0.2 })
      : darkTrimMat;
    const forkGeo = new THREE.CylinderGeometry(0.028, 0.024, 0.64, 10);
    [-0.11, 0.11].forEach((fx) => {
      const fork = new THREE.Mesh(forkGeo, forkMat);
      fork.position.set(fx, 0.54, 0.09);
      fork.rotation.x = 0.36;
      frontSteerPivot.add(fork);
    });

    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.64, 8).rotateZ(Math.PI / 2),
      darkTrimMat,
    );
    bar.position.set(0, 0.84, 0.16);
    frontSteerPivot.add(bar);

    const frontWheel = createWheelAssembly(spec.wheelRadius, 0.14, rimMaterial, tireMat, caliperMat, {
      isBikeWheel: true,
    });
    frontWheel.position.set(0, spec.wheelRadius, 0);
    frontSteerPivot.add(frontWheel);
    bikeLeanPivot.add(frontSteerPivot);
    steerPivots.push(frontSteerPivot);
    spinWheels.push(frontWheel);

    const rearWheel = createWheelAssembly(spec.wheelRadius, 0.2, rimMaterial, tireMat, caliperMat, {
      isBikeWheel: true,
    });
    rearWheel.position.set(0, spec.wheelRadius, spec.wheelBase / 2);
    bikeLeanPivot.add(rearWheel);
    spinWheels.push(rearWheel);
  }

  const baseChassisY = chassisGroup.position.y;

  return {
    root,
    chassisGroup,
    bikeLeanPivot,
    steerPivots,
    spinWheels,
    brakeMeshes,
    brakeMaterial,
    exhaustFlames,
    underglowMesh,
    underglowMat,
    paintMaterial,
    rimMaterial,
    wingGroup,
    drsFlap,
    rainLightMat,
    f1SidewallMats,
    isBike,
    isF1,
    wheelRadius: spec.wheelRadius,
    baseChassisY,
    applyTuning: (nextTuning: TuningConfig) => {
      paintMaterial.color.set(nextTuning.paintColor);
      if (nextTuning.paintFinish === 'matte') {
        paintMaterial.metalness = 0.22;
        paintMaterial.roughness = 0.56;
        paintMaterial.clearcoat = 0.1;
      } else if (nextTuning.paintFinish === 'pearl') {
        paintMaterial.metalness = 0.65;
        paintMaterial.roughness = 0.14;
        paintMaterial.clearcoat = 1.0;
      } else {
        paintMaterial.metalness = 0.88;
        paintMaterial.roughness = 0.16;
        paintMaterial.clearcoat = 1.0;
      }

      const nextRim = RIM_COLORS[nextTuning.rimFinish];
      rimMaterial.color.setHex(nextRim.color);
      rimMaterial.metalness = nextRim.metalness;
      rimMaterial.roughness = nextRim.roughness;

      underglowMesh.visible = nextTuning.underglow;
      underglowMat.color.set(nextTuning.underglowColor);
      underglowMat.opacity = nextTuning.underglow ? 0.42 : 0;

      chassisGroup.position.y = baseChassisY + nextTuning.suspensionHeight * 0.008;

      if (wingGroup && !isF1) {
        wingGroup.rotation.x = -(nextTuning.aeroDownforce / 100) * 0.22;
      }

      if (isF1 && f1SidewallMats.length > 0) {
        const nextTex =
          nextTuning.tireCompound === 'medium_f1'
            ? textures.f1TireMedium
            : nextTuning.tireCompound === 'hard_f1'
            ? textures.f1TireHard
            : textures.f1TireSoft;
        f1SidewallMats.forEach((m) => {
          m.map = nextTex;
          m.needsUpdate = true;
        });
      }
    },
    updateVisuals: ({
      speedKmh,
      steer,
      leanAngleRad,
      braking,
      nitroActive,
      drsActive = false,
      pitchRad = 0,
      rollRad = 0,
      dt,
    }) => {
      const speedMs = speedKmh / 3.6;
      const spinDelta = (speedMs / spec.wheelRadius) * dt;

      for (let i = 0; i < spinWheels.length; i++) {
        spinWheels[i].rotation.x -= spinDelta;
      }
      for (let i = 0; i < steerPivots.length; i++) {
        steerPivots[i].rotation.y = steer * 0.42;
      }

      if (isBike) {
        bikeLeanPivot.rotation.z = THREE.MathUtils.damp(bikeLeanPivot.rotation.z, leanAngleRad, 10, dt);
        bikeLeanPivot.rotation.x = THREE.MathUtils.damp(bikeLeanPivot.rotation.x, pitchRad, 10, dt);
      } else {
        chassisGroup.rotation.x = THREE.MathUtils.damp(chassisGroup.rotation.x, pitchRad, 10, dt);
        chassisGroup.rotation.z = THREE.MathUtils.damp(chassisGroup.rotation.z, rollRad, 10, dt);
      }

      if (drsFlap) {
        const targetAngle = drsActive ? 0.04 : -0.36;
        drsFlap.rotation.x = THREE.MathUtils.damp(drsFlap.rotation.x, targetAngle, 14, dt);
      }

      if (rainLightMat) {
        const flash = braking || Math.floor(performance.now() / 160) % 2 === 0;
        rainLightMat.emissiveIntensity = braking ? 4.2 : flash ? 2.4 : 0.3;
      }

      brakeMaterial.emissiveIntensity = braking ? 3.9 : 1.1;

      for (let i = 0; i < exhaustFlames.length; i++) {
        const f = exhaustFlames[i];
        f.visible = nitroActive;
        if (nitroActive) {
          const jitter = 0.85 + Math.random() * 0.48;
          f.scale.set(1, 1, jitter);
        }
      }
    },
    dispose: () => {
      root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry.dispose();
          if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
          else m.material.dispose();
        }
      });
    },
  };
}
