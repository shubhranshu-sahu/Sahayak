/**
 * Sahayak — Login Page Script (login.js)
 */

document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();

    // If already logged in, redirect to dashboard
    await Router.requireGuest();

    /* ── DOM Refs ── */
    const form = document.getElementById('login-form');
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const submitBtn = document.getElementById('login-submit');
    const alert = document.getElementById('login-alert');
    const alertText = document.getElementById('login-alert-text');
    const togglePwd = document.getElementById('toggle-password');

    /* ── Password toggle ── */
    if (togglePwd) {
        togglePwd.addEventListener('click', () => {
            const isPassword = passwordInput.type === 'password';
            passwordInput.type = isPassword ? 'text' : 'password';
            // Swap icon
            togglePwd.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}"></i>`;
            lucide.createIcons({ nodes: [togglePwd] });
        });
    }

    /* ── Show Alert ── */
    function showAlert(msg, type = 'error') {
        alert.className = `auth-alert alert-${type} visible`;
        alertText.textContent = msg;
        const iconName = type === 'error' ? 'alert-circle' : type === 'success' ? 'check-circle' : 'alert-triangle';
        const iconBox = document.getElementById('login-alert-icon');
        if (iconBox) {
            iconBox.innerHTML = `<i data-lucide="${iconName}"></i>`;
            lucide.createIcons({ nodes: [iconBox] });
        }
    }

    function hideAlert() {
        alert.classList.remove('visible');
    }

    /* ── Validate ── */
    function validateEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    /* ── Form Submit ── */
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideAlert();

            const email = emailInput.value.trim();
            const password = passwordInput.value;

            // Client-side validation
            let hasError = false;

            if (!validateEmail(email)) {
                document.getElementById('login-email-error').classList.add('visible');
                emailInput.classList.add('error');
                hasError = true;
            } else {
                document.getElementById('login-email-error').classList.remove('visible');
                emailInput.classList.remove('error');
            }

            if (!password) {
                document.getElementById('login-password-error').classList.add('visible');
                passwordInput.classList.add('error');
                hasError = true;
            } else {
                document.getElementById('login-password-error').classList.remove('visible');
                passwordInput.classList.remove('error');
            }

            if (hasError) return;

            // Loading state
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;

            const res = await Api.post('/auth/login', { email, password });

            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;

            if (res.success && res.data) {
                // Save auth data
                Router.saveAuth(res.data.token, res.data.user);
                Toast.success('Login successful! Redirecting...');

                // Small delay for toast visibility
                setTimeout(() => {
                    Router.redirectToDashboard(res.data.user);
                }, 600);
            } else {
                const msg = res.message || 'Login failed. Please try again.';
                if (msg.toLowerCase().includes('pending')) {
                    showAlert('Registration pending secretary approval. You will be able to log in once approved by your society secretary.', 'warning');
                } else {
                    showAlert(msg, 'error');
                }
            }
        });
    }

    // Clear field errors on input
    if (emailInput) {
        emailInput.addEventListener('input', () => {
            document.getElementById('login-email-error').classList.remove('visible');
            emailInput.classList.remove('error');
        });
    }
    if (passwordInput) {
        passwordInput.addEventListener('input', () => {
            document.getElementById('login-password-error').classList.remove('visible');
            passwordInput.classList.remove('error');
        });
    }
});
