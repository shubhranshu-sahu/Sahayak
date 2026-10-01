/**
 * Sahayak — Custom Cursor Trail  (cursor.js)
 * Peach dot + burgundy glow ring that follows mouse.
 * Expands on interactive elements, disabled on mobile.
 */

(function () {
    'use strict';

    // Don't initialize on touch devices
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;

    /* ── Create cursor elements ── */
    const dot = document.createElement('div');
    dot.className = 'cursor-dot';
    document.body.appendChild(dot);

    const ring = document.createElement('div');
    ring.className = 'cursor-ring';
    document.body.appendChild(ring);

    /* ── Mouse tracking ── */
    let mouseX = -100, mouseY = -100;
    let dotX = -100, dotY = -100;
    let ringX = -100, ringY = -100;

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    /* ── Smooth animation loop ── */
    function animate() {
        // Dot follows instantly with slight smoothing
        dotX += (mouseX - dotX) * 0.35;
        dotY += (mouseY - dotY) * 0.35;
        dot.style.left = dotX + 'px';
        dot.style.top = dotY + 'px';

        // Ring lags behind for trail effect
        ringX += (mouseX - ringX) * 0.15;
        ringY += (mouseY - ringY) * 0.15;
        ring.style.left = ringX + 'px';
        ring.style.top = ringY + 'px';

        requestAnimationFrame(animate);
    }
    animate();

    /* ── Hover detection for interactive elements ── */
    const interactiveSelectors = 'a, button, .btn, input, textarea, select, [role="button"], .feature-card, .problem-card, .step-card, .team-card, .tech-badge, .glass-card';

    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest(interactiveSelectors);
        if (target) {
            document.body.classList.add('cursor-hover');
        }
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest(interactiveSelectors);
        if (target) {
            document.body.classList.remove('cursor-hover');
        }
    });

    /* ── Click animation ── */
    document.addEventListener('mousedown', () => {
        document.body.classList.add('cursor-click');
    });
    document.addEventListener('mouseup', () => {
        document.body.classList.remove('cursor-click');
    });

    /* ── Text input cursor variant ── */
    const textSelectors = 'input[type="text"], input[type="email"], input[type="password"], input[type="search"], textarea';

    document.addEventListener('focusin', (e) => {
        if (e.target.matches(textSelectors)) {
            document.body.classList.add('cursor-text');
        }
    });
    document.addEventListener('focusout', (e) => {
        if (e.target.matches(textSelectors)) {
            document.body.classList.remove('cursor-text');
        }
    });

    /* ── Hide cursor when leaving window ── */
    document.addEventListener('mouseleave', () => {
        dot.style.opacity = '0';
        ring.style.opacity = '0';
    });
    document.addEventListener('mouseenter', () => {
        dot.style.opacity = '1';
        ring.style.opacity = '1';
    });
})();
