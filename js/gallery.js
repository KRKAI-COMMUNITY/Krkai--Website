/* ============================================
   KRKAI — Globe Gallery
   Normal grid view; long-press+drag activates 3D globe
   Images auto-discovered from gallery/ folder
   ============================================ */

(function() {
  'use strict';

  /* ---- GLSL shaders (verbatim from ReactBits InfiniteMenu) ---- */
  var DISC_VERT = `#version 300 es
uniform mat4 uWorldMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform vec3 uCameraPosition;
uniform vec4 uRotationAxisVelocity;
in vec3 aModelPosition;
in vec3 aModelNormal;
in vec2 aModelUvs;
in mat4 aInstanceMatrix;
out vec2 vUvs;
out float vAlpha;
flat out int vInstanceId;
#define PI 3.141593
void main() {
    vec4 worldPosition = uWorldMatrix * aInstanceMatrix * vec4(aModelPosition, 1.);
    vec3 centerPos = (uWorldMatrix * aInstanceMatrix * vec4(0., 0., 0., 1.)).xyz;
    float radius = length(centerPos.xyz);
    if (gl_VertexID > 0) {
        vec3 rotationAxis = uRotationAxisVelocity.xyz;
        float rotationVelocity = min(.15, uRotationAxisVelocity.w * 15.);
        vec3 stretchDir = normalize(cross(centerPos, rotationAxis));
        vec3 relativeVertexPos = normalize(worldPosition.xyz - centerPos);
        float strength = dot(stretchDir, relativeVertexPos);
        float invAbsStrength = min(0., abs(strength) - 1.);
        strength = rotationVelocity * sign(strength) * abs(invAbsStrength * invAbsStrength * invAbsStrength + 1.);
        worldPosition.xyz += stretchDir * strength;
    }
    worldPosition.xyz = radius * normalize(worldPosition.xyz);
    gl_Position = uProjectionMatrix * uViewMatrix * worldPosition;
    vAlpha = smoothstep(0.5, 1., normalize(worldPosition.xyz).z) * .9 + .1;
    vUvs = aModelUvs;
    vInstanceId = gl_InstanceID;
}`;

  var DISC_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform int uItemCount;
uniform int uAtlasSize;
out vec4 outColor;
in vec2 vUvs;
in float vAlpha;
flat in int vInstanceId;
void main() {
    int itemIndex = vInstanceId % uItemCount;
    int cellsPerRow = uAtlasSize;
    int cellX = itemIndex % cellsPerRow;
    int cellY = itemIndex / cellsPerRow;
    vec2 cellSize = vec2(1.0) / vec2(float(cellsPerRow));
    vec2 cellOffset = vec2(float(cellX), float(cellY)) * cellSize;
    ivec2 texSize = textureSize(uTex, 0);
    float imageAspect = float(texSize.x) / float(texSize.y);
    float containerAspect = 1.0;
    float scale = max(imageAspect / containerAspect, containerAspect / imageAspect);
    vec2 st = vec2(vUvs.x, 1.0 - vUvs.y);
    st = (st - 0.5) * scale + 0.5;
    st = clamp(st, 0.0, 1.0);
    st = st * cellSize + cellOffset;
    outColor = texture(uTex, st);
    outColor.a *= vAlpha;
}`;

  /* ---- gl-matrix aliases (set after window.glMatrix is available) ---- */
  var mat4, quat, vec2, vec3;

  /* ---- Geometry helpers ---- */
  function Face(a, b, c) { this.a = a; this.b = b; this.c = c; }

  function Vertex(x, y, z) {
    this.position = vec3.fromValues(x, y, z);
    this.normal   = vec3.create();
    this.uv       = vec2.create();
  }

  function Geometry() { this.vertices = []; this.faces = []; }
  Geometry.prototype.addVertex = function() {
    for (var i = 0; i < arguments.length; i += 3)
      this.vertices.push(new Vertex(arguments[i], arguments[i+1], arguments[i+2]));
    return this;
  };
  Geometry.prototype.addFace = function() {
    for (var i = 0; i < arguments.length; i += 3)
      this.faces.push(new Face(arguments[i], arguments[i+1], arguments[i+2]));
    return this;
  };
  Object.defineProperty(Geometry.prototype, 'lastVertex', { get: function() { return this.vertices[this.vertices.length-1]; } });
  Geometry.prototype.subdivide = function(divisions) {
    divisions = divisions || 1;
    var cache = {}, f = this.faces;
    for (var d = 0; d < divisions; d++) {
      var nf = new Array(f.length * 4);
      var self = this;
      f.forEach(function(face, ndx) {
        var mAB = self.getMidPoint(face.a, face.b, cache);
        var mBC = self.getMidPoint(face.b, face.c, cache);
        var mCA = self.getMidPoint(face.c, face.a, cache);
        var i = ndx * 4;
        nf[i+0] = new Face(face.a, mAB, mCA);
        nf[i+1] = new Face(face.b, mBC, mAB);
        nf[i+2] = new Face(face.c, mCA, mBC);
        nf[i+3] = new Face(mAB, mBC, mCA);
      });
      f = nf;
    }
    this.faces = f; return this;
  };
  Geometry.prototype.spherize = function(radius) {
    radius = radius || 1;
    this.vertices.forEach(function(v) {
      vec3.normalize(v.normal, v.position);
      vec3.scale(v.position, v.normal, radius);
    });
    return this;
  };
  Geometry.prototype.getMidPoint = function(a, b, cache) {
    var key = a < b ? 'k_'+b+'_'+a : 'k_'+a+'_'+b;
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    var pa = this.vertices[a].position, pb = this.vertices[b].position;
    var ndx = this.vertices.length;
    cache[key] = ndx;
    this.addVertex((pa[0]+pb[0])*0.5, (pa[1]+pb[1])*0.5, (pa[2]+pb[2])*0.5);
    return ndx;
  };
  Object.defineProperty(Geometry.prototype, 'vertexData',  { get: function() { return new Float32Array(this.vertices.flatMap(function(v){ return Array.from(v.position); })); } });
  Object.defineProperty(Geometry.prototype, 'normalData',  { get: function() { return new Float32Array(this.vertices.flatMap(function(v){ return Array.from(v.normal); })); } });
  Object.defineProperty(Geometry.prototype, 'uvData',      { get: function() { return new Float32Array(this.vertices.flatMap(function(v){ return Array.from(v.uv); })); } });
  Object.defineProperty(Geometry.prototype, 'indexData',   { get: function() { return new Uint16Array(this.faces.flatMap(function(f){ return [f.a, f.b, f.c]; })); } });
  Object.defineProperty(Geometry.prototype, 'data', { get: function() {
    return { vertices: this.vertexData, indices: this.indexData, normals: this.normalData, uvs: this.uvData };
  }});

  function IcosahedronGeometry() {
    Geometry.call(this);
    var t = Math.sqrt(5)*0.5+0.5;
    this.addVertex(
      -1,t,0, 1,t,0, -1,-t,0, 1,-t,0,
       0,-1,t, 0,1,t, 0,-1,-t, 0,1,-t,
       t,0,-1, t,0,1, -t,0,-1, -t,0,1
    ).addFace(
      0,11,5, 0,5,1, 0,1,7, 0,7,10, 0,10,11,
      1,5,9, 5,11,4, 11,10,2, 10,7,6, 7,1,8,
      3,9,4, 3,4,2, 3,2,6, 3,6,8, 3,8,9,
      4,9,5, 2,4,11, 6,2,10, 8,6,7, 9,8,1
    );
  }
  IcosahedronGeometry.prototype = Object.create(Geometry.prototype);

  function DiscGeometry(steps, radius) {
    Geometry.call(this);
    steps = Math.max(4, steps || 4);
    radius = radius || 1;
    var alpha = (2*Math.PI)/steps;
    this.addVertex(0,0,0);
    this.lastVertex.uv[0] = 0.5; this.lastVertex.uv[1] = 0.5;
    for (var i = 0; i < steps; i++) {
      var x = Math.cos(alpha*i), y = Math.sin(alpha*i);
      this.addVertex(radius*x, radius*y, 0);
      this.lastVertex.uv[0] = x*0.5+0.5; this.lastVertex.uv[1] = y*0.5+0.5;
      if (i > 0) this.addFace(0, i, i+1);
    }
    this.addFace(0, steps, 1);
  }
  DiscGeometry.prototype = Object.create(Geometry.prototype);

  /* ---- WebGL helpers ---- */
  function createShader(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
    console.error(gl.getShaderInfoLog(s)); gl.deleteShader(s); return null;
  }
  function createProgram(gl, srcs, tfv, attribLocs) {
    var p = gl.createProgram();
    [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].forEach(function(type, ndx) {
      var s = createShader(gl, type, srcs[ndx]);
      if (s) gl.attachShader(p, s);
    });
    if (tfv) gl.transformFeedbackVaryings(p, tfv, gl.SEPARATE_ATTRIBS);
    if (attribLocs) for (var a in attribLocs) gl.bindAttribLocation(p, attribLocs[a], a);
    gl.linkProgram(p);
    if (gl.getProgramParameter(p, gl.LINK_STATUS)) return p;
    console.error(gl.getProgramInfoLog(p)); gl.deleteProgram(p); return null;
  }
  function makeBuffer(gl, data, usage) {
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return buf;
  }
  function makeVAO(gl, pairs, indices) {
    var va = gl.createVertexArray(); gl.bindVertexArray(va);
    pairs.forEach(function(pair) {
      var buf = pair[0], loc = pair[1], nel = pair[2];
      if (loc === -1) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, nel, gl.FLOAT, false, 0, 0);
    });
    if (indices) {
      var ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    }
    gl.bindVertexArray(null); return va;
  }
  function setupTex(gl, minF, magF, wS, wT) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minF);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magF);
    return t;
  }
  function resizeCanvas(canvas) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.round(canvas.clientWidth * dpr);
    var h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h; return true;
    }
    return false;
  }

  /* ---- ArcballControl ---- */
  function ArcballControl(canvas, updateCb) {
    this.canvas = canvas;
    this.updateCallback = updateCb || function(){};
    this.isPointerDown = false;
    this.orientation = quat.create();
    this.pointerRotation = quat.create();
    this.rotationVelocity = 0;
    this.rotationAxis = vec3.fromValues(1,0,0);
    this.snapDirection = vec3.fromValues(0,0,-1);
    this.snapTargetDirection = null;
    this.EPSILON = 0.1;
    this.IDENTITY_QUAT = quat.create();
    this.pointerPos = vec2.create();
    this.previousPointerPos = vec2.create();
    this._rotationVelocity = 0;
    this._combinedQuat = quat.create();

    var self = this;
    canvas.addEventListener('pointerdown', function(e) {
      vec2.set(self.pointerPos, e.clientX, e.clientY);
      vec2.copy(self.previousPointerPos, self.pointerPos);
      self.isPointerDown = true;
    });
    canvas.addEventListener('pointerup', function() { self.isPointerDown = false; });
    canvas.addEventListener('pointerleave', function() { self.isPointerDown = false; });
    canvas.addEventListener('pointermove', function(e) {
      if (self.isPointerDown) vec2.set(self.pointerPos, e.clientX, e.clientY);
    });
    canvas.style.touchAction = 'none';
  }
  ArcballControl.prototype._project = function(pos) {
    var r = 2;
    var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    var s = Math.max(w, h) - 1;
    var x = (2*pos[0]-w-1)/s, y = (2*pos[1]-h-1)/s, z = 0;
    var xySq = x*x + y*y, rSq = r*r;
    z = xySq <= rSq/2 ? Math.sqrt(rSq-xySq) : rSq/Math.sqrt(xySq);
    return vec3.fromValues(-x, y, z);
  };
  ArcballControl.prototype.quatFromVectors = function(a, b, out, angleFactor) {
    angleFactor = angleFactor || 1;
    var axis = vec3.cross(vec3.create(), a, b);
    vec3.normalize(axis, axis);
    var d = Math.max(-1, Math.min(1, vec3.dot(a, b)));
    var angle = Math.acos(d) * angleFactor;
    quat.setAxisAngle(out, axis, angle);
    return { q: out, axis: axis, angle: angle };
  };
  ArcballControl.prototype.update = function(deltaTime, targetFrameDuration) {
    targetFrameDuration = targetFrameDuration || 16;
    var timeScale = deltaTime / targetFrameDuration + 0.00001;
    var angleFactor = timeScale;
    var snapRotation = quat.create();

    if (this.isPointerDown) {
      var INTENSITY = 0.3 * timeScale;
      var ANGLE_AMPLIFICATION = 5 / timeScale;
      var midPos = vec2.sub(vec2.create(), this.pointerPos, this.previousPointerPos);
      vec2.scale(midPos, midPos, INTENSITY);
      if (vec2.sqrLen(midPos) > this.EPSILON) {
        vec2.add(midPos, this.previousPointerPos, midPos);
        var p = this._project(midPos);
        var q = this._project(this.previousPointerPos);
        var a = vec3.normalize(vec3.create(), p);
        var b = vec3.normalize(vec3.create(), q);
        vec2.copy(this.previousPointerPos, midPos);
        angleFactor *= ANGLE_AMPLIFICATION;
        this.quatFromVectors(a, b, this.pointerRotation, angleFactor);
      } else {
        var DECAY = 0.1 * timeScale;
        quat.slerp(this.pointerRotation, this.pointerRotation, this.IDENTITY_QUAT, DECAY);
      }
    } else {
      quat.slerp(this.pointerRotation, this.pointerRotation, this.IDENTITY_QUAT, 0.1*timeScale);
      if (this.snapTargetDirection) {
        var SNAP = 0.2;
        var sa = this.snapTargetDirection, sb = this.snapDirection;
        var sqrDist = vec3.squaredDistance(sa, sb);
        var distFactor = Math.max(0.1, 1 - sqrDist*10);
        angleFactor *= SNAP * distFactor;
        this.quatFromVectors(sa, sb, snapRotation, angleFactor);
      }
    }

    var combined = quat.multiply(quat.create(), snapRotation, this.pointerRotation);
    this.orientation = quat.multiply(quat.create(), combined, this.orientation);
    quat.normalize(this.orientation, this.orientation);

    var RA_INTENSITY = 0.8 * timeScale;
    quat.slerp(this._combinedQuat, this._combinedQuat, combined, RA_INTENSITY);
    quat.normalize(this._combinedQuat, this._combinedQuat);

    var rad = Math.acos(this._combinedQuat[3]) * 2.0;
    var s2 = Math.sin(rad/2.0);
    var rv = 0;
    if (s2 > 0.000001) {
      rv = rad / (2*Math.PI);
      this.rotationAxis[0] = this._combinedQuat[0]/s2;
      this.rotationAxis[1] = this._combinedQuat[1]/s2;
      this.rotationAxis[2] = this._combinedQuat[2]/s2;
    }
    this._rotationVelocity += (rv - this._rotationVelocity) * (0.5 * timeScale);
    this.rotationVelocity = this._rotationVelocity / timeScale;
    this.updateCallback(deltaTime);
  };

  /* ---- InfiniteGridMenu ---- */
  function InfiniteGridMenu(canvas, items, onActiveItem, onMovement, onInit, scale) {
    this.TARGET_FRAME_DURATION = 1000/60;
    this.SPHERE_RADIUS = 2;
    this._time = 0; this._deltaTime = 0; this._deltaFrames = 0; this._frames = 0;
    this.canvas = canvas;
    this.items = items || [];
    this.onActiveItemChange = onActiveItem || function(){};
    this.onMovementChange   = onMovement  || function(){};
    this.scaleFactor = scale || 1.0;
    this.nearestVertexIndex = null;
    this.smoothRotationVelocity = 0;
    this.movementActive = false;
    this.camera = {
      matrix: mat4.create(), near: 0.1, far: 40, fov: Math.PI/4, aspect: 1,
      position: vec3.fromValues(0,0,3*(scale||1)),
      up: vec3.fromValues(0,1,0),
      matrices: { view: mat4.create(), projection: mat4.create(), inversProjection: mat4.create() }
    };
    this._initGL(onInit);
  }
  InfiniteGridMenu.prototype._initGL = function(onInit) {
    var gl = this.canvas.getContext('webgl2', { antialias: true, alpha: true });
    if (!gl) { console.error('WebGL2 not available'); return; }
    this.gl = gl;
    this.viewportSize = vec2.fromValues(this.canvas.clientWidth, this.canvas.clientHeight);

    this.discProgram = createProgram(gl, [DISC_VERT, DISC_FRAG], null, {
      aModelPosition: 0, aModelNormal: 1, aModelUvs: 2, aInstanceMatrix: 3
    });
    var p = this.discProgram;
    this.locs = {
      aModelPosition: gl.getAttribLocation(p, 'aModelPosition'),
      aModelUvs:      gl.getAttribLocation(p, 'aModelUvs'),
      aInstanceMatrix:gl.getAttribLocation(p, 'aInstanceMatrix'),
      uWorldMatrix:   gl.getUniformLocation(p, 'uWorldMatrix'),
      uViewMatrix:    gl.getUniformLocation(p, 'uViewMatrix'),
      uProjectionMatrix: gl.getUniformLocation(p, 'uProjectionMatrix'),
      uCameraPosition:gl.getUniformLocation(p, 'uCameraPosition'),
      uRotationAxisVelocity: gl.getUniformLocation(p, 'uRotationAxisVelocity'),
      uTex:     gl.getUniformLocation(p, 'uTex'),
      uFrames:  gl.getUniformLocation(p, 'uFrames'),
      uItemCount:  gl.getUniformLocation(p, 'uItemCount'),
      uAtlasSize:  gl.getUniformLocation(p, 'uAtlasSize'),
      uScaleFactor:gl.getUniformLocation(p, 'uScaleFactor')
    };

    var discGeo = new DiscGeometry(56, 1);
    var discBuf = discGeo.data;
    this.discIndexCount = discBuf.indices.length;
    this.discVAO = makeVAO(gl,
      [[makeBuffer(gl, discBuf.vertices, gl.STATIC_DRAW), this.locs.aModelPosition, 3],
       [makeBuffer(gl, discBuf.uvs,      gl.STATIC_DRAW), this.locs.aModelUvs,      2]],
      discBuf.indices
    );

    var icoGeo = new IcosahedronGeometry();
    icoGeo.subdivide(1).spherize(this.SPHERE_RADIUS);
    this.instancePositions  = icoGeo.vertices.map(function(v){ return v.position; });
    this.DISC_INSTANCE_COUNT = icoGeo.vertices.length;
    this._initInstances();
    this.worldMatrix = mat4.create();
    this._initTexture();

    var self = this;
    this.control = new ArcballControl(this.canvas, function(dt){ self._onControlUpdate(dt); });
    this._updateCameraMatrix();
    this._updateProjectionMatrix();
    this.resize();
    if (onInit) onInit(this);
  };
  InfiniteGridMenu.prototype._initInstances = function() {
    var gl = this.gl, count = this.DISC_INSTANCE_COUNT;
    var inst = { matricesArray: new Float32Array(count*16), matrices: [], buffer: gl.createBuffer() };
    for (var i = 0; i < count; i++) {
      var slice = new Float32Array(inst.matricesArray.buffer, i*16*4, 16);
      slice.set(mat4.create());
      inst.matrices.push(slice);
    }
    gl.bindVertexArray(this.discVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, inst.matricesArray.byteLength, gl.DYNAMIC_DRAW);
    var bytesPerMatrix = 64;
    for (var j = 0; j < 4; j++) {
      var loc = this.locs.aInstanceMatrix + j;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, bytesPerMatrix, j*16);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);
    this.discInstances = inst;
  };
  InfiniteGridMenu.prototype._initTexture = function() {
    var gl = this.gl, self = this;
    this.tex = setupTex(gl, gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
    var itemCount = Math.max(1, this.items.length);
    this.atlasSize = Math.ceil(Math.sqrt(itemCount));
    var atlasSize = this.atlasSize;
    var cellSize = 256;
    var atlasCanvas = document.createElement('canvas');
    atlasCanvas.width  = atlasSize * cellSize;
    atlasCanvas.height = atlasSize * cellSize;
    var ctx = atlasCanvas.getContext('2d');

    // Fill a placeholder so shader can sample immediately
    ctx.fillStyle = '#1a0a2e';
    ctx.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);
    gl.bindTexture(gl.TEXTURE_2D, self.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);

    Promise.all(this.items.map(function(item) {
      return new Promise(function(resolve) {
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = function() { resolve(img); };
        img.onerror = function() { resolve(null); };
        img.src = item.image;
      });
    })).then(function(images) {
      images.forEach(function(img, i) {
        if (!img) return;
        var x = (i % atlasSize) * cellSize;
        var y = Math.floor(i / atlasSize) * cellSize;
        ctx.drawImage(img, x, y, cellSize, cellSize);
      });
      gl.bindTexture(gl.TEXTURE_2D, self.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
      gl.generateMipmap(gl.TEXTURE_2D);
    });
  };
  InfiniteGridMenu.prototype.resize = function() {
    var gl = this.gl;
    vec2.set(this.viewportSize, this.canvas.clientWidth, this.canvas.clientHeight);
    resizeCanvas(gl.canvas);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    this._updateProjectionMatrix();
  };
  InfiniteGridMenu.prototype.run = function(time) {
    time = time || 0;
    this._deltaTime = Math.min(32, time - this._time);
    this._time = time;
    this._deltaFrames = this._deltaTime / this.TARGET_FRAME_DURATION;
    this._frames += this._deltaFrames;
    this._animate(this._deltaTime);
    this._render();
    var self = this;
    this._rafId = requestAnimationFrame(function(t){ self.run(t); });
  };
  InfiniteGridMenu.prototype.stop = function() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  };
  InfiniteGridMenu.prototype._animate = function(dt) {
    var gl = this.gl;
    this.control.update(dt, this.TARGET_FRAME_DURATION);
    var orient = this.control.orientation;
    var SCALE_INTENSITY = 0.6;
    var scale = 0.25;
    var R = this.SPHERE_RADIUS;
    for (var ndx = 0; ndx < this.instancePositions.length; ndx++) {
      var p = vec3.transformQuat(vec3.create(), this.instancePositions[ndx], orient);
      var s = (Math.abs(p[2]) / R) * SCALE_INTENSITY + (1 - SCALE_INTENSITY);
      var finalScale = s * scale;
      var m = mat4.create();
      var negP = vec3.negate(vec3.create(), p);
      mat4.multiply(m, m, mat4.fromTranslation(mat4.create(), negP));
      mat4.multiply(m, m, mat4.targetTo(mat4.create(), [0,0,0], p, [0,1,0]));
      mat4.multiply(m, m, mat4.fromScaling(mat4.create(), [finalScale, finalScale, finalScale]));
      mat4.multiply(m, m, mat4.fromTranslation(mat4.create(), [0, 0, -R]));
      mat4.copy(this.discInstances.matrices[ndx], m);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.discInstances.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.discInstances.matricesArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.smoothRotationVelocity = this.control.rotationVelocity;
  };
  InfiniteGridMenu.prototype._render = function() {
    var gl = this.gl;
    gl.useProgram(this.discProgram);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.uniformMatrix4fv(this.locs.uWorldMatrix, false, this.worldMatrix);
    gl.uniformMatrix4fv(this.locs.uViewMatrix,  false, this.camera.matrices.view);
    gl.uniformMatrix4fv(this.locs.uProjectionMatrix, false, this.camera.matrices.projection);
    gl.uniform3fv(this.locs.uCameraPosition, this.camera.position);
    gl.uniform4f(this.locs.uRotationAxisVelocity,
      this.control.rotationAxis[0], this.control.rotationAxis[1],
      this.control.rotationAxis[2], this.smoothRotationVelocity * 1.1);
    gl.uniform1i(this.locs.uItemCount,   this.items.length);
    gl.uniform1i(this.locs.uAtlasSize,   this.atlasSize);
    gl.uniform1f(this.locs.uFrames,      this._frames);
    gl.uniform1f(this.locs.uScaleFactor, this.scaleFactor);
    gl.uniform1i(this.locs.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    gl.bindVertexArray(this.discVAO);
    gl.drawElementsInstanced(gl.TRIANGLES, this.discIndexCount, gl.UNSIGNED_SHORT, 0, this.DISC_INSTANCE_COUNT);
  };
  InfiniteGridMenu.prototype._updateCameraMatrix = function() {
    mat4.targetTo(this.camera.matrix, this.camera.position, [0,0,0], this.camera.up);
    mat4.invert(this.camera.matrices.view, this.camera.matrix);
  };
  InfiniteGridMenu.prototype._updateProjectionMatrix = function() {
    var gl = this.gl;
    this.camera.aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    var height = this.SPHERE_RADIUS * 0.35, dist = this.camera.position[2];
    this.camera.fov = this.camera.aspect > 1
      ? 2 * Math.atan(height / dist)
      : 2 * Math.atan(height / this.camera.aspect / dist);
    mat4.perspective(this.camera.matrices.projection, this.camera.fov, this.camera.aspect, this.camera.near, this.camera.far);
    mat4.invert(this.camera.matrices.inversProjection, this.camera.matrices.projection);
  };
  InfiniteGridMenu.prototype._onControlUpdate = function(dt) {
    var timeScale = dt / this.TARGET_FRAME_DURATION + 0.0001;
    var damping = 5 / timeScale;
    var targetZ = 3 * this.scaleFactor;
    var isMoving = this.control.isPointerDown || Math.abs(this.smoothRotationVelocity) > 0.01;
    if (isMoving !== this.movementActive) {
      this.movementActive = isMoving;
      this.onMovementChange(isMoving);
    }
    if (!this.control.isPointerDown) {
      var ni = this._findNearestVertex();
      this.onActiveItemChange(ni % Math.max(1, this.items.length));
      var snapDir = vec3.normalize(vec3.create(), this._getVertexWorld(ni));
      this.control.snapTargetDirection = snapDir;
    } else {
      targetZ += this.control.rotationVelocity * 80 + 2.5;
      damping = 7 / timeScale;
    }
    this.camera.position[2] += (targetZ - this.camera.position[2]) / damping;
    this._updateCameraMatrix();
  };
  InfiniteGridMenu.prototype._findNearestVertex = function() {
    var n = this.control.snapDirection;
    var inv = quat.conjugate(quat.create(), this.control.orientation);
    var nt = vec3.transformQuat(vec3.create(), n, inv);
    var maxD = -1, best = 0;
    for (var i = 0; i < this.instancePositions.length; i++) {
      var d = vec3.dot(nt, this.instancePositions[i]);
      if (d > maxD) { maxD = d; best = i; }
    }
    return best;
  };
  InfiniteGridMenu.prototype._getVertexWorld = function(index) {
    return vec3.transformQuat(vec3.create(), this.instancePositions[index], this.control.orientation);
  };

  /* ---- Image discovery ---- */
  function discoverImages() {
    return fetch('gallery/')
      .then(function(res) { return res.text(); })
      .then(function(html) {
        var re = /href="([^"?#]+\.(jpg|jpeg|png|webp|gif|avif))"/gi;
        var byBase = {}, m;
        while ((m = re.exec(html)) !== null) {
          var src  = m[1].split('/').pop();
          var base = src.replace(/\.[^.]+$/, '');
          var ext  = src.split('.').pop().toLowerCase();
          // prefer webp over jpg/png
          if (!byBase[base] || ext === 'webp') byBase[base] = src;
        }
        var found = Object.keys(byBase).map(function(base) {
          var src = byBase[base];
          return { src: 'gallery/' + src, name: base.replace(/[-_]/g, ' ') };
        });
        return found.length ? found : fallbackImages();
      })
      .catch(function() { return fallbackImages(); });
  }
  function fallbackImages() {
    var list = [];
    for (var i = 1; i <= 27; i++) list.push({ src:'gallery/chemba-'+i+'.webp', name:'Chembarambakkam '+i });
    for (var i = 1; i <= 63; i++) list.push({ src:'gallery/porur1-'+i+'.webp', name:'Porur Session 1 — '+i });
    for (var i = 1; i <= 11; i++) list.push({ src:'gallery/porur2-'+i+'.webp', name:'Porur Session 2 — '+i });
    return list;
  }

  /* ---- Lightbox ---- */
  var _lbIndex = 0;

  function lightboxOpen(index) {
    _lbIndex = index;
    lightboxRender();
    var lb = document.getElementById('gallery-lightbox');
    if (lb) lb.classList.add('open');
    document.addEventListener('keydown', lightboxKey);
  }

  function lightboxClose() {
    var lb = document.getElementById('gallery-lightbox');
    if (lb) lb.classList.remove('open');
    document.removeEventListener('keydown', lightboxKey);
  }

  function lightboxRender() {
    var item = _imageItems[_lbIndex];
    if (!item) return;
    var img     = document.getElementById('lightbox-img');
    var caption = document.getElementById('lightbox-caption');
    var counter = document.getElementById('lightbox-counter');
    if (img)     { img.src = item.src; img.alt = item.name; }
    if (caption) caption.textContent = item.name;
    if (counter) counter.textContent = (_lbIndex + 1) + ' / ' + _imageItems.length;
  }

  function lightboxStep(dir) {
    _lbIndex = (_lbIndex + dir + _imageItems.length) % _imageItems.length;
    lightboxRender();
  }

  function lightboxKey(e) {
    if (e.key === 'ArrowRight') lightboxStep(1);
    else if (e.key === 'ArrowLeft') lightboxStep(-1);
    else if (e.key === 'Escape') lightboxClose();
  }

  function initLightbox() {
    var backdrop = document.getElementById('lightbox-backdrop');
    var closeBtn = document.getElementById('lightbox-close');
    var prevBtn  = document.getElementById('lightbox-prev');
    var nextBtn  = document.getElementById('lightbox-next');
    if (backdrop) backdrop.addEventListener('click', lightboxClose);
    if (closeBtn) closeBtn.addEventListener('click', lightboxClose);
    if (prevBtn)  prevBtn.addEventListener('click', function(){ lightboxStep(-1); });
    if (nextBtn)  nextBtn.addEventListener('click', function(){ lightboxStep(1); });
  }

  /* ---- Grid builder ---- */
  function buildGrid(grid, imageList) {
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    imageList.forEach(function(item, idx) {
      var card = document.createElement('div');
      card.className = 'gallery-grid-item';
      var img = document.createElement('img');
      img.src = item.src;
      img.alt = item.name;
      img.loading = 'lazy';
      var label = document.createElement('span');
      label.className = 'gallery-grid-label';
      label.textContent = item.name;
      card.appendChild(img);
      card.appendChild(label);
      card.addEventListener('click', function(){ lightboxOpen(idx); });
      grid.appendChild(card);
    });
  }

  /* ---- State ---- */
  var _globe = null;
  var _imageItems = [];
  var _globeStarted = false;
  var _glReady = false;

  /* ---- gl-matrix loader ---- */
  function waitForGlMatrix(cb) {
    if (typeof window.glMatrix !== 'undefined' && window.glMatrix.mat4) {
      if (!_glReady) {
        mat4 = window.glMatrix.mat4; quat = window.glMatrix.quat;
        vec2 = window.glMatrix.vec2; vec3 = window.glMatrix.vec3;
        _glReady = true;
      }
      cb();
    } else {
      setTimeout(function(){ waitForGlMatrix(cb); }, 50);
    }
  }

  /* ---- Globe: create + start (idempotent) ---- */
  function startGlobe() {
    if (_globeStarted) return;
    if (!_imageItems.length) return;
    var canvas  = document.getElementById('gallery-canvas');
    var caption = document.getElementById('gallery-globe-caption');
    if (!canvas) return;

    waitForGlMatrix(function() {
      if (_globeStarted) return;
      _globeStarted = true;
      var _activeIdx = 0;
      var items = _imageItems.map(function(im){ return { image: im.src, title: im.name }; });
      _globe = new InfiniteGridMenu(
        canvas, items,
        function(idx) {
          _activeIdx = idx;
          if (caption) caption.textContent = _imageItems[idx] ? _imageItems[idx].name : '';
        },
        function(moving) {
          if (caption) caption.style.opacity = moving ? '0' : '1';
        },
        function(g) { g.run(); },
        1.0
      );
      window.addEventListener('resize', function(){ _globe && _globe.resize(); });

      // Click on canvas opens the nearest/active disc in lightbox
      var _pointerMoved = false;
      canvas.addEventListener('pointerdown', function(){ _pointerMoved = false; });
      canvas.addEventListener('pointermove', function(){ _pointerMoved = true; });
      canvas.addEventListener('pointerup', function(){
        if (!_pointerMoved) lightboxOpen(_activeIdx);
      });
    });
  }

  /* ---- Toggle between globe and grid ---- */
  function showGrid() {
    var globeEl   = document.getElementById('gallery-globe');
    var gridEl    = document.getElementById('gallery-grid');
    var toggleBtn = document.getElementById('gallery-toggle-grid');
    var backBtn   = document.getElementById('gallery-exit-globe');
    if (globeEl)   globeEl.style.display   = 'none';
    if (gridEl)    gridEl.style.display    = '';
    if (toggleBtn) toggleBtn.style.display = 'none';
    if (backBtn)   backBtn.style.display   = '';
  }

  function showGlobe() {
    var globeEl   = document.getElementById('gallery-globe');
    var gridEl    = document.getElementById('gallery-grid');
    var toggleBtn = document.getElementById('gallery-toggle-grid');
    var backBtn   = document.getElementById('gallery-exit-globe');
    if (globeEl)   globeEl.style.display   = 'flex';
    if (gridEl)    gridEl.style.display    = 'none';
    if (toggleBtn) toggleBtn.style.display = '';
    if (backBtn)   backBtn.style.display   = 'none';
    startGlobe();
  }

  /* ---- Init ---- */
  function init() {
    var section   = document.getElementById('section-gallery');
    var grid      = document.getElementById('gallery-grid');
    var toggleBtn = document.getElementById('gallery-toggle-grid');
    var backBtn   = document.getElementById('gallery-exit-globe');
    if (!section || !grid) return;

    discoverImages().then(function(imageList) {
      _imageItems = imageList;
      buildGrid(grid, imageList);

      // Auto-start globe when gallery section enters viewport
      if ('IntersectionObserver' in window) {
        var obs = new IntersectionObserver(function(entries) {
          if (entries[0].isIntersecting) {
            startGlobe();
            obs.disconnect();
          }
        }, { threshold: 0.1 });
        obs.observe(section);
      } else {
        setTimeout(startGlobe, 500);
      }
    });

    if (toggleBtn) toggleBtn.addEventListener('click', showGrid);
    if (backBtn)   backBtn.addEventListener('click', showGlobe);
    initLightbox();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
