import * as THREE from 'three';
import gsap from 'gsap';

// ==========================================
// 1. IMAGES (Remy Shoots high-res photography)
// ==========================================
const IMAGES = [
  "/images/photo_1.webp",
  "/images/photo_2.webp",
  "/images/photo_3.webp",
  "/images/photo_4.webp",
  "/images/photo_5.webp",
  "/images/photo_6.webp",
  "/images/photo_7.webp",
  "/images/photo_8.webp",
  "/images/photo_9.webp",
  "/images/photo_10.webp",
  "/images/photo_11.webp",
  "/images/photo_12.webp",
  "/images/photo_13.webp",
  "/images/photo_14.webp",
  "/images/photo_15.webp",
  "/images/photo_16.webp"
];

// ==========================================
// 2. CONSTANTS & PARAMETERS
// ==========================================
const FISHEYE_CAM_Z = 10;
const FISHEYE_FOV = 48;
const CARD_ASPECT = 758 / 1116; // 0.6792 portrait aspect
const POOL_COUNT = 11; // recycled mesh cards

// ==========================================
// 3. SHADERS
// ==========================================

// Card Mesh Shader
const cardVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const cardFragmentShader = `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec4 uCoverUv;    // (scaleX, scaleY, offsetX, offsetY)
  uniform vec3 uParallax;   // (shiftX, shiftY, scale)
  uniform float uSat;       // 0.0 = B&W, 1.0 = Color
  uniform float uOpacity;   // fade level
  varying vec2 vUv;

  void main() {
    vec2 tileUv = (vUv - 0.5) * uParallax.z + 0.5 + uParallax.xy;
    vec2 finalUv = tileUv * uCoverUv.xy + uCoverUv.zw;
    vec4 tex = texture2D(uMap, finalUv);
    
    // Luminance desaturation
    float luma = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 col = mix(vec3(luma), tex.rgb, uSat);
    
    gl_FragColor = vec4(col, tex.a * uOpacity);
  }
`;

// Optical Fisheye Post-Processing Shader (From Remy Shoots)
const fisheyeVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fisheyeFragmentShader = `
  precision highp float;

  uniform samplerCube uScene;
  uniform vec2 uResolution;
  uniform float uAmount;
  uniform float uRadius;  // mirror sphere radius in px
  uniform float uFocal;   // perspective focal length in px
  varying vec2 vUv;

  // Exact optical radius calculation:
  // straight = uFocal * tan(theta)
  // curved = uRadius * sin(theta * 0.5)
  float radiusAt(float theta) {
    float straight = uFocal * tan(theta);
    float curved = uRadius * sin(theta * 0.5);
    return mix(straight, curved, uAmount);
  }

  const float THETA_MAX = 1.48;

  // Color grading from linear CubeTexture to display sRGB
  vec3 toDisplay(vec3 c) {
    return mix(
      pow(c, vec3(0.41666)) * 1.055 - vec3(0.055),
      c * 12.92,
      vec3(lessThanEqual(c, vec3(0.0031308)))
    );
  }

  void main() {
    vec2 px = (vUv - 0.5) * uResolution;
    float sr = length(px);

    // Center ray
    if (sr < 1e-4) {
      vec4 c = textureCube(uScene, vec3(0.0, 0.0, -1.0));
      gl_FragColor = vec4(toDisplay(c.rgb), c.a);
      return;
    }

    float maxR = radiusAt(THETA_MAX);

    // Circular lens aperture clipping
    if (sr > maxR) {
      gl_FragColor = vec4(0.7686, 0.7686, 0.7686, 1.0);
      return;
    }

    // Binary search for ray angle theta
    float lo = 0.0;
    float hi = THETA_MAX;
    for (int i = 0; i < 20; i++) {
      float mid = (lo + hi) * 0.5;
      if (radiusAt(mid) < sr) lo = mid; else hi = mid;
    }
    float theta = (lo + hi) * 0.5;

    // Camera looks down -Z into CubeMap
    vec3 dir = vec3(sin(theta) * (px / sr), -cos(theta));
    vec4 c = textureCube(uScene, dir);
    
    // Peripheral lens vignetting when curved
    float vig = smoothstep(maxR, maxR * 0.86, sr);
    vec3 col = mix(toDisplay(c.rgb) * mix(1.0, vig, uAmount * 0.4), vec3(0.7686), (1.0 - vig) * uAmount * 0.65);

    gl_FragColor = vec4(col, c.a);
  }
`;

