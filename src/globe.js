import * as THREE from "three";
import { lonLatToVector3, EARTH_R } from "./coords.js";

const SUN_DIST = 48;
const MOON_VISUAL_DIST = 6.2;
const STAR_R = 220;

export function createGlobe(textures) {
  const root = new THREE.Group();
  const celestial = new THREE.Group();
  celestial.name = "celestial";
  root.add(celestial);

  const earth = makeEarth(textures);
  root.add(earth.mesh);
  root.add(earth.atmosphere);

  const stars = makeStars(textures.starmap);
  celestial.add(stars.sky);
  celestial.add(stars.points);

  const sun = makeSun();
  root.add(sun.mesh);
  root.add(sun.light);
  root.add(sun.ambient);

  const moon = makeMoon(textures.moon);
  root.add(moon.mesh);

  return { root, celestial, earth, stars, sun, moon };
}

function makeEarth(textures) {
  const geo = new THREE.SphereGeometry(EARTH_R, 96, 64);
  geo.computeTangents();
  const mat = new THREE.MeshPhongMaterial({
    map: textures.day,
    normalMap: textures.normal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    specularMap: textures.spec,
    specular: new THREE.Color(0x335577),
    shininess: 22,
    bumpMap: textures.normal,
    bumpScale: 0.04,
  });
  const sunDir = new THREE.Vector3(1, 0, 0);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.nightMap = { value: textures.night };
    shader.uniforms.sunDirWorld = { value: sunDir };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vWorldN;`
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
         vWorldN = normalize(mat3(modelMatrix) * objectNormal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform sampler2D nightMap;
         uniform vec3 sunDirWorld;
         varying vec3 vWorldN;`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         vec4 nightColor = texture2D(nightMap, vMapUv);
         float ndl = dot(normalize(vWorldN), normalize(sunDirWorld));
         float mixN = smoothstep(-0.05, 0.28, ndl);
         vec3 day = diffuseColor.rgb;
         vec3 nightLand = day * 0.18 + nightColor.rgb * 1.65;
         diffuseColor.rgb = mix(nightLand, day, mixN);
         float term = 1.0 - smoothstep(0.0, 0.22, abs(ndl));
         diffuseColor.rgb += vec3(1.0, 0.5, 0.18) * term * 0.25;`
      );
    mat.userData.shader = shader;
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "earth";

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_R * 1.045, 64, 48),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        sunDir: { value: sunDir },
        glow: { value: new THREE.Color(0x5fb2ff) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        varying vec3 vN;
        void main() {
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 sunDir;
        uniform vec3 glow;
        varying vec3 vWorldPos;
        varying vec3 vN;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 n = normalize(vN);
          float rim = pow(1.0 - abs(dot(n, viewDir)), 3.2);
          float sun = pow(max(0.0, dot(normalize(vWorldPos), normalize(sunDir))), 1.15);
          float a = rim * (0.25 + 0.85 * sun);
          gl_FragColor = vec4(glow * (0.7 + 0.9 * sun), a * 0.9);
        }
      `,
    })
  );
  atmosphere.name = "atmosphere";
  return { mesh, atmosphere, sunDir, mat };
}

function makeStars(starmap) {
  starmap.colorSpace = THREE.SRGBColorSpace;
  starmap.wrapS = THREE.RepeatWrapping;
  starmap.wrapT = THREE.ClampToEdgeWrapping;
  starmap.offset.x = 0.5;
  starmap.needsUpdate = true;

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(STAR_R, 64, 48),
    new THREE.MeshBasicMaterial({
      map: starmap,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
  );
  sky.name = "starmap";

  const N = 6000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const rng = mulberry(0x5eed);
  for (let i = 0; i < N; i++) {
    const ra = rng() * 360;
    const dec = Math.asin(rng() * 2 - 1) * (180 / Math.PI);
    const v = lonLatToVector3(ra, dec, STAR_R * 0.92);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
    const t = rng();
    if (t < 0.18) col.set([0.72, 0.8, 1], i * 3);
    else if (t < 0.7) col.set([1, 0.97, 0.92], i * 3);
    else col.set([1, 0.78, 0.55], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(
    g,
    new THREE.PointsMaterial({
      size: 0.55,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: false,
    })
  );
  points.name = "star-points";
  return { sky, points };
}

function mulberry(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSun() {
  const light = new THREE.DirectionalLight(0xfff1d6, 2.35);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.camera.near = 20;
  light.shadow.camera.far = 80;
  const e = 4;
  light.shadow.camera.left = -e;
  light.shadow.camera.right = e;
  light.shadow.camera.top = e;
  light.shadow.camera.bottom = -e;
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.02;
  light.name = "sun-light";

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false })
  );
  mesh.name = "sun-disc";
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 32, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffc878,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
  );
  mesh.add(glow);

  const ambient = new THREE.AmbientLight(0x2a3348, 0.38);
  return { mesh, light, ambient };
}

function makeMoon(map) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_R * 0.272, 48, 32),
    new THREE.MeshStandardMaterial({
      map,
      roughness: 0.92,
      metalness: 0.0,
      color: 0xdddddd,
    })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "moon";
  return { mesh };
}

export function updateAstroVisuals(globe, astro) {
  const { sun, moon, earth, celestial } = globe;
  const gmstRad = astro.gmst * 15 * (Math.PI / 180);
  celestial.rotation.y = -gmstRad;

  sun.light.position.copy(astro.sunDir).multiplyScalar(SUN_DIST);
  sun.mesh.position.copy(sun.light.position);
  sun.light.target.position.set(0, 0, 0);
  sun.light.target.updateMatrixWorld();
  earth.sunDir.copy(astro.sunDir);
  if (earth.mat.userData.shader) {
    earth.mat.userData.shader.uniforms.sunDirWorld.value.copy(astro.sunDir);
  }
  earth.atmosphere.material.uniforms.sunDir.value.copy(astro.sunDir);

  moon.mesh.position.copy(astro.moonDir).multiplyScalar(MOON_VISUAL_DIST);
  moon.mesh.lookAt(0, 0, 0);
}
