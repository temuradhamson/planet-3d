import * as THREE from "three";
import { EARTH_R } from "./coords.js";

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
  if (earth.clouds) root.add(earth.clouds);
  root.add(earth.atmosphere);
  root.add(earth.atmosphereInner);

  const stars = makeStars(textures.starmap);
  celestial.add(stars.sky);

  const sun = makeSun();
  root.add(sun.mesh);
  root.add(sun.light);
  root.add(sun.ambient);
  root.add(sun.hemi);

  const moon = makeMoon(textures.moon);
  root.add(moon.mesh);

  return { root, celestial, earth, stars, sun, moon };
}

function makeEarth(textures) {
  const geo = new THREE.SphereGeometry(EARTH_R, 128, 96);
  geo.computeTangents();
  const mat = new THREE.MeshPhongMaterial({
    map: textures.day,
    normalMap: textures.normal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    specularMap: textures.spec,
    specular: new THREE.Color(0x88aacc),
    shininess: 18,
    bumpMap: textures.normal,
    bumpScale: 0.055,
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
         float dayAmt = smoothstep(-0.02, 0.22, ndl);
         float nightAmt = 1.0 - smoothstep(-0.08, 0.12, ndl);
         vec3 day = diffuseColor.rgb;
         vec3 lights = nightColor.rgb * 2.4;
         vec3 nightLand = day * 0.045 + lights;
         diffuseColor.rgb = mix(nightLand, day, dayAmt);
         diffuseColor.rgb += lights * nightAmt * (1.0 - dayAmt) * 0.35;
         float term = 1.0 - smoothstep(0.0, 0.16, abs(ndl));
         diffuseColor.rgb += vec3(1.0, 0.48, 0.14) * term * 0.55;`
      );
    mat.userData.shader = shader;
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "earth";

  let clouds = null;
  if (textures.clouds) {
    const cloudMat = new THREE.MeshLambertMaterial({
      map: textures.clouds,
      alphaMap: textures.clouds,
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      alphaTest: 0.08,
    });
    clouds = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.008, 96, 64), cloudMat);
    clouds.name = "clouds";
    clouds.renderOrder = 1;
  }

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_R * 1.08, 64, 48),
    makeAtmosphereMaterial(sunDir, true)
  );
  atmosphere.name = "atmosphere";
  const atmosphereInner = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_R * 1.012, 64, 48),
    makeAtmosphereMaterial(sunDir, false)
  );
  atmosphereInner.name = "atmosphere-inner";
  return { mesh, clouds, atmosphere, atmosphereInner, sunDir, mat };
}

function makeAtmosphereMaterial(sunDir, outer) {
  return new THREE.ShaderMaterial({
    side: outer ? THREE.BackSide : THREE.FrontSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      sunDir: { value: sunDir },
      glow: { value: new THREE.Color(outer ? 0x6eb6ff : 0xa8d8ff) },
      outer: { value: outer ? 1 : 0 },
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
      uniform float outer;
      varying vec3 vWorldPos;
      varying vec3 vN;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 n = normalize(vN);
        float ndv = abs(dot(n, viewDir));
        float rim = outer > 0.5
          ? pow(1.0 - ndv, 2.4)
          : pow(1.0 - ndv, 4.2);
        float sunFacing = pow(max(0.0, dot(normalize(vWorldPos), normalize(sunDir))), 1.05);
        float nightFade = smoothstep(-0.15, 0.35, dot(n, normalize(sunDir)));
        float a = rim * (0.18 + 1.15 * sunFacing) * mix(0.35, 1.0, nightFade);
        if (outer < 0.5) a *= 0.55;
        vec3 col = mix(glow, vec3(1.0, 0.72, 0.35), sunFacing * 0.45);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

function makeStars(starmap) {
  starmap.colorSpace = THREE.SRGBColorSpace;
  starmap.wrapS = THREE.RepeatWrapping;
  starmap.wrapT = THREE.ClampToEdgeWrapping;
  starmap.anisotropy = 8;
  starmap.needsUpdate = true;

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(STAR_R, 96, 64),
    new THREE.MeshBasicMaterial({
      map: starmap,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      color: 0xdce6ff,
    })
  );
  sky.name = "starmap";
  return { sky };
}

function makeSun() {
  const light = new THREE.DirectionalLight(0xfff3d8, 3.6);
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

  const mesh = new THREE.Group();
  mesh.name = "sun";
  mesh.add(glowSprite(128, 3.4, [
    [0.0, "rgba(255,255,255,1)"],
    [0.08, "rgba(255,250,220,1)"],
    [0.18, "rgba(255,220,120,0.85)"],
    [0.4, "rgba(255,150,40,0.28)"],
    [1.0, "rgba(255,80,0,0)"],
  ]));
  mesh.add(glowSprite(256, 11.0, [
    [0.0, "rgba(255,240,180,0.55)"],
    [0.12, "rgba(255,190,80,0.28)"],
    [0.35, "rgba(255,120,30,0.08)"],
    [1.0, "rgba(255,60,0,0)"],
  ]));
  mesh.add(glowSprite(256, 22.0, [
    [0.0, "rgba(255,210,140,0.18)"],
    [0.25, "rgba(255,140,50,0.05)"],
    [1.0, "rgba(255,80,0,0)"],
  ]));
  const disc = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff7e0, fog: false, toneMapped: false })
  );
  mesh.add(disc);

  const ambient = new THREE.AmbientLight(0x1a2233, 0.16);
  const hemi = new THREE.HemisphereLight(0x9ecbff, 0x1a1008, 0.32);
  hemi.name = "sky-hemi";
  return { mesh, light, ambient, hemi };
}

function glowSprite(size, scale, stops) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) grd.addColorStop(t, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(scale, scale, 1);
  return spr;
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
  earth.atmosphereInner.material.uniforms.sunDir.value.copy(astro.sunDir);
  if (earth.clouds) earth.clouds.rotation.y += 0.000015;

  moon.mesh.position.copy(astro.moonDir).multiplyScalar(MOON_VISUAL_DIST);
  moon.mesh.lookAt(0, 0, 0);
}
