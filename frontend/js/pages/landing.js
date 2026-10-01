/**
 * Sahayak — Landing Page Logic
 * Handles Lucide icons initialization and mobile responsive navbar toggle.
 */

document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // Mobile hamburger toggle
    const hamburger = document.getElementById('nav-hamburger');
    const navLinks = document.getElementById('nav-links');

    if (hamburger && navLinks) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('active');
            navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';

            // Mobile: stack nav links vertically
            if (window.innerWidth <= 768) {
                navLinks.style.flexDirection = 'column';
                navLinks.style.position = 'absolute';
                navLinks.style.top = '100%';
                navLinks.style.left = '0';
                navLinks.style.right = '0';
                navLinks.style.background = 'rgba(61, 15, 33, 0.95)';
                navLinks.style.backdropFilter = 'blur(20px)';
                navLinks.style.padding = '1.5rem';
                navLinks.style.gap = '1rem';
                navLinks.style.borderBottom = '1px solid rgba(242, 212, 184, 0.1)';
            }
        });
    }
});
