import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// 螢幕空間 God Rays：朝太陽方向 radial march 累積亮部
const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
    uIntensity: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uSunPos;
    uniform float uIntensity;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uIntensity <= 0.001) { gl_FragColor = base; return; }
      vec2 delta = (uSunPos - vUv) * (1.0 / 40.0);
      vec2 uv = vUv;
      float decay = 0.965, weight = 0.045, illum = 1.0;
      vec3 rays = vec3(0.0);
      for (int i = 0; i < 40; i++) {
        uv += delta;
        vec3 s = texture2D(tDiffuse, uv).rgb;
        float lum = dot(s, vec3(0.299, 0.587, 0.114));
        rays += s * smoothstep(0.55, 1.4, lum) * illum * weight;
        illum *= decay;
      }
      gl_FragColor = vec4(base.rgb + rays * uIntensity * vec3(1.0, 0.82, 0.6), base.a);
    }`,
};

// 暗角 + 微色偏，收尾整體氛圍
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.85 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // 暮色調：暗部偏紫、亮部偏暖
      c.rgb = mix(c.rgb, c.rgb * vec3(1.04, 0.98, 1.06), 0.5);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= smoothstep(0.95, uVignette * 0.42, d) * 0.35 + 0.65;
      gl_FragColor = c;
    }`,
};

export function createPostfx(renderer, scene, camera) {
  // MSAA 8x + HDR 緩衝：後處理管線不犧牲抗鋸齒與動態範圍
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.width, size.height, {
    samples: 4,
    type: THREE.HalfFloatType,
  });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.42,   // strength
    0.55,   // radius
    0.92    // threshold
  );
  composer.addPass(bloom);
  const godrays = new ShaderPass(GodRaysShader);
  composer.addPass(godrays);
  composer.addPass(new ShaderPass(GradeShader));
  composer.addPass(new OutputPass());

  // 每幀更新太陽螢幕座標與強度（太陽出畫面就淡出）
  const proj = new THREE.Vector3();
  composer.updateGodRays = (sunDir) => {
    proj.copy(sunDir).multiplyScalar(600).project(camera);
    const onScreen = proj.z < 1 &&
      proj.x > -1.4 && proj.x < 1.4 && proj.y > -1.4 && proj.y < 1.4;
    const u = godrays.uniforms;
    u.uSunPos.value.set((proj.x + 1) / 2, (proj.y + 1) / 2);
    const edge = onScreen
      ? Math.min(1, (1.4 - Math.abs(proj.x)) * 2.5) * Math.min(1, (1.4 - Math.abs(proj.y)) * 2.5)
      : 0;
    u.uIntensity.value += (edge * 0.85 - u.uIntensity.value) * 0.12;
  };
  return composer;
}
