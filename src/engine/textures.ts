import * as THREE from 'three';

export interface ProceduralTextureSet {
  asphalt: THREE.CanvasTexture;
  asphaltRoughness: THREE.CanvasTexture;
  carbon: THREE.CanvasTexture;
  curb: THREE.CanvasTexture;
  checkered: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  showroomFloor: THREE.CanvasTexture;
  rolexBanner: THREE.CanvasTexture;
  f1TireSoft: THREE.CanvasTexture;
  f1TireMedium: THREE.CanvasTexture;
  f1TireHard: THREE.CanvasTexture;
  dispose: () => void;
}

function makeF1TireRing(colorHex: string, aniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#15181e';
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(128, 128, 96, 0.25, Math.PI * 1.15);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(128, 128, 96, Math.PI + 0.25, Math.PI * 2 + 0.15);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  const aniso = Math.min(8, Math.max(1, maxAnisotropy));

  // 1. Asphalt Road Texture (aggregate grain + rubbered racing line + lane markings)
  const asphaltCanvas = document.createElement('canvas');
  asphaltCanvas.width = 512;
  asphaltCanvas.height = 512;
  const actx = asphaltCanvas.getContext('2d')!;
  actx.fillStyle = '#22262e';
  actx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 12000; i++) {
    const x = (i * 73) % 512;
    const y = (i * 197 + Math.floor(i / 7) * 31) % 512;
    const v = 26 + ((i * 13) % 28);
    actx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    actx.fillRect(x, y, 2, 2);
  }

  const gradL = actx.createLinearGradient(110, 0, 210, 0);
  gradL.addColorStop(0, 'rgba(8,10,14,0)');
  gradL.addColorStop(0.5, 'rgba(8,10,14,0.34)');
  gradL.addColorStop(1, 'rgba(8,10,14,0)');
  actx.fillStyle = gradL;
  actx.fillRect(110, 0, 100, 512);

  const gradR = actx.createLinearGradient(302, 0, 402, 0);
  gradR.addColorStop(0, 'rgba(8,10,14,0)');
  gradR.addColorStop(0.5, 'rgba(8,10,14,0.34)');
  gradR.addColorStop(1, 'rgba(8,10,14,0)');
  actx.fillStyle = gradR;
  actx.fillRect(302, 0, 100, 512);

  actx.fillStyle = '#e2e8f0';
  actx.fillRect(14, 0, 10, 512);
  actx.fillRect(488, 0, 10, 512);

  actx.fillStyle = 'rgba(245, 158, 11, 0.72)';
  for (let y = 20; y < 512; y += 128) {
    actx.fillRect(253, y, 6, 66);
  }

  const asphalt = new THREE.CanvasTexture(asphaltCanvas);
  asphalt.wrapS = THREE.RepeatWrapping;
  asphalt.wrapT = THREE.RepeatWrapping;
  asphalt.colorSpace = THREE.SRGBColorSpace;
  asphalt.anisotropy = aniso;

  // 2. Asphalt Roughness Map (linear)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 256;
  roughCanvas.height = 256;
  const rctx = roughCanvas.getContext('2d')!;
  rctx.fillStyle = '#b0b0b0';
  rctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4500; i++) {
    const x = (i * 53) % 256;
    const y = (i * 113) % 256;
    const v = 130 + ((i * 29) % 90);
    rctx.fillStyle = `rgb(${v},${v},${v})`;
    rctx.fillRect(x, y, 2, 2);
  }
  const asphaltRoughness = new THREE.CanvasTexture(roughCanvas);
  asphaltRoughness.wrapS = THREE.RepeatWrapping;
  asphaltRoughness.wrapT = THREE.RepeatWrapping;
  asphaltRoughness.anisotropy = aniso;

  // 3. Carbon Fiber Weave
  const carbonCanvas = document.createElement('canvas');
  carbonCanvas.width = 64;
  carbonCanvas.height = 64;
  const cctx = carbonCanvas.getContext('2d')!;
  cctx.fillStyle = '#101217';
  cctx.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 8) {
    for (let x = 0; x < 64; x += 8) {
      cctx.fillStyle = (x + y) % 16 === 0 ? '#272b36' : '#181b22';
      cctx.fillRect(x, y, 6, 4);
      cctx.fillStyle = (x + y) % 16 === 0 ? '#1b1f27' : '#323846';
      cctx.fillRect(x + 2, y + 4, 6, 4);
    }
  }
  const carbon = new THREE.CanvasTexture(carbonCanvas);
  carbon.wrapS = THREE.RepeatWrapping;
  carbon.wrapT = THREE.RepeatWrapping;
  carbon.repeat.set(8, 8);
  carbon.colorSpace = THREE.SRGBColorSpace;
  carbon.anisotropy = aniso;

  // 4. Racing Curb Rumble Strip
  const curbCanvas = document.createElement('canvas');
  curbCanvas.width = 128;
  curbCanvas.height = 256;
  const kctx = curbCanvas.getContext('2d')!;
  kctx.fillStyle = '#dc2626';
  kctx.fillRect(0, 0, 128, 128);
  kctx.fillStyle = '#f8fafc';
  kctx.fillRect(0, 128, 128, 128);
  const curb = new THREE.CanvasTexture(curbCanvas);
  curb.wrapS = THREE.RepeatWrapping;
  curb.wrapT = THREE.RepeatWrapping;
  curb.colorSpace = THREE.SRGBColorSpace;
  curb.anisotropy = aniso;

  // 5. Start/Finish Checkered Strip
  const chkCanvas = document.createElement('canvas');
  chkCanvas.width = 256;
  chkCanvas.height = 64;
  const sctx = chkCanvas.getContext('2d')!;
  const sz = 16;
  for (let y = 0; y < 64; y += sz) {
    for (let x = 0; x < 256; x += sz) {
      sctx.fillStyle = (x / sz + y / sz) % 2 === 0 ? '#f8fafc' : '#0f172a';
      sctx.fillRect(x, y, sz, sz);
    }
  }
  const checkered = new THREE.CanvasTexture(chkCanvas);
  checkered.wrapS = THREE.RepeatWrapping;
  checkered.wrapT = THREE.RepeatWrapping;
  checkered.colorSpace = THREE.SRGBColorSpace;
  checkered.anisotropy = aniso;

  // 6. Soft Radial Contact Shadow
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 256;
  shadowCanvas.height = 256;
  const shctx = shadowCanvas.getContext('2d')!;
  const rad = shctx.createRadialGradient(128, 128, 22, 128, 128, 124);
  rad.addColorStop(0, 'rgba(0,0,0,0.88)');
  rad.addColorStop(0.55, 'rgba(0,0,0,0.48)');
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  shctx.fillStyle = rad;
  shctx.fillRect(0, 0, 256, 256);
  const contactShadow = new THREE.CanvasTexture(shadowCanvas);

  // 7. Showroom Turntable Floor
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 512;
  floorCanvas.height = 512;
  const fctx = floorCanvas.getContext('2d')!;
  const fgrad = fctx.createRadialGradient(256, 256, 15, 256, 256, 256);
  fgrad.addColorStop(0, '#1e2430');
  fgrad.addColorStop(0.6, '#111620');
  fgrad.addColorStop(1, '#090b10');
  fctx.fillStyle = fgrad;
  fctx.fillRect(0, 0, 512, 512);

  fctx.strokeStyle = 'rgba(245, 158, 11, 0.28)';
  fctx.lineWidth = 2;
  [120, 180, 238].forEach((r) => {
    fctx.beginPath();
    fctx.arc(256, 256, r, 0, Math.PI * 2);
    fctx.stroke();
  });

  fctx.strokeStyle = 'rgba(255,255,255,0.06)';
  fctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    fctx.beginPath();
    fctx.moveTo(256 + Math.cos(a) * 120, 256 + Math.sin(a) * 120);
    fctx.lineTo(256 + Math.cos(a) * 238, 256 + Math.sin(a) * 238);
    fctx.stroke();
  }

  const showroomFloor = new THREE.CanvasTexture(floorCanvas);
  showroomFloor.colorSpace = THREE.SRGBColorSpace;
  showroomFloor.anisotropy = aniso;

  // 8. Rolex F1 Trackside Gantry Banner
  const rolexCanvas = document.createElement('canvas');
  rolexCanvas.width = 512;
  rolexCanvas.height = 128;
  const rx = rolexCanvas.getContext('2d')!;
  rx.fillStyle = '#064e3b';
  rx.fillRect(0, 0, 512, 128);
  rx.strokeStyle = '#d97706';
  rx.lineWidth = 5;
  rx.strokeRect(4, 4, 504, 120);
  rx.fillStyle = '#fbbf24';
  rx.font = 'bold 46px Georgia, serif';
  rx.textAlign = 'center';
  rx.textBaseline = 'middle';
  rx.fillText('ROLEX   ·   F1 GRAND PRIX', 256, 64);

  const rolexBanner = new THREE.CanvasTexture(rolexCanvas);
  rolexBanner.colorSpace = THREE.SRGBColorSpace;
  rolexBanner.anisotropy = aniso;

  const f1TireSoft = makeF1TireRing('#ef4444', aniso);
  const f1TireMedium = makeF1TireRing('#eab308', aniso);
  const f1TireHard = makeF1TireRing('#f8fafc', aniso);

  return {
    asphalt,
    asphaltRoughness,
    carbon,
    curb,
    checkered,
    contactShadow,
    showroomFloor,
    rolexBanner,
    f1TireSoft,
    f1TireMedium,
    f1TireHard,
    dispose: () => {
      asphalt.dispose();
      asphaltRoughness.dispose();
      carbon.dispose();
      curb.dispose();
      checkered.dispose();
      contactShadow.dispose();
      showroomFloor.dispose();
      rolexBanner.dispose();
      f1TireSoft.dispose();
      f1TireMedium.dispose();
      f1TireHard.dispose();
    },
  };
}
