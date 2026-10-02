/**
 * Sahayak — Centralized Configuration
 * Change API URLs here and they propagate everywhere.
 */
const CONFIG = Object.freeze({
    /* ── Backend (Node.js / Express — Purvi's service) ── */
    API_BASE: 'https://sahayak-yhn6.onrender.com/api/v1',

    /* ── AI Service (Python / FastAPI — Vansh's service) ── */
    AI_BASE: 'https://sahayak-tkt5.onrender.com',

    /* ── App Meta ── */
    APP_NAME: 'Sahayak',
    APP_TAGLINE: 'Smart Society Management',

    /* ── Auth ── */
    TOKEN_KEY: 'sahayak_token',      // localStorage key for JWT
    USER_KEY: 'sahayak_user',        // localStorage key for cached user object
});
