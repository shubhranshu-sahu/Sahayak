/**
 * Sahayak — Router / Auth Guard (router.js)
 * Checks JWT validity, enforces role-based route access, manages session lifecycle,
 * redirects to homepage on logout, and prevents back-button cache exposure.
 */

const Router = (() => {
    'use strict';

    /**
     * Get stored token
     */
    function getToken() {
        return localStorage.getItem(CONFIG.TOKEN_KEY);
    }

    /**
     * Get cached user object
     */
    function getUser() {
        try {
            const raw = localStorage.getItem(CONFIG.USER_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    /**
     * Save user + token to localStorage
     */
    function saveAuth(token, user) {
        localStorage.setItem(CONFIG.TOKEN_KEY, token);
        localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user));
    }

    /**
     * Resolve target page URL correctly relative to current location
     */
    function resolvePath(page) {
        const isPagesDir = window.location.pathname.includes('/pages/');
        return isPagesDir ? page : `pages/${page}`;
    }

    /**
     * Clear auth data and redirect to homepage (index.html) with history replacement
     */
    function logout() {
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.USER_KEY);
        
        const isPagesDir = window.location.pathname.includes('/pages/');
        const homeUrl = isPagesDir ? '../index.html' : 'index.html';
        
        // Use replace so user cannot press Back button to revisit authenticated state
        window.location.replace(homeUrl);
    }

    /**
     * Check if user is logged in (has token)
     */
    function isLoggedIn() {
        return !!getToken();
    }

    /**
     * Validate token by calling /auth/me and return fresh user data.
     * Returns user object or null.
     */
    async function validateAndGetUser() {
        if (!getToken()) return null;

        const res = await Api.get('/auth/me');
        if (res.success && res.data) {
            // Update cached user
            localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(res.data));
            return res.data;
        }

        // Token invalid or expired — clear everything
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.USER_KEY);
        return null;
    }

    /**
     * Redirect user to the correct dashboard based on role + society status.
     */
    function redirectToDashboard(user) {
        if (!user) {
            const isPagesDir = window.location.pathname.includes('/pages/');
            window.location.replace(isPagesDir ? 'login.html' : 'pages/login.html');
            return;
        }

        if (user.role === 'secretary') {
            // Secretary without a society → setup wizard
            if (!user.societyId && (!user.society || !user.society.id)) {
                window.location.replace(resolvePath('society-setup.html'));
            } else {
                window.location.replace(resolvePath('dashboard.html'));
            }
        } else if (user.role === 'resident') {
            // Resident → dedicated resident dashboard
            window.location.replace(resolvePath('resident-dashboard.html'));
        } else {
            window.location.replace(resolvePath('dashboard.html'));
        }
    }

    /**
     * Guard for protected pages with optional role whitelist.
     * Usage: await Router.requireAuth('secretary') or await Router.requireAuth(['secretary', 'resident'])
     */
    async function requireAuth(allowedRoles = null) {
        if (!getToken()) {
            const isPagesDir = window.location.pathname.includes('/pages/');
            window.location.replace(isPagesDir ? 'login.html' : 'pages/login.html');
            return null;
        }

        const user = await validateAndGetUser();
        if (!user) {
            const isPagesDir = window.location.pathname.includes('/pages/');
            window.location.replace(isPagesDir ? 'login.html' : 'pages/login.html');
            return null;
        }

        // Enforce role-based access control if specified
        if (allowedRoles) {
            const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
            if (!roles.includes(user.role)) {
                console.warn(`Access denied for role '${user.role}' to this page. Redirecting.`);
                redirectToDashboard(user);
                return null;
            }
        }

        return user;
    }

    /**
     * Guard for public-only pages (login, register).
     * If already logged in, redirect to appropriate dashboard.
     */
    async function requireGuest() {
        if (!getToken()) return;

        const user = await validateAndGetUser();
        if (user) {
            redirectToDashboard(user);
        }
    }

    // ════════════════════════════════════════════════════════
    // Prevent Back-Forward Cache (bfcache) Leaks on Logout
    // ════════════════════════════════════════════════════════
    window.addEventListener('pageshow', (event) => {
        const path = window.location.pathname;
        const isProtectedPage = [
            'dashboard.html',
            'resident-dashboard.html',
            'society-setup.html',
            'residents.html',
            'chat.html'
        ].some(p => path.includes(p));

        if (isProtectedPage) {
            // If page was loaded from browser back/forward cache and user is logged out
            if (event.persisted || !isLoggedIn()) {
                const isPagesDir = path.includes('/pages/');
                window.location.replace(isPagesDir ? '../index.html' : 'index.html');
            }
        }
    });

    return {
        getToken,
        getUser,
        saveAuth,
        logout,
        isLoggedIn,
        validateAndGetUser,
        redirectToDashboard,
        requireAuth,
        requireGuest,
    };
})();

