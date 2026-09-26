/* SpinDownGames coin viewer. No CDN, framework, account, or build step required.
   The small GLB reader below intentionally supports only this asset's one indexed,
   uncompressed mesh. Replace it with a general glTF loader for complex future scenes. */
(() => {
  'use strict';
  const stage = document.getElementById('coin-stage');
  const canvas = document.getElementById('coin-canvas');
  const toggle = document.getElementById('coin-toggle');
  const instructions = document.getElementById('coin-instructions');
  if (!stage || !canvas || !toggle || !instructions) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const FULL_TURN_SECONDS = 20;
  const FRAME_INTERVAL_MS = 1000 / 30;
  let paused = reducedMotion.matches;
  let visible = true;
  let ready = false;
  let frame = 0;
  let lastTime = 0;
  let pitch = 0;
  let yaw = 0.12;
  let draw = () => {};
  let resize = () => {};
  let observer;

  function fail() {
    ready = false;
    stop();
    stage.dataset.state = 'fallback';
    canvas.hidden = true;
    toggle.hidden = true;
    instructions.textContent = 'SpinDownGames coin · still preview';
    observer?.disconnect();
  }
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }
  function syncAnimation() {
    stop();
    toggle.textContent = paused ? 'Start rotation' : 'Pause rotation';
    if (ready && !paused && visible && !document.hidden) frame = requestAnimationFrame(animate);
  }
  function animate(time) {
    if (!ready || paused || !visible || document.hidden) { stop(); return; }
    const delta = lastTime ? time - lastTime : FRAME_INTERVAL_MS;
    if (delta >= FRAME_INTERVAL_MS - 1) {
      // Cap the step so returning from another tab cannot jump the coin.
      // Turn sideways around the vertical Y axis; never flip end over end.
      yaw = (yaw + Math.min(delta, 100) / 1000 * Math.PI * 2 / FULL_TURN_SECONDS) % (Math.PI * 2);
      draw();
      lastTime = time;
    }
    frame = requestAnimationFrame(animate);
  }

  // Read the position/normal/index accessors of the accompanying GLB, with bounds checks.
  function readMesh(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 28 || view.getUint32(0, true) !== 0x46546c67 ||
        view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
      throw new Error('Not a supported GLB file.');
    }
    let json, binaryOffset = 0, binaryLength = 0;
    for (let at = 12; at + 8 <= buffer.byteLength;) {
      const length = view.getUint32(at, true);
      const type = view.getUint32(at + 4, true);
      at += 8;
      if (at + length > buffer.byteLength) throw new Error('Truncated GLB.');
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, at, length)));
      if (type === 0x004e4942) { binaryOffset = at; binaryLength = length; }
      at += length;
    }
    const primitive = json?.meshes?.[0]?.primitives?.[0];
    if (!primitive || !binaryOffset || (primitive.mode !== undefined && primitive.mode !== 4)) {
      throw new Error('Missing triangle mesh.');
    }
    function accessor(id, type, componentType, ArrayType, width) {
      const item = json.accessors[id];
      const region = json.bufferViews[item?.bufferView];
      if (!item || !region || item.sparse || region.byteStride || item.type !== type ||
          item.componentType !== componentType || region.buffer !== 0 || !Number.isInteger(item.count) || item.count < 1) {
        throw new Error('Unsupported GLB accessor.');
      }
      const offset = (region.byteOffset || 0) + (item.byteOffset || 0);
      const length = item.count * width;
      if (offset < 0 || offset % ArrayType.BYTES_PER_ELEMENT ||
          offset + length * ArrayType.BYTES_PER_ELEMENT > binaryLength ||
          (item.byteOffset || 0) + length * ArrayType.BYTES_PER_ELEMENT > region.byteLength) {
        throw new Error('Invalid GLB data range.');
      }
      return new ArrayType(buffer, binaryOffset + offset, length);
    }
    const positions = accessor(primitive.attributes.POSITION, 'VEC3', 5126, Float32Array, 3);
    const normals = accessor(primitive.attributes.NORMAL, 'VEC3', 5126, Float32Array, 3);
    const indexType = json.accessors[primitive.indices].componentType;
    const indices = indexType === 5123
      ? accessor(primitive.indices, 'SCALAR', 5123, Uint16Array, 1)
      : accessor(primitive.indices, 'SCALAR', 5125, Uint32Array, 1);
    if (positions.length !== normals.length || indices.length % 3) throw new Error('Mismatched mesh data.');
    for (const i of indices) if (i >= positions.length / 3) throw new Error('Invalid mesh index.');
    for (const value of positions) if (!Number.isFinite(value)) throw new Error('Invalid vertex.');
    for (const value of normals) if (!Number.isFinite(value)) throw new Error('Invalid normal.');
    return { positions, normals, indices, indexType };
  }

  const vertexSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat3 uRotation;
    uniform float uAspect;
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      vec3 p = uRotation * aPosition;
      vPosition = p;
      vNormal = uRotation * aNormal;
      p.z -= 2.95;
      float f = 2.41421356;
      float n = 0.1;
      float far = 20.0;
      gl_Position = vec4(p.x * f / uAspect, p.y * f,
        (far + n) / (n - far) * p.z + 2.0 * far * n / (n - far), -p.z);
    }`;
  const fragmentSource = `
    precision mediump float;
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      vec3 n = normalize(vNormal);
      vec3 v = normalize(vec3(0.0, 0.0, 2.95) - vPosition);
      vec3 key = normalize(vec3(-2.5, 2.6, 3.0) - vPosition);
      vec3 fill = normalize(vec3(2.8, -0.6, 2.2) - vPosition);
      vec3 edge = normalize(vec3(-1.4, -3.0, 1.2));
      float diffuse = 0.06 + 0.65 * max(dot(n, key), 0.0) + 0.12 * max(dot(n, fill), 0.0);
      vec3 color = vec3(0.42, 0.44, 0.49) * diffuse;
      color += vec3(0.94, 0.94, 1.0) * pow(max(dot(n, normalize(key + v)), 0.0), 65.0) * 0.85;
      color += vec3(0.80, 0.89, 1.0) * pow(max(dot(n, normalize(fill + v)), 0.0), 42.0) * 0.40;
      color += vec3(0.09, 0.16, 0.27) * max(dot(n, edge), 0.0);
      vec3 reflected = reflect(-v, n);
      float studio = pow(max(dot(reflected, normalize(vec3(-0.8, 0.7, 1.0))), 0.0), 14.0);
      color += vec3(0.40, 0.42, 0.47) * studio;
      color = color / (color + vec3(0.50));
      color = pow(color, vec3(1.0 / 2.2));
      gl_FragColor = vec4(color, 1.0);
    }`;

  async function start() {
    const gl = canvas.getContext('webgl', {
      alpha: true, antialias: true, premultipliedAlpha: false, powerPreference: 'low-power'
    });
    if (!gl) { fail(); return; }
    stage.dataset.state = 'loading';
    instructions.textContent = 'Loading 3D coin…';
    let data;
    // The downloadable one-file preview embeds the very same GLB. The normal site fetches it.
    const embedded = document.getElementById('coin-model-data');
    if (embedded) {
      data = Uint8Array.from(atob(embedded.textContent.trim()), c => c.charCodeAt(0)).buffer;
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      try {
        const response = await fetch(new URL(stage.dataset.model, document.baseURI), { signal: controller.signal });
        if (!response.ok) throw new Error('Coin model could not be loaded.');
        data = await response.arrayBuffer();
      } finally { clearTimeout(timeout); }
    }
    const mesh = readMesh(data);
    if (mesh.indexType === 5125 && !gl.getExtension('OES_element_index_uint')) throw new Error('32-bit mesh indices unavailable.');

    function shader(type, source) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(message);
      }
      return s;
    }
    const vertex = shader(gl.VERTEX_SHADER, vertexSource);
    const fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Coin shader could not link.');
    gl.useProgram(program);
    for (const [name, array] of [['aPosition', mesh.positions], ['aNormal', mesh.normals]]) {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
      const attribute = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 0, 0);
    }
    const elements = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elements);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    const uRotation = gl.getUniformLocation(program, 'uRotation');
    const uAspect = gl.getUniformLocation(program, 'uAspect');
    const rotation = new Float32Array(9);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);

    draw = () => {
      if (!ready || document.hidden) return;
      const cx = Math.cos(pitch), sx = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
      // Column-major Ry * Rx. Autoplay changes only yaw, keeping the coin
      // upright while its front, edge, and back turn past the camera.
      // Pitch is optional manual tilt, not part of automatic rotation.
      rotation.set([
        cy, 0, -sy,
        sy * sx, cx, cy * sx,
        sy * cx, -sx, cy * cx
      ]);
      gl.uniformMatrix3fv(uRotation, false, rotation);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, mesh.indexType, 0);
    };
    resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const bounds = stage.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(uAspect, canvas.width / canvas.height);
      draw();
    };
    ready = true;
    canvas.hidden = false;
    toggle.hidden = false;
    stage.dataset.state = 'ready';
    instructions.textContent = 'Drag to turn · arrow keys too';
    resize();
    if ('ResizeObserver' in window) { observer = new ResizeObserver(resize); observer.observe(stage); }
    else window.addEventListener('resize', resize);
    syncAnimation();
  }

  toggle.addEventListener('click', () => { paused = !paused; syncAnimation(); });
  reducedMotion.addEventListener('change', event => { paused = event.matches; syncAnimation(); });
  document.addEventListener('visibilitychange', syncAnimation);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', () => { if (ready) { resize(); syncAnimation(); } });
  if ('IntersectionObserver' in window) {
    const visibilityObserver = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting; syncAnimation();
    }, { threshold: 0.05 });
    visibilityObserver.observe(stage);
  }
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fail(); });
  canvas.addEventListener('keydown', event => {
    if (!ready) return;
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault(); paused = !paused; syncAnimation(); return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault(); paused = true; syncAnimation();
    if (event.key === 'ArrowLeft') yaw -= 0.22;
    if (event.key === 'ArrowRight') yaw += 0.22;
    if (event.key === 'ArrowUp') pitch -= 0.22;
    if (event.key === 'ArrowDown') pitch += 0.22;
    if (event.key === 'Home') { pitch = 0; yaw = 0.12; }
    draw();
  });
  let drag;
  canvas.addEventListener('pointerdown', event => {
    if (!ready || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, pitch, yaw, active: false, mouse: event.pointerType === 'mouse' };
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.active) {
      // Preserve vertical page scrolling on phones; horizontal gestures turn the coin.
      if (Math.abs(dx) < 6 && (!drag.mouse || Math.abs(dy) < 6)) return;
      if (!drag.mouse && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      drag.active = true; canvas.setPointerCapture(event.pointerId); paused = true; syncAnimation();
    }
    yaw = drag.yaw + dx * .012;
    if (drag.mouse) pitch = drag.pitch + dy * .012;
    draw();
  });
  function finishDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    drag = null;
  }
  canvas.addEventListener('pointerup', finishDrag);
  canvas.addEventListener('pointercancel', finishDrag);
  canvas.addEventListener('lostpointercapture', () => { drag = null; });

  // Keep the model off the initial page load. Fetch it as the visitor approaches.
  function loadCoin() {
    start().catch(error => { console.warn('Showing still coin preview:', error.message); fail(); });
  }
  if ('IntersectionObserver' in window) {
    const loader = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      loader.disconnect();
      loadCoin();
    }, { rootMargin: '300px' });
    loader.observe(stage);
  } else loadCoin();
})();