// ==========================================
// 4. AUDIO HAPTICS (Remy Shoots Mechanical Tick)
// ==========================================
class CameraAudio {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.lastTickTime = 0;
    this.loadSound();
  }

  loadSound() {
    fetch('/tick.mp3')
      .then(res => res.arrayBuffer())
      .then(arrayBuffer => {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!this.ctx && AudioCtx) this.ctx = new AudioCtx();
        if (this.ctx) {
          this.ctx.decodeAudioData(arrayBuffer, decoded => {
            this.buffer = decoded;
          });
        }
      })
      .catch(e => console.warn('tick.mp3 load note:', e));
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTick(gainVal = 0.6) {
    this.init();
    if (!this.ctx || this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    if (now - this.lastTickTime < 0.02) return; // rate limit 20ms
    this.lastTickTime = now;

    if (this.buffer) {
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      source.buffer = this.buffer;
      gain.gain.value = gainVal;
      source.connect(gain);
      gain.connect(this.ctx.destination);
      source.start(now);
    } else {
      // Procedural synthetic tick fallback
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(850, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.015);
      gain.gain.setValueAtTime(gainVal * 0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.016);
    }
  }
}

// ==========================================
// 5. MAIN GALLERY CLASS
// ==========================================
class RemyGallery {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.audio = new CameraAudio();

    // Scroll & Physics State
    this.pos = 0;
    this.targetPos = 0;
    this.isDragging = false;
    this.startX = 0;
    this.lastX = 0;
    this.dragDistance = 0;
    this.snapTimeout = null;
    this.lastIntPos = 0;
    this.lastDetent = 0;

    // Fisheye State
    this.isFisheye = false;
    this.fisheyeAmount = 0.0; // 0.0 = Normal, 1.0 = Fisheye
    this.fisheyeTween = null;

    // Raycasting for card clicks
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Fisheye Button
    this.fisheyeBtn = document.getElementById('fisheye-btn');

    this.initThree();
    this.loadTextures();
    this.createCards();
    this.createFisheyePipeline();
    this.bindEvents();

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initThree() {
    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xc4c4c4, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xc4c4c4);

