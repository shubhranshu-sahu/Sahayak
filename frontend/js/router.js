/**
 * Sahayak — Router / Auth Guard  (router.js)
 * Checks JWT validity and redirects based on role.
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
     * Clear auth data and redirect to login
     */
    function logout() {
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.USER_KEY);
        window.location.href = resolvePath('login.html');
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

        // Token invalid — clear everything
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.USER_KEY);
        return null;
    }

    /**
     * Redirect user to the correct dashboard based on role + society status.
     * Call this after login or on protected page load.
     */
    function redirectToDashboard(user) {
        if (!user) {
            window.location.href = resolvePath('login.html');
            return;
        }

        if (user.role === 'secretary') {
            // Secretary without a society → setup wizard
            if (!user.societyId && (!user.society || !user.society.id)) {
                window.location.href = resolvePath('society-setup.html');
            } else {
                window.location.href = resolvePath('dashboard.html');
            }
        } else if (user.role === 'resident') {
            window.location.href = resolvePath('dashboard.html');
        } else {
            // Unknown role — go to dashboard anyway
            window.location.href = resolvePath('dashboard.html');
        }
    }

    /**
     * Guard for protected pages.
     * Call this at the top of any protected page's script.
     * Returns the validated user object, or redirects to login.
     */
    async function requireAuth() {
        const user = await validateAndGetUser();
        if (!user) {
            window.location.href = resolvePath('login.html');
            return null;
        }
        return user;
    }

    /**
     * Guard for public-only pages (login, register).
     * If already logged in, redirect to dashboard.
     */
    async function requireGuest() {
        if (!getToken()) return; // Not logged in, good

        const user = await validateAndGetUser();
        if (user) {
            redirectToDashboard(user);
        }
    }

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
