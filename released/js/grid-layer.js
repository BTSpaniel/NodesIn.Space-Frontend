/**
 * GridLayer class for rendering and managing the background grid canvas.* World-space grid that pans and zooms with canvasTransform
 */
(function(){
  class GridLayer {
    constructor(elementId = 'grid-layer', options = {}) {
      this.el = document.getElementById(elementId);
      if (!this.el) {
        console.warn(`GridLayer: element #${elementId} not found`);
        return;
      }
      // Defaults
      this.options = Object.assign({
        baseSpacingCm: 1,       // 1 cm grid spacing in CSS physical units
        lineColor: 'rgba(0,255,136,0.06)',
        boldLineColor: 'rgba(0,255,136,0.10)',
        boldEvery: 5,           // every N lines draw a bolder line
        backgroundColor: 'transparent'
      }, options);

      this.el.style.backgroundColor = this.options.backgroundColor;
      // Initialize pattern at scale = 1
      this._applyPattern(1);
      // Keep last transform
      this.lastTransform = { x: 0, y: 0, scale: 1 };
    }

    // Update called by WorkflowCanvas.applyCanvasTransform
    update(transform) {
      if (!this.el) return;
      const { x, y, scale } = transform;
      // Pan: move grid pattern by the canvas translation
      this.el.style.backgroundPosition = `${x}px ${y}px`;
      // Zoom: recompute spacing to scale with the canvas
      if (this.lastTransform.scale !== scale) {
        this._applyPattern(scale);
      }
      this.lastTransform = { x, y, scale };
    }

    _applyPattern(scale = 1) {
      // 1cm in CSS px (per spec: 96dpi => 1in = 96px, 1cm = 96/2.54)
      const PX_PER_CM = 96 / 2.54;
      const baseCm = Math.max(0.1, this.options.baseSpacingCm);
      const spacingPx = Math.max(2, baseCm * PX_PER_CM * scale);
      const boldPx = spacingPx * this.options.boldEvery;
      // Two-layer repeating-linear-gradient grid (fine + bold)
      const line = this.options.lineColor;
      const boldLine = this.options.boldLineColor;
      const gridFine = `repeating-linear-gradient(0deg, ${line}, ${line} 1px, transparent 1px, transparent ${spacingPx}px),` +
                       `repeating-linear-gradient(90deg, ${line}, ${line} 1px, transparent 1px, transparent ${spacingPx}px)`;
      const gridBold = `,repeating-linear-gradient(0deg, ${boldLine}, ${boldLine} 1px, transparent 1px, transparent ${boldPx}px)` +
                       `,repeating-linear-gradient(90deg, ${boldLine}, ${boldLine} 1px, transparent 1px, transparent ${boldPx}px)`;
      this.el.style.backgroundImage = gridFine + gridBold;
      // Set backgroundSize to match spacing for crisp tiling
      this.el.style.backgroundSize = `${spacingPx}px ${spacingPx}px, ${spacingPx}px ${spacingPx}px, ${boldPx}px ${boldPx}px, ${boldPx}px ${boldPx}px`;
      // Keep origin pinned
      this.el.style.backgroundPosition = `0 0`;
    }
  }

  // Expose
  window['GridLayer'] = GridLayer;
})();
