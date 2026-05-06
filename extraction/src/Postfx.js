import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// 自製 Vignette + Grain + ColorGrade pass（塔可夫味道核心）
const TacticalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.85 },
    uGrain: { value: 0.012 },
    uContrast: { value: 1.10 },
    uSaturation: { value: 0.85 },
    uTint: { value: new THREE.Vector3(1.04, 1.0, 0.92) }, // 暖橘調
    uHurt: { value: 0.0 }, // 受傷時泛紅
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uContrast;
    uniform float uSaturation;
    uniform vec3 uTint;
    uniform float uHurt;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);

      // contrast / saturation
      vec3 c = col.rgb;
      c = (c - 0.5) * uContrast + 0.5;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, uSaturation);

      // tint
      c *= uTint;

      // vignette
      vec2 d = vUv - 0.5;
      float vig = 1.0 - dot(d, d) * uVignette;
      vig = clamp(vig, 0.0, 1.0);
      c *= mix(0.72, 1.0, vig);

      // film grain（cluster 在 ~4px 方塊，亮處乾淨）
      vec2 gp = floor(vUv * vec2(280.0, 175.0)) + floor(uTime * 14.0);
      float n = hash(gp) - 0.5;
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      float gMask = smoothstep(0.55, 0.05, lum);
      c += n * uGrain * gMask;

      // hurt pulse
      c.r += uHurt * 0.45;
      c.gb *= mix(1.0, 0.7, uHurt);

      // 微微暖底
      c += vec3(0.012, 0.008, 0.004);

      gl_FragColor = vec4(c, col.a);
    }
  `,
};

export function setupPostfx(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.setSize(window.innerWidth, window.innerHeight);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 槍口閃光、火星等高亮元素的 bloom
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.55, // strength
    0.7,  // radius
    0.85  // threshold（只讓很亮的東西有光暈）
  );
  composer.addPass(bloom);

  const tactical = new ShaderPass(TacticalShader);
  composer.addPass(tactical);

  const fxaa = new ShaderPass(FXAAShader);
  fxaa.material.uniforms['resolution'].value.set(
    1 / window.innerWidth,
    1 / window.innerHeight
  );
  composer.addPass(fxaa);

  const output = new OutputPass();
  composer.addPass(output);

  // 監聽 resize 重設 fxaa
  const onResize = () => {
    fxaa.material.uniforms['resolution'].value.set(
      1 / window.innerWidth,
      1 / window.innerHeight
    );
  };
  window.addEventListener('resize', onResize);

  // 給遊戲呼叫的 helper
  return {
    composer,
    bloom,
    tactical,
    setHurt(v) { tactical.uniforms.uHurt.value = v; },
    update(dt) {
      tactical.uniforms.uTime.value += dt;
      // hurt 衰減
      const h = tactical.uniforms.uHurt.value;
      if (h > 0) tactical.uniforms.uHurt.value = Math.max(0, h - dt * 1.5);
    },
  };
}
