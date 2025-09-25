/* Visual Effects Utilities for AGI Node Editor */
(function () {
  'use strict';

  /** @typedef {{selected: (boolean|undefined), mismatch: (boolean|undefined)}} */
  var WireColorOptions;

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  function hexToRgb(hex) {
    if (!hex) return null;
    let s = hex.trim();
    if (s[0] === '#') s = s.slice(1);
    if (s.length === 3) {
      const r = parseInt(s[0] + s[0], 16);
      const g = parseInt(s[1] + s[1], 16);
      const b = parseInt(s[2] + s[2], 16);
      return { r, g, b };
    }
    if (s.length === 6) {
      const r = parseInt(s.slice(0, 2), 16);
      const g = parseInt(s.slice(2, 4), 16);
      const b = parseInt(s.slice(4, 6), 16);
      return { r, g, b };
    }
    return null;
  }

  function rgbToRgbaStr(rgb, a) {
    if (!rgb) return 'rgba(255,255,255,0)';
    const alpha = clamp01(a);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  function mixRgb(rgb, target, amount) {
    // amount in [0,1], mix towards target color
    const t = clamp01(amount);
    return {
      r: Math.round(rgb.r + (target.r - rgb.r) * t),
      g: Math.round(rgb.g + (target.g - rgb.g) * t),
      b: Math.round(rgb.b + (target.b - rgb.b) * t)
    };
  }

  function lighten(rgb, amount) { // amount [0,1]
    return mixRgb(rgb, { r: 255, g: 255, b: 255 }, amount);
  }
  function darken(rgb, amount) { // amount [0,1]
    return mixRgb(rgb, { r: 0, g: 0, b: 0 }, amount);
  }

  function applyNodeColor(nodeEl, hexColor) {
    if (!nodeEl) return;
    if (!hexColor) { clearNodeColor(nodeEl); return; }
    const rgb = hexToRgb(hexColor);
    if (!rgb) { clearNodeColor(nodeEl); return; }

    // Border tint
    nodeEl.style.borderColor = hexColor;

    // Header gradient tint
    const header = nodeEl.querySelector('.node-header');
    if (header) {
      const top = rgbToRgbaStr(lighten(rgb, 0.25), 0.25);
      const bottom = rgbToRgbaStr(darken(rgb, 0.15), 0.35);
      header.style.background = `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`;
    }

    // 3D-compatible glow via CSS variables (preferred when node-3d class is present)
    const colorOuterGlow = `0 0 12px ${rgbToRgbaStr(rgb, 0.35)}`;
    const colorInnerStroke = `inset 0 0 0 1px ${rgbToRgbaStr(rgb, 0.6)}`;
    if (nodeEl.classList && nodeEl.classList.contains('node-3d')) {
      nodeEl.style.setProperty('--fx-color-outer-glow', colorOuterGlow);
      nodeEl.style.setProperty('--fx-color-inner-stroke', colorInnerStroke);
      // Let CSS compose with --fx-selected-glow if selected
    } else {
      // Fallback for non-3D nodes
      const isSelected = nodeEl.classList.contains('selected');
      const selectedGlow = '0 0 0 2px rgba(0, 255, 136, 0.3)';
      nodeEl.style.boxShadow = isSelected
        ? `${selectedGlow}, ${colorOuterGlow}, ${colorInnerStroke}`
        : `${colorOuterGlow}, ${colorInnerStroke}`;
    }
  }

  function clearNodeColor(nodeEl) {
    if (!nodeEl) return;
    nodeEl.style.borderColor = '';
    const header = nodeEl.querySelector('.node-header');
    if (header) header.style.background = '';
    // Clear 3D color variables if present, else clear boxShadow fallback
    if (nodeEl.classList && nodeEl.classList.contains('node-3d')) {
      nodeEl.style.removeProperty('--fx-color-outer-glow');
      nodeEl.style.removeProperty('--fx-color-inner-stroke');
      // Keep --fx-selected-glow managed by CSS .selected class
    } else {
      // Preserve selected glow style from CSS if node is selected; remove only color-specific parts
      if (nodeEl.classList.contains('selected')) {
        nodeEl.style.boxShadow = '';
      } else {
        nodeEl.style.boxShadow = '';
      }
    }
  }

  /**
   * @param {!Element} pathEl
   * @param {string} hexColor
   * @param {(WireColorOptions|undefined)} opts
   */
  function applyWireColor(pathEl, hexColor, opts) {
    if (!pathEl) return;
    opts = (opts || {});
    // Use bracket access to avoid property renaming under ADVANCED mode.
    const selected = !!opts['selected'];
    const mismatch = !!opts['mismatch'];

    // Do not override selected/mismatch visuals; clear extra effects then
    if (selected || mismatch) {
      pathEl.style.filter = '';
      return;
    }

    const rgb = hexToRgb(hexColor || '#ffffff');
    // Soft glow around the wire
    pathEl.style.filter = `drop-shadow(0 0 4px ${rgbToRgbaStr(rgb, 0.55)})`;
  }

  function clearWireColor(pathEl) {
    if (!pathEl) return;
    pathEl.style.filter = '';
  }

  // =========================
  // 3D Node Interaction Utils
  // =========================
  const FX3D = {
    MAX_TILT_DEG_X: 8,
    MAX_TILT_DEG_Y: 8,
  };

  function _update3DFromPointer(nodeEl, clientX, clientY) {
    if (!nodeEl || nodeEl.classList.contains('dragging')) return;
    const rect = nodeEl.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const nx = (px / w) - 0.5; // [-0.5, 0.5]
    const ny = (py / h) - 0.5; // [-0.5, 0.5]
    const tiltY = (nx * FX3D.MAX_TILT_DEG_Y).toFixed(2) + 'deg'; // rotateY: left/right
    const tiltX = (-ny * FX3D.MAX_TILT_DEG_X).toFixed(2) + 'deg'; // rotateX: up/down
    nodeEl.style.setProperty('--tilt-x', tiltX);
    nodeEl.style.setProperty('--tilt-y', tiltY);
    // Gloss highlight follows pointer
    const glossX = Math.max(0, Math.min(100, (px / w) * 100)).toFixed(2) + '%';
    // Keep gloss near top for a nice sheen
    const glossY = Math.max(0, Math.min(100, (py / h) * 25)).toFixed(2) + '%';
    nodeEl.style.setProperty('--gloss-x', glossX);
    nodeEl.style.setProperty('--gloss-y', glossY);
  }

  function enableNode3D(nodeEl) {
    if (!nodeEl) return;
    if (!nodeEl.classList.contains('node-3d')) nodeEl.classList.add('node-3d');
    // Initialize vars
    nodeEl.style.setProperty('--tilt-x', '0deg');
    nodeEl.style.setProperty('--tilt-y', '0deg');
    nodeEl.style.setProperty('--gloss-x', '50%');
    nodeEl.style.setProperty('--gloss-y', '0%');

    // Avoid duplicate bindings
    if (nodeEl.__fx3DHandlers) return;
    const onMove = (e) => _update3DFromPointer(nodeEl, e.clientX, e.clientY);
    const onEnter = (e) => _update3DFromPointer(nodeEl, e.clientX, e.clientY);
    const onLeave = () => {
      // Reset to neutral
      nodeEl.style.setProperty('--tilt-x', '0deg');
      nodeEl.style.setProperty('--tilt-y', '0deg');
      nodeEl.style.setProperty('--gloss-x', '50%');
      nodeEl.style.setProperty('--gloss-y', '0%');
    };
    nodeEl.addEventListener('mousemove', onMove);
    nodeEl.addEventListener('mouseenter', onEnter);
    nodeEl.addEventListener('mouseleave', onLeave);
    nodeEl.__fx3DHandlers = { onMove, onEnter, onLeave };
  }

  function disableNode3D(nodeEl) {
    if (!nodeEl) return;
    if (nodeEl.__fx3DHandlers) {
      const { onMove, onEnter, onLeave } = nodeEl.__fx3DHandlers;
      nodeEl.removeEventListener('mousemove', onMove);
      nodeEl.removeEventListener('mouseenter', onEnter);
      nodeEl.removeEventListener('mouseleave', onLeave);
      delete nodeEl.__fx3DHandlers;
    }
    nodeEl.classList.remove('node-3d');
    nodeEl.style.removeProperty('--tilt-x');
    nodeEl.style.removeProperty('--tilt-y');
    nodeEl.style.removeProperty('--gloss-x');
    nodeEl.style.removeProperty('--gloss-y');
    nodeEl.style.removeProperty('--fx-color-outer-glow');
    nodeEl.style.removeProperty('--fx-color-inner-stroke');
  }

  window.fx = {
    applyNodeColor,
    clearNodeColor,
    applyWireColor,
    clearWireColor,
    enableNode3D,
    disableNode3D,
    // Expose utilities in case we need them elsewhere
    _utils: { hexToRgb, rgbToRgbaStr, lighten, darken }
  };
})();