    this.camera = new THREE.PerspectiveCamera(FISHEYE_FOV, this.width / this.height, 0.1, 1000);
    this.camera.position.set(0, 0, FISHEYE_CAM_Z);
  }

  loadTextures() {
    const loader = new THREE.TextureLoader();
    this.textures = [];

    IMAGES.forEach((src, idx) => {
      const tex = loader.load(src, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = true;
        this.updateCardCover(idx);
      });
      this.textures.push(tex);
    });
  }

  getVisibleSize() {
    const aspect = this.width / Math.max(1, this.height);
    const visibleH = 2 * Math.tan(THREE.MathUtils.degToRad(FISHEYE_FOV * 0.5)) * FISHEYE_CAM_Z;
    return {
      visibleW: visibleH * aspect,
      visibleH: visibleH
    };
  }

  getCardDimensions() {
    const { visibleH } = this.getVisibleSize();
    const scale = 1.0 + 0.35 * this.fisheyeAmount;
    let cardH = visibleH * 0.74 * scale;
    if (this.width <= 760) {
      cardH = visibleH * 0.82 * scale;
    }
    const cardW = cardH * CARD_ASPECT;
    const spacing = cardW * 1.12;
    return { cardW, cardH, spacing };
  }

  createCards() {
    this.cardsGroup = new THREE.Group();
    this.scene.add(this.cardsGroup);

    this.cardMeshes = [];
    const geometry = new THREE.PlaneGeometry(1, 1);

    for (let i = 0; i < POOL_COUNT; i++) {
      const material = new THREE.ShaderMaterial({
        vertexShader: cardVertexShader,
        fragmentShader: cardFragmentShader,
        uniforms: {
          uMap: { value: this.textures[0] || null },
          uCoverUv: { value: new THREE.Vector4(1, 1, 0, 0) },
          uParallax: { value: new THREE.Vector3(0, 0, 0.88) },
          uSat: { value: 1.0 },
          uOpacity: { value: 1.0 }
        },
        transparent: true,
        depthWrite: false
      });

      const mesh = new THREE.Mesh(geometry, material);
      this.cardsGroup.add(mesh);
      this.cardMeshes.push({
        mesh,
        material,
        assignedIndex: -1,
        currentWrappedOffset: 0
      });
    }
  }

  updateCardCover(imgIndex) {
    const tex = this.textures[imgIndex];
    if (!tex || !tex.image) return;
    const imgW = tex.image.width || 1;
    const imgH = tex.image.height || 1;
    const imgAspect = imgW / imgH;

    const targetAspect = CARD_ASPECT;
    const scaleX = imgAspect > targetAspect ? targetAspect / imgAspect : 1;
    const scaleY = imgAspect > targetAspect ? 1 : imgAspect / targetAspect;
    const offsetX = (1 - scaleX) / 2;
    const offsetY = (1 - scaleY) / 2;

    this.cardMeshes.forEach(item => {
      if (item.assignedIndex === imgIndex) {
        item.material.uniforms.uCoverUv.value.set(scaleX, scaleY, offsetX, offsetY);
      }
    });
  }

  createFisheyePipeline() {
    this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(1024, {
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    });
    this.cubeRenderTarget.texture.colorSpace = THREE.SRGBColorSpace;

    this.cubeCamera = new THREE.CubeCamera(0.1, 1000, this.cubeRenderTarget);
    this.cubeCamera.position.copy(this.camera.position);

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.Camera();

    this.lensMaterial = new THREE.ShaderMaterial({
      vertexShader: fisheyeVertexShader,
      fragmentShader: fisheyeFragmentShader,
      uniforms: {
        uScene: { value: this.cubeRenderTarget.texture },
        uResolution: { value: new THREE.Vector2(this.width, this.height) },
        uAmount: { value: 0.0 },
        uRadius: { value: 0.86 * Math.hypot(this.width, this.height) },
        uFocal: { value: this.height / (2.0 * Math.tan(THREE.MathUtils.degToRad(FISHEYE_FOV * 0.5))) }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lensMaterial);
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  bindEvents() {
    window.addEventListener('resize', () => this.onResize());

    const onDown = (clientX) => {
      this.audio.init();
      this.isDragging = true;
      this.startX = clientX;
      this.lastX = clientX;
      this.dragDistance = 0;
      if (this.snapTimeout) clearTimeout(this.snapTimeout);
    };

    const onMove = (clientX) => {
      if (!this.isDragging) return;
      const delta = clientX - this.lastX;
      this.lastX = clientX;
      this.dragDistance += Math.abs(delta);

      const { cardW } = this.getCardDimensions();
      const pxPerCard = (cardW / this.getVisibleSize().visibleW) * this.width;
      const shift = delta / (pxPerCard * 1.15);

      this.targetPos -= shift;
      this.pos -= shift * 0.95;
    };

    const onUp = (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;

      if (this.dragDistance < 8 && e) {
        this.handleCardClick(e.clientX, e.clientY);
      } else {
        this.scheduleSnap(80);
      }
    };

    // Pointer events
    this.container.addEventListener('pointerdown', (e) => onDown(e.clientX));
    window.addEventListener('pointermove', (e) => onMove(e.clientX));
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    // Wheel Scroll
    window.addEventListener('wheel', (e) => {
      this.audio.init();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.targetPos += delta * 0.0022;
      this.scheduleSnap(200);
    }, { passive: true });

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      this.audio.init();
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        this.targetPos = Math.round(this.targetPos) + 1;
        this.scheduleSnap(40);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        this.targetPos = Math.round(this.targetPos) - 1;
        this.scheduleSnap(40);
      }
    });

    // Fisheye Toggle Button
    this.fisheyeBtn.addEventListener('click', () => this.toggleFisheye());
  }

  handleCardClick(clientX, clientY) {
    if (this.fisheyeAmount > 0.5) {
      const halfW = this.width / 2;
      if (clientX < halfW - 120) {
        this.targetPos = Math.round(this.targetPos) - 1;
        this.audio.playTick(0.7);
      } else if (clientX > halfW + 120) {
        this.targetPos = Math.round(this.targetPos) + 1;
        this.audio.playTick(0.7);
      }
      return;
    }

    this.mouse.x = (clientX / this.width) * 2 - 1;
    this.mouse.y = -(clientY / this.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const meshes = this.cardMeshes.map(c => c.mesh);
    const intersects = this.raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
      const hitMesh = intersects[0].object;
      const cardItem = this.cardMeshes.find(c => c.mesh === hitMesh);
      if (cardItem) {
        const offset = Math.round(cardItem.currentWrappedOffset);
        if (Math.abs(offset) > 0) {
          this.targetPos = Math.round(this.pos) + offset;
          this.audio.playTick(0.7);
        }
      }
    }
  }

  scheduleSnap(delay = 150) {
    if (this.snapTimeout) clearTimeout(this.snapTimeout);
    this.snapTimeout = setTimeout(() => {
      this.targetPos = Math.round(this.targetPos);
    }, delay);
  }

  toggleFisheye() {
    this.audio.init();
    this.audio.playTick(0.85);

    this.isFisheye = !this.isFisheye;
    const targetAmount = this.isFisheye ? 1.0 : 0.0;

    // Update Button
    this.fisheyeBtn.classList.toggle('is-active', this.isFisheye);
    this.fisheyeBtn.setAttribute('aria-pressed', String(this.isFisheye));
    this.fisheyeBtn.innerHTML = this.isFisheye
      ? '<span class="btn-text">FISHEYE: [ON]</span>'
      : '<span class="btn-text">FISHEYE: [OFF]</span>';

    // GSAP Morph Animation
    if (this.fisheyeTween) this.fisheyeTween.kill();
    this.fisheyeTween = gsap.to(this, {
      fisheyeAmount: targetAmount,
      duration: 1.4,
      ease: 'power2.inOut',
      onUpdate: () => {
        this.lensMaterial.uniforms.uAmount.value = this.fisheyeAmount;
      }
    });
  }

  onResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    this.lensMaterial.uniforms.uResolution.value.set(this.width, this.height);
    this.lensMaterial.uniforms.uRadius.value = 0.86 * Math.hypot(this.width, this.height);
    this.lensMaterial.uniforms.uFocal.value = this.height / (2.0 * Math.tan(THREE.MathUtils.degToRad(FISHEYE_FOV * 0.5)));
  }

  animate() {
    requestAnimationFrame(this.animate);

    // Lerp towards target
    this.pos += (this.targetPos - this.pos) * 0.12;

    // Scrolling Sound Haptics:
    // 1. Major card boundary clicks
    const currentIntPos = Math.round(this.pos);
    if (currentIntPos !== this.lastIntPos) {
      this.lastIntPos = currentIntPos;
      this.audio.playTick(0.7);
    }
    // 2. Micro dial detent ticks when moving
    const currentDetent = Math.floor(this.pos * 3.5);
    if (currentDetent !== this.lastDetent) {
      this.lastDetent = currentDetent;
      if (Math.abs(this.targetPos - this.pos) > 0.02) {
        this.audio.playTick(0.35);
      }
    }

    // Update 3D cards
    const { cardW, cardH, spacing } = this.getCardDimensions();
    const halfPool = Math.floor(POOL_COUNT / 2);
    const totalImages = IMAGES.length;

    this.cardMeshes.forEach((item, slotIndex) => {
      const slotOffset = slotIndex - halfPool;
      const wrappedOffset = THREE.MathUtils.euclideanModulo((slotOffset - this.pos) + halfPool, POOL_COUNT) - halfPool;
      item.currentWrappedOffset = wrappedOffset;

      const posX = wrappedOffset * spacing;
      item.mesh.position.set(posX, 0, 0);
      item.mesh.scale.set(cardW, cardH, 1);

      const imgIndex = THREE.MathUtils.euclideanModulo(Math.round(this.pos + wrappedOffset), totalImages);
      if (item.assignedIndex !== imgIndex) {
        item.assignedIndex = imgIndex;
        item.material.uniforms.uMap.value = this.textures[imgIndex];
        this.updateCardCover(imgIndex);
      }

      // Center active focus
      const distFromCenter = Math.abs(wrappedOffset);
      const centerFactor = Math.max(0, 1.0 - distFromCenter * 0.85);

      const saturation = Math.pow(centerFactor, 1.2);
      const opacity = 0.42 + 0.58 * centerFactor;

      item.material.uniforms.uSat.value = saturation;
      item.material.uniforms.uOpacity.value = opacity;

      const parallaxX = THREE.MathUtils.clamp(-wrappedOffset * 0.04, -0.08, 0.08);
      item.material.uniforms.uParallax.value.x = parallaxX;
    });

    // Render pipeline
    if (this.fisheyeAmount > 0.0001) {
      this.cubeCamera.position.copy(this.camera.position);
      this.cubeCamera.update(this.renderer, this.scene);
      this.renderer.render(this.postScene, this.postCamera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

// Start
window.addEventListener('DOMContentLoaded', () => {
  new RemyGallery();
});
