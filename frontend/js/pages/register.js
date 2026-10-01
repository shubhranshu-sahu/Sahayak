/**
 * Sahayak — Register Page Script (register.js)
 */

document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();

    // If already logged in, redirect
    await Router.requireGuest();

    /* ══════════ DOM Refs ══════════ */
    const tabSecretary = document.getElementById('tab-secretary');
    const tabResident = document.getElementById('tab-resident');
    const formSecretary = document.getElementById('form-secretary');
    const formResident = document.getElementById('form-resident');
    const alert = document.getElementById('register-alert');
    const alertText = document.getElementById('register-alert-text');

    // Cascading dropdown refs
    const societySelect = document.getElementById('res-society');
    const blockSelect = document.getElementById('res-block');
    const floorSelect = document.getElementById('res-floor');
    const unitSelect = document.getElementById('res-unit');


    /* ══════════ Tab Switching ══════════ */
    function switchTab(role) {
        hideAlert();

        if (role === 'secretary') {
            tabSecretary.classList.add('active');
            tabResident.classList.remove('active');
            formSecretary.style.display = 'block';
            formResident.style.display = 'none';
        } else {
            tabResident.classList.add('active');
            tabSecretary.classList.remove('active');
            formResident.style.display = 'block';
            formSecretary.style.display = 'none';
            // Load societies when resident tab is activated
            loadSocieties();
        }
    }

    if (tabSecretary) tabSecretary.addEventListener('click', () => switchTab('secretary'));
    if (tabResident) tabResident.addEventListener('click', () => switchTab('resident'));


    /* ══════════ Alert Helpers ══════════ */
    function showAlert(msg, type = 'error') {
        alert.className = `auth-alert alert-${type} visible`;
        alertText.textContent = msg;
        const iconName = type === 'error' ? 'alert-circle' : type === 'success' ? 'check-circle' : 'alert-triangle';
        const iconBox = document.getElementById('register-alert-icon');
        if (iconBox) {
            iconBox.innerHTML = `<i data-lucide="${iconName}"></i>`;
            lucide.createIcons({ nodes: [iconBox] });
        }
    }

    function hideAlert() {
        alert.classList.remove('visible');
    }


    /* ══════════ Validation Helpers ══════════ */
    function validateEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function validatePhone(phone) {
        return /^\+?\d{10,15}$/.test(phone.replace(/\s/g, ''));
    }

    function showFieldError(id) {
        const errEl = document.getElementById(id);
        if (errEl) errEl.classList.add('visible');
        // Also highlight the input
        const input = document.getElementById(id.replace('-error', ''));
        if (input) input.classList.add('error');
    }

    function clearFieldError(id) {
        const errEl = document.getElementById(id);
        if (errEl) errEl.classList.remove('visible');
        const input = document.getElementById(id.replace('-error', ''));
        if (input) input.classList.remove('error');
    }

    // Auto-clear errors on input
    document.querySelectorAll('.form-input, .form-select').forEach(el => {
        const errId = el.id + '-error';
        el.addEventListener('input', () => clearFieldError(errId));
        el.addEventListener('change', () => clearFieldError(errId));
    });


    /* ══════════ Password Toggle ══════════ */
    document.querySelectorAll('.form-password-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            btn.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}"></i>`;
            lucide.createIcons({ nodes: [btn] });
        });
    });


    /* ══════════ Secretary Registration ══════════ */
    if (formSecretary) {
        formSecretary.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideAlert();

            const name = document.getElementById('sec-name').value.trim();
            const email = document.getElementById('sec-email').value.trim();
            const phone = document.getElementById('sec-phone').value.trim();
            const password = document.getElementById('sec-password').value;

            let hasError = false;

            if (!name) { showFieldError('sec-name-error'); hasError = true; }
            if (!validateEmail(email)) { showFieldError('sec-email-error'); hasError = true; }
            if (!validatePhone(phone)) { showFieldError('sec-phone-error'); hasError = true; }
            if (password.length < 8) { showFieldError('sec-password-error'); hasError = true; }

            if (hasError) return;

            const submitBtn = document.getElementById('sec-submit');
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;

            const res = await Api.post('/auth/register/secretary', {
                name, email, phone, password
            });

            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;

            if (res.success) {
                showAlert('Registration successful! Redirecting to login...', 'success');
                Toast.success('Account created! Please log in.');
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 1500);
            } else {
                let errorMsg = res.message || 'Registration failed. Please try again.';
                if (Array.isArray(res.error) && res.error.length > 0) {
                    errorMsg = res.error.map(e => e.message || `${e.field} is invalid`).join('. ');
                    res.error.forEach(e => {
                        if (e.field) showFieldError(`sec-${e.field}-error`);
                    });
                }
                showAlert(errorMsg);
            }
        });
    }


    /* ══════════ Cascading Dropdowns ══════════ */
    let societiesLoaded = false;
    let societiesLoading = false;

    async function loadSocieties() {
        if (societiesLoaded || societiesLoading) return;
        societiesLoading = true;

        const step = document.getElementById('step-society');
        if (step) step.classList.add('loading');
        if (societySelect) societySelect.innerHTML = '<option value="" disabled selected>Loading...</option>';

        const res = await Api.get('/public/societies');

        if (step) step.classList.remove('loading');
        societiesLoading = false;

        if (res.success && res.data && res.data.length > 0) {
            societySelect.innerHTML = '<option value="" disabled selected>Select your society</option>';
            res.data.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = `${s.name} (${s.societyCode})`;
                societySelect.appendChild(opt);
            });
            societiesLoaded = true;
        } else {
            if (societySelect) societySelect.innerHTML = '<option value="" disabled selected>No societies found</option>';
        }
    }

    // Society → load blocks
    if (societySelect) {
        societySelect.addEventListener('change', async () => {
            const societyId = societySelect.value;

            // Reset downstream
            resetSelect(blockSelect, 'Loading blocks...');
            resetSelect(floorSelect, 'Select block first');
            resetSelect(unitSelect, 'Select floor first');
            floorSelect.disabled = true;
            unitSelect.disabled = true;

            const step = document.getElementById('step-block');
            if (step) step.classList.add('loading');
            blockSelect.disabled = true;

            const res = await Api.get(`/public/societies/${societyId}/blocks`);
            if (step) step.classList.remove('loading');

            if (res.success && res.data && res.data.length > 0) {
                blockSelect.innerHTML = '<option value="" disabled selected>Select block</option>';
                res.data.forEach(b => {
                    const opt = document.createElement('option');
                    opt.value = b.id;
                    opt.textContent = `Block ${b.blockName}`;
                    blockSelect.appendChild(opt);
                });
                blockSelect.disabled = false;
            } else {
                blockSelect.innerHTML = '<option value="" disabled selected>No blocks found</option>';
            }
        });
    }

    // Block → load floors
    if (blockSelect) {
        blockSelect.addEventListener('change', async () => {
            const blockId = blockSelect.value;

            resetSelect(floorSelect, 'Loading floors...');
            resetSelect(unitSelect, 'Select floor first');
            unitSelect.disabled = true;

            const step = document.getElementById('step-floor');
            if (step) step.classList.add('loading');
            floorSelect.disabled = true;

            const res = await Api.get(`/public/blocks/${blockId}/floors`);
            if (step) step.classList.remove('loading');

            if (res.success && res.data && res.data.length > 0) {
                floorSelect.innerHTML = '<option value="" disabled selected>Select floor</option>';
                res.data.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f.id;
                    opt.textContent = `Floor ${f.floorNumber}`;
                    floorSelect.appendChild(opt);
                });
                floorSelect.disabled = false;
            } else {
                floorSelect.innerHTML = '<option value="" disabled selected>No floors found</option>';
            }
        });
    }

    // Floor → load units
    if (floorSelect) {
        floorSelect.addEventListener('change', async () => {
            const floorId = floorSelect.value;

            resetSelect(unitSelect, 'Loading units...');

            const step = document.getElementById('step-unit');
            if (step) step.classList.add('loading');
            unitSelect.disabled = true;

            const res = await Api.get(`/public/floors/${floorId}/units`);
            if (step) step.classList.remove('loading');

            if (res.success && res.data && res.data.length > 0) {
                unitSelect.innerHTML = '<option value="" disabled selected>Select unit</option>';
                res.data.forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = u.id;
                    opt.textContent = u.displayLabel;

                    // Disable occupied units
                    if (!u.isSelectable || u.status === 'occupied') {
                        opt.disabled = true;
                        opt.textContent += ' (Occupied)';
                        opt.classList.add('unit-occupied');
                    }

                    unitSelect.appendChild(opt);
                });
                unitSelect.disabled = false;
            } else {
                unitSelect.innerHTML = '<option value="" disabled selected>No units found</option>';
            }
        });
    }

    function resetSelect(selectEl, placeholder) {
        if (selectEl) {
            selectEl.innerHTML = `<option value="" disabled selected>${placeholder}</option>`;
        }
    }


    /* ══════════ Resident Registration ══════════ */
    if (formResident) {
        formResident.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideAlert();

            const name = document.getElementById('res-name').value.trim();
            const email = document.getElementById('res-email').value.trim();
            const phone = document.getElementById('res-phone').value.trim();
            const password = document.getElementById('res-password').value;
            const societyId = societySelect.value;
            const unitId = unitSelect.value;

            let hasError = false;

            if (!name) { showFieldError('res-name-error'); hasError = true; }
            if (!validateEmail(email)) { showFieldError('res-email-error'); hasError = true; }
            if (!validatePhone(phone)) { showFieldError('res-phone-error'); hasError = true; }
            if (password.length < 8) { showFieldError('res-password-error'); hasError = true; }
            if (!societyId) { showFieldError('res-society-error'); hasError = true; }
            if (!unitId) { showFieldError('res-unit-error'); hasError = true; }

            if (hasError) return;

            const submitBtn = document.getElementById('res-submit');
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;

            const res = await Api.post('/auth/register/resident', {
                name,
                email,
                phone,
                password,
                society_id: parseInt(societyId),
                unit_id: parseInt(unitId),
            });

            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;

            if (res.success) {
                showAlert('Registration submitted! Awaiting secretary approval.', 'success');
                Toast.success('Registration submitted! You\'ll be able to login once approved.');
                // Disable form
                formResident.querySelectorAll('input, select, button[type="submit"]').forEach(el => {
                    el.disabled = true;
                });
            } else {
                let errorMsg = res.message || 'Registration failed. Please try again.';
                if (Array.isArray(res.error) && res.error.length > 0) {
                    errorMsg = res.error.map(e => e.message || `${e.field} is invalid`).join('. ');
                    res.error.forEach(e => {
                        if (e.field) showFieldError(`res-${e.field}-error`);
                    });
                }
                showAlert(errorMsg);
            }
        });
    }
});
