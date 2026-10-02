/**
 * Sahayak — Animations Engine  (animations.js)
 * ScrollReveal, GSAP + ScrollTrigger, Lenis smooth scroll
 */

(function () {
    'use strict';

    /* ══════════ 1. Lenis Smooth Scroll ══════════ */
    let lenis;

    function initLenis() {
        lenis = new Lenis({
            duration: 1.2,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            orientation: 'vertical',
            smoothWheel: true,
        });

        // Connect Lenis to GSAP's ScrollTrigger
        lenis.on('scroll', ScrollTrigger.update);

        gsap.ticker.add((time) => {
            lenis.raf(time * 1000);
        });
        gsap.ticker.lagSmoothing(0);
    }


    /* ══════════ 2. ScrollReveal Defaults ══════════ */
    function initScrollReveal() {
        const sr = ScrollReveal({
            origin: 'bottom',
            distance: '40px',
            duration: 800,
            delay: 100,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            reset: false,
            viewFactor: 0.15,
        });

        // Section labels & headings
        sr.reveal('.section-label', { delay: 0 });
        sr.reveal('.section-heading', { delay: 100 });
        sr.reveal('.section-subtext', { delay: 150 });

        // Problem cards — staggered
        sr.reveal('.problem-card', { interval: 120 });

        // Solution features — staggered
        sr.reveal('.solution-feature', { interval: 100, origin: 'left', distance: '30px' });

        // Feature cards — staggered
        sr.reveal('.feature-card', { interval: 100 });

        // Role panels — slide in from sides
        sr.reveal('.role-panel.dark', { origin: 'left', distance: '60px' });
        sr.reveal('.role-panel.light', { origin: 'right', distance: '60px' });

        // Tech badges — staggered
        sr.reveal('.tech-badge', { interval: 60, distance: '20px' });

        // Team cards — staggered
        sr.reveal('.team-card', { interval: 100 });

        // Final CTA
        sr.reveal('.final-cta-content h2', { delay: 0 });
        sr.reveal('.final-cta-content p', { delay: 100 });
        sr.reveal('.final-cta-buttons', { delay: 200, distance: '30px' });
    }


    /* ══════════ 3. GSAP Hero Animations ══════════ */
    function initHeroAnimation() {
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

        tl.from('.hero-badge', {
            opacity: 0,
            y: 20,
            duration: 0.6,
            delay: 0.3,
        })
        .from('.hero-title', {
            opacity: 0,
            y: 40,
            duration: 0.8,
        }, '-=0.3')
        .from('.hero-subtitle', {
            opacity: 0,
            y: 30,
            duration: 0.7,
        }, '-=0.4')
        .from('.hero-cta .btn', {
            opacity: 0,
            y: 20,
            stagger: 0.15,
            duration: 0.6,
        }, '-=0.3')
        .from('.hero-scroll-indicator', {
            opacity: 0,
            y: -10,
            duration: 0.5,
        }, '-=0.2');
    }


    /* ══════════ 4. Horizontal Scroll Section ══════════ */
    function initHorizontalScroll() {
        const track = document.querySelector('.horizontal-track');
        const section = document.querySelector('.section-how-it-works');
        const progressFill = document.querySelector('.scroll-progress-fill');

        if (!track || !section) return;

        const cards = track.querySelectorAll('.step-card');
        const totalScrollWidth = track.scrollWidth - window.innerWidth + 200;

        gsap.to(track, {
            x: () => -totalScrollWidth,
            ease: 'none',
            scrollTrigger: {
                trigger: section,
                start: 'top top',
                end: () => `+=${totalScrollWidth}`,
                scrub: 1,
                pin: true,
                anticipatePin: 1,
                invalidateOnRefresh: true,
                onUpdate: (self) => {
                    if (progressFill) {
                        progressFill.style.width = (self.progress * 100) + '%';
                    }
                }
            }
        });

        // Stagger card entrance
        cards.forEach((card, i) => {
            gsap.from(card, {
                opacity: 0.3,
                scale: 0.9,
                scrollTrigger: {
                    trigger: card,
                    containerAnimation: gsap.getById ? undefined : undefined,
                    start: 'left 80%',
                    end: 'left 40%',
                    scrub: true,
                    horizontal: true,
                },
            });
        });
    }


    /* ══════════ 5. Navbar Scroll Effect ══════════ */
    function initNavbarScroll() {
        const navbar = document.querySelector('.landing-nav');
        if (!navbar) return;

        // Use Intersection Observer for better performance
        const sentinel = document.createElement('div');
        sentinel.style.position = 'absolute';
        sentinel.style.top = '80px';
        sentinel.style.height = '1px';
        sentinel.style.width = '1px';
        document.body.prepend(sentinel);

        const observer = new IntersectionObserver(
            ([entry]) => {
                navbar.classList.toggle('scrolled', !entry.isIntersecting);
            },
            { threshold: 0 }
        );
        observer.observe(sentinel);
    }


    /* ══════════ 6. Parallax Hero Background ══════════ */
    function initHeroParallax() {
        const hero = document.querySelector('.hero');
        if (!hero) return;

        hero.addEventListener('mousemove', (e) => {
            const shapes = hero.querySelectorAll('.hero-shape');
            const rect = hero.getBoundingClientRect();
            const xRatio = (e.clientX - rect.left) / rect.width - 0.5;
            const yRatio = (e.clientY - rect.top) / rect.height - 0.5;

            shapes.forEach((shape, i) => {
                const speed = (i + 1) * 8;
                gsap.to(shape, {
                    x: xRatio * speed,
                    y: yRatio * speed,
                    duration: 1,
                    ease: 'power2.out',
                });
            });
        });
    }


    /* ══════════ 7. Counter Animation ══════════ */
    function initCounters() {
        const counters = document.querySelectorAll('[data-count]');
        if (!counters.length) return;

        counters.forEach(counter => {
            const target = parseInt(counter.dataset.count, 10);

            ScrollTrigger.create({
                trigger: counter,
                start: 'top 85%',
                once: true,
                onEnter: () => {
                    gsap.to(counter, {
                        innerText: target,
                        duration: 2,
                        ease: 'power2.out',
                        snap: { innerText: 1 },
                        onUpdate: function () {
                            counter.innerText = Math.round(
                                parseFloat(counter.innerText)
                            );
                        },
                    });
                }
            });
        });
    }


    /* ══════════ 8. Smooth Scroll for Anchor Links ══════════ */
    function initSmoothAnchors() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = anchor.getAttribute('href');
                const targetEl = document.querySelector(targetId);
                if (targetEl && lenis) {
                    lenis.scrollTo(targetEl, { offset: -80 });
                }
            });
        });
    }


    /* ══════════ Initialize Everything ══════════ */
    function init() {
        // Wait for GSAP + ScrollTrigger + Lenis + ScrollReveal to load
        if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined' ||
            typeof Lenis === 'undefined' || typeof ScrollReveal === 'undefined') {
            // Retry after a short delay
            setTimeout(init, 100);
            return;
        }

        gsap.registerPlugin(ScrollTrigger);

        initLenis();
        initNavbarScroll();
        initHeroAnimation();
        initHeroParallax();
        initScrollReveal();
        initHorizontalScroll();
        initCounters();
        initSmoothAnchors();
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
