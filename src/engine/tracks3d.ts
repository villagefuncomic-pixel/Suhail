import * as THREE from 'three';
import { TrackDefinition, UpcomingTurnType } from '../types/game';
import { ProceduralTextureSet } from './textures';

export interface TrackSample {
  closestPoint: THREE.Vector3;
  tangent: THREE.Vector3;
  distanceFromCenter: number;
  progress: number; // 0..1
  roadHalfWidth: number;
  elevationY: number;
}

export interface UpcomingTurnInfo {
  turn: UpcomingTurnType;
  distanceM: number;
  brakeRecommended: boolean;
}

export interface BuiltTrack {
  group: THREE.Group;
  curve: THREE.CatmullRomCurve3;
  sampleAt: (x: number, z: number) => TrackSample;
  predictUpcomingTurn: (progress: number, speedMs: number) => UpcomingTurnInfo;
  getStartTransform: (slotIndex?: number) => { x: number; y: number; z: number; heading: number };
  setStartLights: (litCount: number) => void;
  minimapPoints: { x: number; z: number }[];
  dispose: () => void;
}

function createChevronTexture(direction: 'left' | 'right'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#090b10';
  ctx.fillRect(0, 0, 256, 128);

  // High-contrast border
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 120);

  // Bold chevron arrows pointing in turn direction
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const offsets = [58, 128, 198];
  offsets.forEach((cx) => {
    ctx.beginPath();
    if (direction === 'left') {
      ctx.moveTo(cx + 22, 26);
      ctx.lineTo(cx - 18, 64);
      ctx.lineTo(cx + 22, 102);
    } else {
      ctx.moveTo(cx - 22, 26);
      ctx.lineTo(cx + 18, 64);
      ctx.lineTo(cx - 22, 102);
    }
    ctx.stroke();
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _tmpVec = new THREE.Vector3();

export function buildTrackScene(
  track: TrackDefinition,
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): BuiltTrack {
  const group = new THREE.Group();
  const points = track.controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);

  const SEGMENTS = 440;
  const halfW = track.roadWidth / 2;
  const curbW = 1.65;

  const lookupPoints: THREE.Vector3[] = [];
  const lookupTangents: THREE.Vector3[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const t = i / SEGMENTS;
    lookupPoints.push(curve.getPointAt(t));
    lookupTangents.push(curve.getTangentAt(t).normalize());
  }

  const roadPos: number[] = [];
  const roadUvs: number[] = [];
  const roadIdx: number[] = [];

  const curbPos: number[] = [];
  const curbUvs: number[] = [];
  const curbIdx: number[] = [];

  const railPos: number[] = [];
  const railIdx: number[] = [];

  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i <= SEGMENTS; i++) {
    const t = (i % SEGMENTS) / SEGMENTS;
    const pt = curve.getPointAt(t);
    const tan = curve.getTangentAt(t).normalize();
    const right = new THREE.Vector3().crossVectors(tan, up).normalize();

    const vCoord = i * 0.45;

    const pL = pt.clone().addScaledVector(right, -halfW);
    const pR = pt.clone().addScaledVector(right, halfW);
    roadPos.push(pL.x, pL.y + 0.03, pL.z, pR.x, pR.y + 0.03, pR.z);
    roadUvs.push(0, vCoord, 1, vCoord);

    const cLOut = pt.clone().addScaledVector(right, -(halfW + curbW));
    const cROut = pt.clone().addScaledVector(right, halfW + curbW);
    curbPos.push(
      cLOut.x, cLOut.y + 0.07, cLOut.z,
      pL.x, pL.y + 0.05, pL.z,
      pR.x, pR.y + 0.05, pR.z,
      cROut.x, cROut.y + 0.07, cROut.z,
    );
    curbUvs.push(0, vCoord * 2, 1, vCoord * 2, 0, vCoord * 2, 1, vCoord * 2);

    const railOffset = halfW + curbW + 2.8;
    const rL = pt.clone().addScaledVector(right, -railOffset);
    const rR = pt.clone().addScaledVector(right, railOffset);
    railPos.push(
      rL.x, rL.y + 0.0, rL.z,
      rL.x, rL.y + 1.1, rL.z,
      rR.x, rR.y + 0.0, rR.z,
      rR.x, rR.y + 1.1, rR.z,
    );

    if (i < SEGMENTS) {
      const b = i * 2;
      roadIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);

      const cb = i * 4;
      curbIdx.push(cb, cb + 1, cb + 4, cb + 1, cb + 5, cb + 4);
      curbIdx.push(cb + 2, cb + 3, cb + 6, cb + 3, cb + 7, cb + 6);

      const rb = i * 4;
      railIdx.push(rb, rb + 4, rb + 1, rb + 1, rb + 4, rb + 5);
      railIdx.push(rb + 2, rb + 3, rb + 6, rb + 3, rb + 7, rb + 6);
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
  roadGeo.setIndex(roadIdx);
  roadGeo.computeVertexNormals();

  const roadMat = new THREE.MeshStandardMaterial({
    map: textures.asphalt,
    roughnessMap: textures.asphaltRoughness,
    roughness: track.id === 'midnight' ? 0.34 : 0.72,
    metalness: track.id === 'midnight' ? 0.24 : 0.06,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  const curbGeo = new THREE.BufferGeometry();
  curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbPos, 3));
  curbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(curbUvs, 2));
  curbGeo.setIndex(curbIdx);
  curbGeo.computeVertexNormals();
  const curbMat = new THREE.MeshStandardMaterial({
    map: textures.curb,
    roughness: 0.65,
  });
  const curbMesh = new THREE.Mesh(curbGeo, curbMat);
  curbMesh.receiveShadow = true;
  group.add(curbMesh);

  const railGeo = new THREE.BufferGeometry();
  railGeo.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
  railGeo.setIndex(railIdx);
  railGeo.computeVertexNormals();
  const railMat = new THREE.MeshStandardMaterial({
    color: track.mode === 'f1' ? 0xdc2626 : track.id === 'midnight' ? 0x334155 : 0x94a3b8,
    metalness: 0.65,
    roughness: 0.35,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(railGeo, railMat));

  // Crisp luminous road edge ribbons + barrier top guide strips for clear long-range track visibility
  const edgePos: number[] = [];
  const edgeIdx: number[] = [];
  const guidePos: number[] = [];
  const guideIdx: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = (i % SEGMENTS) / SEGMENTS;
    const pt = curve.getPointAt(t);
    const tan = curve.getTangentAt(t).normalize();
    const right = new THREE.Vector3().crossVectors(tan, up).normalize();

    const edgeIn = halfW - 0.52;
    const edgeOut = halfW - 0.12;
    const eL1 = pt.clone().addScaledVector(right, -edgeOut);
    const eL2 = pt.clone().addScaledVector(right, -edgeIn);
    const eR1 = pt.clone().addScaledVector(right, edgeIn);
    const eR2 = pt.clone().addScaledVector(right, edgeOut);
    edgePos.push(
      eL1.x, eL1.y + 0.06, eL1.z,
      eL2.x, eL2.y + 0.06, eL2.z,
      eR1.x, eR1.y + 0.06, eR1.z,
      eR2.x, eR2.y + 0.06, eR2.z,
    );

    const railOffset = halfW + curbW + 2.72;
    const gL = pt.clone().addScaledVector(right, -railOffset);
    const gR = pt.clone().addScaledVector(right, railOffset);
    guidePos.push(
      gL.x, gL.y + 1.02, gL.z,
      gL.x, gL.y + 1.24, gL.z,
      gR.x, gR.y + 1.02, gR.z,
      gR.x, gR.y + 1.24, gR.z,
    );

    if (i < SEGMENTS) {
      const b = i * 4;
      edgeIdx.push(b, b + 1, b + 4, b + 1, b + 5, b + 4);
      edgeIdx.push(b + 2, b + 3, b + 6, b + 3, b + 7, b + 6);
      guideIdx.push(b, b + 4, b + 1, b + 1, b + 4, b + 5);
      guideIdx.push(b + 2, b + 3, b + 6, b + 3, b + 7, b + 6);
    }
  }

  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
  edgeGeo.setIndex(edgeIdx);
  group.add(
    new THREE.Mesh(
      edgeGeo,
      new THREE.MeshBasicMaterial({ color: 0xf8fafc, side: THREE.DoubleSide }),
    ),
  );

  const guideGeo = new THREE.BufferGeometry();
  guideGeo.setAttribute('position', new THREE.Float32BufferAttribute(guidePos, 3));
  guideGeo.setIndex(guideIdx);
  group.add(
    new THREE.Mesh(
      guideGeo,
      new THREE.MeshBasicMaterial({
        color: track.id === 'midnight' ? 0x38bdf8 : 0xfacc15,
        side: THREE.DoubleSide,
      }),
    ),
  );

  // Automatic 3D Corner Chevron Warning Signboards on outside of turns for easy long-range prediction
  const leftChevronTex = createChevronTexture('left');
  const rightChevronTex = createChevronTexture('right');
  const leftChevronMat = new THREE.MeshBasicMaterial({ map: leftChevronTex, side: THREE.DoubleSide });
  const rightChevronMat = new THREE.MeshBasicMaterial({ map: rightChevronTex, side: THREE.DoubleSide });
  const signGeo = new THREE.PlaneGeometry(5.2, 2.5);
  const postGeo = new THREE.BoxGeometry(0.18, 2.2, 0.18);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 });

  for (let i = 0; i < SEGMENTS; i += 8) {
    const t0 = i / SEGMENTS;
    const tAhead = ((i + 12) % SEGMENTS) / SEGMENTS;
    const tan0 = lookupTangents[i];
    const tanAhead = lookupTangents[(i + 12) % SEGMENTS];
    const right0 = new THREE.Vector3().crossVectors(tan0, up).normalize();
    const turnDot = tanAhead.dot(right0); // >0 = turning right, <0 = turning left
    const angle = Math.acos(THREE.MathUtils.clamp(tan0.dot(tanAhead), -1, 1));

    if (angle > 0.22) {
      const turningRight = turnDot > 0;
      const outsideSide = turningRight ? -1 : 1; // outside of right turn is on left (-right)
      const pt = curve.getPointAt(t0);
      const pos = pt.clone().addScaledVector(right0, outsideSide * (halfW + curbW + 3.1));

      const signGroup = new THREE.Group();
      signGroup.position.set(pos.x, pos.y, pos.z);
      // Face incoming driver along -tan0
      signGroup.rotation.y = Math.atan2(-tan0.x, -tan0.z);

      const post = new THREE.Mesh(postGeo, postMat);
      post.position.y = 1.1;
      signGroup.add(post);

      const board = new THREE.Mesh(signGeo, turningRight ? rightChevronMat : leftChevronMat);
      board.position.y = 2.45;
      signGroup.add(board);

      group.add(signGroup);
      // Skip ahead slightly to space out chevron boards cleanly
      if (tAhead < t0) break;
    }
  }

  // Start / Finish Checkered Strip & F1/Rolex Gantry with 5 Red Lights
  const startPt = curve.getPointAt(0);
  const startTan = curve.getTangentAt(0).normalize();
  const startHeading = Math.atan2(-startTan.x, -startTan.z);

  const startStripGeo = new THREE.PlaneGeometry(track.roadWidth - 0.5, 4.5);
  startStripGeo.rotateX(-Math.PI / 2);
  const startStrip = new THREE.Mesh(
    startStripGeo,
    new THREE.MeshStandardMaterial({
      map: textures.checkered,
      roughness: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  startStrip.position.copy(startPt).setY(startPt.y + 0.06);
  startStrip.rotation.y = startHeading;
  group.add(startStrip);

  const gantryGroup = new THREE.Group();
  gantryGroup.position.copy(startPt);
  gantryGroup.rotation.y = startHeading;
  const gantryMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.72, roughness: 0.28 });
  const pillarGeo = new THREE.BoxGeometry(0.95, 8.6, 0.95);
  [-halfW - 1.4, halfW + 1.4].forEach((gx) => {
    const pillar = new THREE.Mesh(pillarGeo, gantryMat);
    pillar.position.set(gx, 4.3, 0);
    pillar.castShadow = true;
    gantryGroup.add(pillar);
  });

  const bridge = new THREE.Mesh(new THREE.BoxGeometry(track.roadWidth + 4, 1.8, 1.45), gantryMat);
  bridge.position.set(0, 8.0, 0);
  bridge.castShadow = true;
  gantryGroup.add(bridge);

  const rolexBannerMat = new THREE.MeshStandardMaterial({
    map: textures.rolexBanner,
    roughness: 0.35,
    metalness: 0.2,
  });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(track.roadWidth + 1.8, 1.3, 1.52), rolexBannerMat);
  banner.position.set(0, 8.0, 0);
  gantryGroup.add(banner);

  // 5 Official F1 Starting Lights
  const startLightMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 5; i++) {
    const lMat = new THREE.MeshStandardMaterial({
      color: 0x450a0a,
      emissive: 0xef4444,
      emissiveIntensity: 0,
      roughness: 0.2,
    });
    startLightMats.push(lMat);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.95, 0.3), gantryMat);
    housing.position.set((i - 2) * 1.4, 6.7, 0);
    gantryGroup.add(housing);

    const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.34, 14).rotateX(Math.PI / 2), lMat);
    bulb.position.set((i - 2) * 1.4, 6.7, 0);
    gantryGroup.add(bulb);
  }
  group.add(gantryGroup);

  // Grandstands & Pit Garages along start straight for F1 & real circuit feel
  if (track.mode === 'f1') {
    const standMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7, metalness: 0.2 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, metalness: 0.5 });
    const rightVec = new THREE.Vector3().crossVectors(startTan, up).normalize();

    [-1, 1].forEach((side) => {
      const standGroup = new THREE.Group();
      const basePos = startPt.clone().addScaledVector(rightVec, side * (halfW + 14));
      standGroup.position.copy(basePos);
      standGroup.rotation.y = startHeading;

      const tiers = new THREE.Mesh(new THREE.BoxGeometry(8.5, 6.5, 58), standMat);
      tiers.position.set(0, 3.25, -18);
      tiers.castShadow = true;
      standGroup.add(tiers);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.4, 60), roofMat);
      roof.position.set(side > 0 ? -1 : 1, 7.2, -18);
      standGroup.add(roof);

      group.add(standGroup);
    });

    // Additional Rolex Arch Bridges around the circuit
    [0.32, 0.68].forEach((tPos) => {
      const pt = curve.getPointAt(tPos);
      const tan = curve.getTangentAt(tPos).normalize();
      const arch = new THREE.Group();
      arch.position.copy(pt);
      arch.rotation.y = Math.atan2(-tan.x, -tan.z);

      [-halfW - 1.2, halfW + 1.2].forEach((ax) => {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 7.0, 0.7), gantryMat);
        p.position.set(ax, 3.5, 0);
        arch.add(p);
      });
      const b = new THREE.Mesh(new THREE.BoxGeometry(track.roadWidth + 3.2, 1.35, 1.1), rolexBannerMat);
      b.position.set(0, 6.8, 0);
      arch.add(b);
      group.add(arch);
    });
  }

  // Ground Terrain Plane
  const groundSize = 2400;
  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
  groundGeo.rotateX(-Math.PI / 2);
  const groundColor =
    track.id === 'coastal'
      ? 0x2d3b2d
      : track.id === 'alpine'
      ? 0x3b4938
      : track.id === 'midnight'
      ? 0x0b0f17
      : track.id === 'monaco'
      ? 0x334155
      : 0x2f4b28;
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ color: groundColor, roughness: 0.94, metalness: 0.02 }),
  );
  ground.position.set(140, -0.4, -40);
  ground.receiveShadow = true;
  group.add(ground);

  // Environment Scenery
  if (track.id === 'monaco') {
    // Mediterranean Harbor Water & Yachts + Monte Carlo Tunnel + Buildings
    const waterGeo = new THREE.PlaneGeometry(1600, 1400);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(
      waterGeo,
      new THREE.MeshPhysicalMaterial({ color: 0x0369a1, roughness: 0.12, metalness: 0.12, clearcoat: 0.9 }),
    );
    water.position.set(420, -0.25, 0);
    group.add(water);

    // Monte Carlo Illuminated Tunnel along t = 0.56..0.67
    const tunnelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7, side: THREE.DoubleSide });
    const lightStripMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7 });
    for (let s = 0.55; s <= 0.67; s += 0.015) {
      const pt = curve.getPointAt(s);
      const tan = curve.getTangentAt(s).normalize();
      const seg = new THREE.Group();
      seg.position.copy(pt);
      seg.rotation.y = Math.atan2(-tan.x, -tan.z);

      const arch = new THREE.Mesh(
        new THREE.CylinderGeometry(halfW + 3.4, halfW + 3.4, 9.5, 14, 1, true, 0, Math.PI),
        tunnelMat,
      );
      arch.rotation.z = Math.PI / 2;
      arch.rotation.y = Math.PI / 2;
      arch.position.y = 0;
      seg.add(arch);

      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 7.5), lightStripMat);
      lamp.position.y = halfW + 2.6;
      seg.add(lamp);
      group.add(seg);
    }

    // Monaco City Towers
    const bCount = 55;
    const bMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.7 }),
      bCount,
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < bCount; i++) {
      const t = i / bCount;
      const pt = curve.getPointAt(t);
      const tan = curve.getTangentAt(t).normalize();
      const right = new THREE.Vector3().crossVectors(tan, up).normalize();
      const pos = pt.clone().addScaledVector(right, -(halfW + 18 + (i % 4) * 9));
      const h = 16 + ((i * 13) % 34);
      const w = 12 + (i % 7);
      dummy.position.set(pos.x, h / 2 - 0.5, pos.z);
      dummy.scale.set(w, h, w);
      dummy.rotation.set(0, Math.atan2(-tan.x, -tan.z), 0);
      dummy.updateMatrix();
      bMesh.setMatrixAt(i, dummy.matrix);
    }
    bMesh.computeBoundingSphere();
    group.add(bMesh);
  } else if (track.id === 'coastal') {
    const oceanGeo = new THREE.PlaneGeometry(2400, 1200);
    oceanGeo.rotateX(-Math.PI / 2);
    const ocean = new THREE.Mesh(
      oceanGeo,
      new THREE.MeshPhysicalMaterial({ color: 0x0c4a6e, roughness: 0.14, metalness: 0.1, clearcoat: 0.85 }),
    );
    ocean.position.set(140, -0.22, -740);
    group.add(ocean);

    const count = isSoftwareGl ? 60 : 120;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.18, 0.34, 7.5, 7),
      new THREE.MeshStandardMaterial({ color: 0x6b4c35, roughness: 0.9 }),
      count,
    );
    const leaves = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.6, 1.8, 7),
      new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.78 }),
      count,
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const t = (i / count + 0.02) % 1;
      const pt = curve.getPointAt(t);
      const tan = curve.getTangentAt(t).normalize();
      const right = new THREE.Vector3().crossVectors(tan, up).normalize();
      const side = i % 2 === 0 ? 1 : -1;
      const pos = pt.clone().addScaledVector(right, side * (halfW + 10 + ((i * 17) % 24)));
      const s = 0.85 + ((i * 11) % 30) / 100;
      dummy.position.set(pos.x, pos.y + 3.4 * s, pos.z);
      dummy.scale.set(s, s, s);
      dummy.rotation.set(0, i * 0.7, side * 0.08);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(pos.x, pos.y + 7.2 * s, pos.z);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
    }
    trunks.computeBoundingSphere();
    leaves.computeBoundingSphere();
    group.add(trunks, leaves);
  } else if (track.id === 'alpine' || track.id === 'silverstone' || track.id === 'monza') {
    const pineCount = isSoftwareGl ? 80 : 160;
    const pines = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.3, 8.8, 6),
      new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.85 }),
      pineCount,
    );
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    for (let i = 0; i < pineCount; i++) {
      const t = (i / pineCount + 0.025) % 1;
      const pt = curve.getPointAt(t);
      const tan = curve.getTangentAt(t).normalize();
      const right = new THREE.Vector3().crossVectors(tan, up).normalize();
      const side = i % 2 === 0 ? 1 : -1;
      const pos = pt.clone().addScaledVector(right, side * (halfW + 12 + ((i * 23) % 38)));
      const s = 0.85 + ((i * 7) % 45) / 100;
      dummy.position.set(pos.x, pos.y + 4.1 * s, pos.z);
      dummy.scale.set(s, s, s);
      dummy.rotation.set(0, i * 1.1, 0);
      dummy.updateMatrix();
      pines.setMatrixAt(i, dummy.matrix);
      tint.setHSL(0.34 + (i % 5) * 0.015, 0.45, 0.24 + (i % 4) * 0.03);
      pines.setColorAt(i, tint);
    }
    pines.computeBoundingSphere();
    group.add(pines);
  } else {
    // Midnight Neon Expressway
    const towerCount = 65;
    const towers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4, metalness: 0.7 }),
      towerCount,
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < towerCount; i++) {
      const angle = (i / towerCount) * Math.PI * 2;
      const radius = 240 + ((i * 37) % 180);
      const x = 150 + Math.cos(angle) * radius;
      const z = -50 + Math.sin(angle) * radius;
      const h = 28 + ((i * 19) % 75);
      const w = 14 + ((i * 7) % 16);
      dummy.position.set(x, h / 2 - 0.5, z);
      dummy.scale.set(w, h, w);
      dummy.rotation.set(0, angle, 0);
      dummy.updateMatrix();
      towers.setMatrixAt(i, dummy.matrix);
    }
    towers.computeBoundingSphere();
    group.add(towers);

    const poleCount = 48;
    const poles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.28, 7.5, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.3 }),
      poleCount,
    );
    const lamps = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.6, 0.16, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
      poleCount,
    );
    for (let i = 0; i < poleCount; i++) {
      const t = i / poleCount;
      const pt = curve.getPointAt(t);
      const tan = curve.getTangentAt(t).normalize();
      const right = new THREE.Vector3().crossVectors(tan, up).normalize();
      const side = i % 2 === 0 ? 1 : -1;
      const heading = Math.atan2(-tan.x, -tan.z);
      const pos = pt.clone().addScaledVector(right, side * (halfW + 3.2));
      dummy.position.set(pos.x, pos.y + 3.75, pos.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, heading, 0);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);

      const lampPos = pt.clone().addScaledVector(right, side * (halfW + 1.8));
      dummy.position.set(lampPos.x, lampPos.y + 7.45, lampPos.z);
      dummy.updateMatrix();
      lamps.setMatrixAt(i, dummy.matrix);
    }
    poles.computeBoundingSphere();
    lamps.computeBoundingSphere();
    group.add(poles, lamps);
  }

  const minimapPoints: { x: number; z: number }[] = [];
  for (let i = 0; i < 90; i++) {
    const p = curve.getPointAt(i / 90);
    minimapPoints.push({ x: p.x, z: p.z });
  }

  function sampleAt(x: number, z: number): TrackSample {
    let bestIdx = 0;
    let bestDistSq = Infinity;
    for (let i = 0; i < SEGMENTS; i++) {
      const p = lookupPoints[i];
      const dx = x - p.x;
      const dz = z - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }
    const prevIdx = (bestIdx - 1 + SEGMENTS) % SEGMENTS;
    const nextIdx = (bestIdx + 1) % SEGMENTS;
    const pA = lookupPoints[prevIdx];
    const pB = lookupPoints[nextIdx];
    _tmpVec.set(x, lookupPoints[bestIdx].y, z);
    const segDir = new THREE.Vector3().subVectors(pB, pA);
    const segLenSq = segDir.lengthSq() || 1;
    const proj = THREE.MathUtils.clamp(_tmpVec.clone().sub(pA).dot(segDir) / segLenSq, 0, 1);
    const closestPoint = pA.clone().addScaledVector(segDir, proj);
    const distanceFromCenter = Math.hypot(x - closestPoint.x, z - closestPoint.z);

    return {
      closestPoint,
      tangent: lookupTangents[bestIdx],
      distanceFromCenter,
      progress: bestIdx / SEGMENTS,
      roadHalfWidth: halfW,
      elevationY: closestPoint.y,
    };
  }

  function getStartTransform(slotIndex = 0) {
    const row = Math.floor(slotIndex / 2);
    const col = slotIndex % 2 === 0 ? -1 : 1;
    const t = (1 - (0.015 + row * 0.018)) % 1;
    const pt = curve.getPointAt(t);
    const tan = curve.getTangentAt(t).normalize();
    const right = new THREE.Vector3().crossVectors(tan, up).normalize();
    const pos = pt.clone().addScaledVector(right, col * 3.2);
    return {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      heading: Math.atan2(-tan.x, -tan.z),
    };
  }

  function setStartLights(litCount: number) {
    startLightMats.forEach((m, idx) => {
      m.emissiveIntensity = idx < litCount ? 4.2 : 0.0;
    });
  }

  const totalLengthM = curve.getLength();

  function predictUpcomingTurn(progress: number, speedMs: number): UpcomingTurnInfo {
    const tanNow = curve.getTangentAt(((progress % 1) + 1) % 1).normalize();
    const lookDistances = [45, 75, 105, 140];
    let bestAngle = 0;
    let bestSignedDot = 0;
    let bestDist = 140;

    for (const distM of lookDistances) {
      const dtProg = distM / Math.max(100, totalLengthM);
      const tFuture = (progress + dtProg) % 1;
      const tStepAfter = (tFuture + 30 / Math.max(100, totalLengthM)) % 1;
      const tanA = curve.getTangentAt(tFuture).normalize();
      const tanB = curve.getTangentAt(tStepAfter).normalize();
      const rightA = new THREE.Vector3().crossVectors(tanA, up).normalize();
      const localAngle = Math.acos(THREE.MathUtils.clamp(tanA.dot(tanB), -1, 1));
      const overallAngle = Math.acos(THREE.MathUtils.clamp(tanNow.dot(tanB), -1, 1));
      const combined = Math.max(localAngle * 1.4, overallAngle);

      if (combined > bestAngle) {
        bestAngle = combined;
        bestSignedDot = tanB.dot(rightA);
        bestDist = distM;
      }
    }

    const isRight = bestSignedDot > 0;
    let turn: UpcomingTurnType = 'straight';
    if (bestAngle > 0.92) {
      turn = isRight ? 'hairpin_right' : 'hairpin_left';
    } else if (bestAngle > 0.48) {
      turn = isRight ? 'sharp_right' : 'sharp_left';
    } else if (bestAngle > 0.2) {
      turn = isRight ? 'right' : 'left';
    }

    const speedKmh = speedMs * 3.6;
    const brakeRecommended =
      (turn === 'hairpin_left' || turn === 'hairpin_right')
        ? speedKmh > 105
        : (turn === 'sharp_left' || turn === 'sharp_right')
        ? speedKmh > 155
        : false;

    return {
      turn,
      distanceM: Math.round(bestDist),
      brakeRecommended,
    };
  }

  return {
    group,
    curve,
    sampleAt,
    predictUpcomingTurn,
    getStartTransform,
    setStartLights,
    minimapPoints,
    dispose: () => {
      leftChevronTex.dispose();
      rightChevronTex.dispose();
      group.traverse((obj) => {
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
