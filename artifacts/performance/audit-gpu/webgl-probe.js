(() => {
  if (window.__MS_GPU_AUDIT__) return;
  const state = {
    version: "1.0.0",
    startedAt: performance.now(),
    nextCanvasId: 1,
    nextContextId: 1,
    animationFrames: 0,
    currentAnimationFrame: 0,
    contexts: [],
    canvasIds: new WeakMap(),
    contextByObject: new WeakMap(),
  };
  const isWebglName = (name) =>
    typeof name === "string" && /^(webgl|experimental-webgl|webgl2)$/i.test(name);
  const canvasId = (canvas) => {
    let id = state.canvasIds.get(canvas);
    if (!id) {
      id = `canvas-${state.nextCanvasId++}`;
      state.canvasIds.set(canvas, id);
    }
    return id;
  };
  const textureBytes = (gl, format, type) => {
    const channels =
      format === gl.RGBA || format === gl.RGBA_INTEGER
        ? 4
        : format === gl.RGB || format === gl.RGB_INTEGER
          ? 3
          : format === gl.RG || format === gl.RG_INTEGER || format === gl.LUMINANCE_ALPHA
            ? 2
            : 1;
    const scalarBytes =
      type === gl.FLOAT || type === gl.UNSIGNED_INT || type === gl.INT
        ? 4
        : type === gl.HALF_FLOAT || type === 0x8d61 || type === gl.UNSIGNED_SHORT || type === gl.SHORT
          ? 2
          : 1;
    if (
      type === gl.UNSIGNED_SHORT_5_6_5 ||
      type === gl.UNSIGNED_SHORT_4_4_4_4 ||
      type === gl.UNSIGNED_SHORT_5_5_5_1
    )
      return 2;
    return channels * scalarBytes;
  };
  const internalTextureBytes = (gl, internalFormat) => {
    if (
      internalFormat === gl.RGBA16F ||
      internalFormat === gl.RGBA16UI ||
      internalFormat === gl.RGBA16I
    )
      return 8;
    if (
      internalFormat === gl.RGBA32F ||
      internalFormat === gl.RGBA32UI ||
      internalFormat === gl.RGBA32I
    )
      return 16;
    if (internalFormat === gl.RGB16F) return 6;
    if (internalFormat === gl.RGB32F) return 12;
    return 4;
  };

  const currentTexture = (info, gl, target) => info.textureBindings.get(target) || null;

  const setTextureLevel = (info, texture, level, width, height, bytesPerPixel) => {
    if (!texture || !Number.isFinite(width) || !Number.isFinite(height)) return;
    const record = info.textures.get(texture);
    if (!record) return;
    record.levels.set(level, Math.max(0, Math.floor(width * height * bytesPerPixel)));
    record.estimatedBytes = [...record.levels.values()].reduce((total, value) => total + value, 0);
  };

  const addContextEvent = (info, type) => {
    info.events.push({ type, at: performance.now() });
    if (type === "webglcontextlost") info.lossEvents += 1;
    if (type === "webglcontextrestored") info.restoreEvents += 1;
  };

  const registerContext = (canvas, gl, kind) => {
    let info = state.contextByObject.get(gl);
    if (info) {
      info.getContextCalls += 1;
      return info;
    }
    info = {
      id: `context-${state.nextContextId++}`,
      canvas,
      canvasId: canvasId(canvas),
      kind,
      createdAt: performance.now(),
      getContextCalls: 1,
      events: [],
      lossEvents: 0,
      restoreEvents: 0,
      drawCalls: 0,
      triangles: 0,
      clearCalls: 0,
      programCreates: 0,
      programDeletes: 0,
      shaderCompiles: 0,
      programLinks: 0,
      textureCreates: 0,
      textureDeletes: 0,
      textures: new Map(),
      textureBindings: new Map(),
      programs: new WeakSet(),
      livePrograms: 0,
      framesWithDraws: new Set(),
      framesWithClears: new Set(),
      loseContextExtension: null,
      gl,
    };
    state.contexts.push(info);
    state.contextByObject.set(gl, info);
    canvas.addEventListener("webglcontextlost", () => addContextEvent(info, "webglcontextlost"));
    canvas.addEventListener("webglcontextrestored", () => addContextEvent(info, "webglcontextrestored"));
    return info;
  };

  const patch = (prototype, name, wrapper) => {
    if (!prototype || typeof prototype[name] !== "function") return;
    const original = prototype[name];
    prototype[name] = wrapper(original);
  };

  const registerPrototype = (prototype) => {
    patch(prototype, "drawArrays", (original) => function drawArrays(mode, first, count) {
      const info = state.contextByObject.get(this);
      if (info) recordDraw(info, mode, count, 1);
      return original.apply(this, arguments);
    });
    patch(prototype, "drawElements", (original) => function drawElements(mode, count) {
      const info = state.contextByObject.get(this);
      if (info) recordDraw(info, mode, count, 1);
      return original.apply(this, arguments);
    });
    patch(prototype, "drawArraysInstanced", (original) => function drawArraysInstanced(mode, first, count, instances) {
      const info = state.contextByObject.get(this);
      if (info) recordDraw(info, mode, count, instances);
      return original.apply(this, arguments);
    });
    patch(prototype, "drawElementsInstanced", (original) => function drawElementsInstanced(mode, count, type, offset, instances) {
      const info = state.contextByObject.get(this);
      if (info) recordDraw(info, mode, count, instances);
      return original.apply(this, arguments);
    });
    ["clear", "clearBufferfv", "clearBufferiv", "clearBufferuiv", "clearBufferfi"].forEach((name) =>
      patch(prototype, name, (original) => function clearProxy() {
        const info = state.contextByObject.get(this);
        if (info) {
          info.clearCalls += 1;
          info.framesWithClears.add(state.currentAnimationFrame);
        }
        return original.apply(this, arguments);
      }),
    );
    patch(prototype, "createShader", (original) => function createShaderProxy() {
      return original.apply(this, arguments);
    });
    patch(prototype, "compileShader", (original) => function compileShaderProxy() {
      const info = state.contextByObject.get(this);
      if (info) info.shaderCompiles += 1;
      return original.apply(this, arguments);
    });
    patch(prototype, "createProgram", (original) => function createProgramProxy() {
      const program = original.apply(this, arguments);
      const info = state.contextByObject.get(this);
      if (info && program) {
        info.programCreates += 1;
        info.livePrograms += 1;
        info.programs.add(program);
      }
      return program;
    });
    patch(prototype, "deleteProgram", (original) => function deleteProgramProxy(program) {
      const info = state.contextByObject.get(this);
      if (info && program && info.programs.has(program)) {
        info.programDeletes += 1;
        info.livePrograms = Math.max(0, info.livePrograms - 1);
      }
      return original.apply(this, arguments);
    });
    patch(prototype, "linkProgram", (original) => function linkProgramProxy() {
      const info = state.contextByObject.get(this);
      if (info) info.programLinks += 1;
      return original.apply(this, arguments);
    });
    patch(prototype, "createTexture", (original) => function createTextureProxy() {
      const texture = original.apply(this, arguments);
      const info = state.contextByObject.get(this);
      if (info && texture) {
        info.textureCreates += 1;
        info.textures.set(texture, { levels: new Map(), estimatedBytes: 0 });
      }
      return texture;
    });
    patch(prototype, "deleteTexture", (original) => function deleteTextureProxy(texture) {
      const info = state.contextByObject.get(this);
      if (info && texture && info.textures.delete(texture)) info.textureDeletes += 1;
      return original.apply(this, arguments);
    });
    patch(prototype, "bindTexture", (original) => function bindTextureProxy(target, texture) {
      const result = original.apply(this, arguments);
      const info = state.contextByObject.get(this);
      if (info) info.textureBindings.set(target, texture || null);
      return result;
    });
    patch(prototype, "texImage2D", (original) => function texImage2DProxy() {
      const args = Array.from(arguments);
      const info = state.contextByObject.get(this);
      if (info) {
        const target = args[0];
        const level = args[1];
        const width = typeof args[3] === "number" ? args[3] : args[5]?.videoWidth || args[5]?.naturalWidth || args[5]?.width;
        const height = typeof args[4] === "number" ? args[4] : args[5]?.videoHeight || args[5]?.naturalHeight || args[5]?.height;
        const format = typeof args[3] === "number" ? args[6] : args[3];
        const type = typeof args[3] === "number" ? args[7] : args[4];
        setTextureLevel(info, currentTexture(info, this, target), level, width, height, textureBytes(this, format, type));
      }
      return original.apply(this, arguments);
    });
    patch(prototype, "texStorage2D", (original) => function texStorage2DProxy(target, levels, internalFormat, width, height) {
      const info = state.contextByObject.get(this);
      if (info) {
        const texture = currentTexture(info, this, target);
        for (let level = 0; level < levels; level += 1) {
          setTextureLevel(info, texture, level, Math.max(1, width >> level), Math.max(1, height >> level), internalTextureBytes(this, internalFormat));
        }
      }
      return original.apply(this, arguments);
    });
    patch(prototype, "generateMipmap", (original) => function generateMipmapProxy(target) {
      const info = state.contextByObject.get(this);
      const texture = info && currentTexture(info, this, target);
      const record = texture && info?.textures.get(texture);
      if (record && record.levels.has(0) && record.levels.size === 1) {
        record.estimatedBytes = Math.ceil(record.levels.get(0) * 4 / 3);
      }
      return original.apply(this, arguments);
    });
  };

  const recordDraw = (info, mode, count, instances) => {
    const multiplier = Math.max(1, Number(instances) || 1);
    info.drawCalls += 1;
    info.framesWithDraws.add(state.currentAnimationFrame);
    const triangles = mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
    info.triangles += triangles * multiplier;
  };

  registerPrototype(window.WebGLRenderingContext?.prototype);
  registerPrototype(window.WebGL2RenderingContext?.prototype);

  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContextProxy(type) {
    const gl = originalGetContext.apply(this, arguments);
    if (gl && isWebglName(type)) registerContext(this, gl, String(type));
    return gl;
  };

  const animationTick = () => {
    state.animationFrames += 1;
    state.currentAnimationFrame = state.animationFrames;
    window.requestAnimationFrame(animationTick);
  };
  window.requestAnimationFrame(animationTick);

  const domRendererInfo = () => [...document.querySelectorAll("[data-three-render-triangles], [data-testid='foundry-camera-rig']")].map((element) => ({
    testId: element.getAttribute("data-testid"),
    renderer: element.getAttribute("data-three-renderer"),
    renderTriangles: element.getAttribute("data-three-render-triangles"),
    dynamicBuilds: element.getAttribute("data-three-dynamic-build-count"),
    geometryCacheSize: element.getAttribute("data-three-geometry-cache-size"),
    materialCacheSize: element.getAttribute("data-three-material-cache-size"),
    pixelRatioCap: element.getAttribute("data-three-pixel-ratio-cap"),
  }));

  const contextSnapshot = (info) => {
    const gl = info.gl;
    let renderer = null;
    let vendor = null;
    try {
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      if (debug) {
        renderer = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
        vendor = gl.getParameter(debug.UNMASKED_VENDOR_WEBGL);
      }
    } catch {}
    const estimatedTextureBytes = [...info.textures.values()].reduce((total, record) => total + record.estimatedBytes, 0);
    return {
      id: info.id,
      canvasId: info.canvasId,
      kind: info.kind,
      attached: document.contains(info.canvas),
      contextLost: Boolean(gl.isContextLost?.()),
      renderer,
      vendor,
      attributes: gl.getContextAttributes?.() || null,
      createdAtMs: Number((info.createdAt - state.startedAt).toFixed(3)),
      getContextCalls: info.getContextCalls,
      drawCalls: info.drawCalls,
      estimatedTriangles: info.triangles,
      clearCalls: info.clearCalls,
      framesWithDraws: info.framesWithDraws.size,
      framesWithClears: info.framesWithClears.size,
      shaderCompiles: info.shaderCompiles,
      programCreates: info.programCreates,
      programLinks: info.programLinks,
      programDeletes: info.programDeletes,
      livePrograms: info.livePrograms,
      textureCreates: info.textureCreates,
      textureDeletes: info.textureDeletes,
      liveTextures: info.textures.size,
      estimatedTextureBytes,
      events: info.events,
    };
  };

  const snapshot = () => {
    const contexts = state.contexts.map(contextSnapshot);
    const sum = (field) => contexts.reduce((total, value) => total + (value[field] || 0), 0);
    return {
      version: state.version,
      atMs: Number((performance.now() - state.startedAt).toFixed(3)),
      document: { visibilityState: document.visibilityState, hidden: document.hidden, hasFocus: document.hasFocus() },
      animationFrames: state.animationFrames,
      stage: document.querySelector("h2.current-stage-title")?.textContent?.trim() || "",
      canvases: [...document.querySelectorAll("canvas")].map((canvas) => ({ id: canvasId(canvas), width: canvas.width, height: canvas.height, attached: document.contains(canvas), className: canvas.className })),
      rendererInfoSamples: domRendererInfo(),
      contexts,
      totals: {
        trackedContexts: contexts.length,
        attachedContexts: contexts.filter((context) => context.attached).length,
        nonLostContexts: contexts.filter((context) => !context.contextLost).length,
        detachedNonLostContexts: contexts.filter((context) => !context.attached && !context.contextLost).length,
        drawCalls: sum("drawCalls"),
        estimatedTriangles: sum("estimatedTriangles"),
        clearCalls: sum("clearCalls"),
        shaderCompiles: sum("shaderCompiles"),
        programLinks: sum("programLinks"),
        livePrograms: sum("livePrograms"),
        liveTextures: sum("liveTextures"),
        estimatedTextureBytes: sum("estimatedTextureBytes"),
      },
    };
  };

  const activeContext = () => state.contexts.find((info) => document.contains(info.canvas) && !info.gl.isContextLost?.()) || null;

  const measureGpuFrame = async (timeoutMs = 1_500) => {
    const info = activeContext();
    if (!info) return { available: false, reason: "no-active-context" };
    const gl = info.gl;
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    if (!ext || !gl.createQuery) return { available: false, reason: "EXT_disjoint_timer_query_webgl2-unavailable", contextId: info.id };
    const query = gl.createQuery();
    try {
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
          const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
          const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT);
          gl.deleteQuery(query);
          return { available: !disjoint, contextId: info.id, disjoint, nanoseconds, milliseconds: nanoseconds / 1e6 };
        }
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      gl.deleteQuery(query);
      return { available: false, reason: "timer-query-timeout", contextId: info.id };
    } catch (error) {
      try { gl.deleteQuery(query); } catch {}
      return { available: false, reason: String(error), contextId: info.id };
    }
  };

  const forceContextLoss = () => {
    const info = activeContext();
    if (!info) return { available: false, reason: "no-active-context" };
    const extension = info.gl.getExtension("WEBGL_lose_context");
    if (!extension) return { available: false, reason: "WEBGL_lose_context-unavailable", contextId: info.id };
    info.loseContextExtension = extension;
    extension.loseContext();
    return { available: true, contextId: info.id };
  };

  const restoreContext = () => {
    const info = state.contexts.find((candidate) => candidate.loseContextExtension);
    if (!info) return { available: false, reason: "no-loss-extension" };
    info.loseContextExtension.restoreContext();
    return { available: true, contextId: info.id };
  };

  window.__MS_GPU_AUDIT__ = { snapshot, measureGpuFrame, forceContextLoss, restoreContext };
})();
