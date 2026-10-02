/**
 * Sahayak — Dashboard Page Script (dashboard.js)
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Authenticate user
    const user = await Router.requireAuth();
    if (!user) return;

    // 2. Initialize Layout
    Components.initSidebar('dashboard');
    Components.initTopbar({
        title: 'Society Overview',
        subtitle: user.society ? `${user.society.name} · Dashboard` : 'Smart Society Management',
        actionBtn: {
            text: 'Society Setup',
            href: 'society-setup.html',
            icon: 'plus',
        }
    });

    // Set user name in banner
    const nameEl = document.getElementById('banner-user-name');
    if (nameEl) nameEl.textContent = user.name || 'Secretary';

    if (user.society && user.society.name) {
        const tagEl = document.getElementById('banner-society-tag');
        if (tagEl) tagEl.textContent = user.society.name;
        const btnSetup = document.getElementById('btn-banner-setup');
        if (btnSetup) btnSetup.innerHTML = '<i data-lucide="layers"></i> <span>Manage Structure</span>';
    }

    // 3. Fetch Dashboard Metrics
    await loadDashboardData(user);

    // Hide page loader
    Components.hidePageLoader();
    lucide.createIcons();

    // Quick AI Form trigger
    const aiForm = document.getElementById('ai-quick-form');
    if (aiForm) {
        aiForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const prompt = document.getElementById('ai-quick-input').value.trim();
            if (prompt) {
                window.location.href = `chat.html?prompt=${encodeURIComponent(prompt)}`;
            }
        });
    }

    // Quick Prompt Chips click
    document.querySelectorAll('.prompt-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.dataset.prompt;
            if (prompt) {
                window.location.href = `chat.html?prompt=${encodeURIComponent(prompt)}`;
            }
        });
    });
});

/**
 * Fetch live or dummy metrics for dashboard
 */
async function loadDashboardData(user) {
    let pendingCount = 0;
    let activeCount = 0;
    let totalUnits = 0;
    let occupiedUnits = 0;
    let vacantUnits = 0;

    // Try fetching Pending Residents
    try {
        const pendingRes = await Api.get('/secretary/residents/pending');
        if (pendingRes.success && Array.isArray(pendingRes.data)) {
            pendingCount = pendingRes.data.length;
            renderPendingResidents(pendingRes.data);
        } else {
            renderEmptyPending();
        }
    } catch {
        renderEmptyPending();
    }

    // Try fetching Society Structure
    try {
        const structRes = await Api.get('/society/structure');
        if (structRes.success && structRes.data && Array.isArray(structRes.data.blocks)) {
            const blocks = structRes.data.blocks;
            blocks.forEach(b => {
                (b.floors || []).forEach(f => {
                    (f.units || []).forEach(u => {
                        totalUnits++;
                        if (u.status === 'occupied') occupiedUnits++;
                        else vacantUnits++;
                    });
                });
            });
            renderStructureOverview(blocks);
        } else {
            renderEmptyStructure();
        }
    } catch {
        renderEmptyStructure();
    }

    // Try fetching Active Residents
    try {
        const activeRes = await Api.get('/secretary/residents');
        if (activeRes.success && Array.isArray(activeRes.data)) {
            activeCount = activeRes.data.length;
        }
    } catch {
        activeCount = 0;
    }

    // Update stats cards
    const totalEl = document.getElementById('stat-total-units');
    if (totalEl) totalEl.textContent = totalUnits > 0 ? totalUnits : '0';

    const occEl = document.getElementById('stat-units-occupied');
    if (occEl) occEl.textContent = `${occupiedUnits} Occupied`;

    const vacEl = document.getElementById('stat-units-vacant');
    if (vacEl) vacEl.textContent = `· ${vacantUnits} Vacant`;

    const actEl = document.getElementById('stat-active-residents');
    if (actEl) actEl.textContent = activeCount;

    const pendEl = document.getElementById('stat-pending-approvals');
    if (pendEl) pendEl.textContent = pendingCount;

    // Update pending badge in sidebar if pending > 0
    const sidebarPendingBadge = document.getElementById('sidebar-pending-badge');
    if (sidebarPendingBadge && pendingCount > 0) {
        sidebarPendingBadge.textContent = pendingCount;
        sidebarPendingBadge.style.display = 'inline-block';
    }
}

function renderPendingResidents(residents) {
    const list = document.getElementById('pending-residents-list');
    if (!list) return;

    if (!residents || residents.length === 0) {
        renderEmptyPending();
        return;
    }

    list.innerHTML = '';
    residents.slice(0, 5).forEach(r => {
        const initial = (r.name || 'R').charAt(0).toUpperCase();
        const unitLabel = (r.unit && r.unit.displayLabel) || 'Unit Pending';
        const div = document.createElement('div');
        div.className = 'pending-resident-item';
        div.innerHTML = `
            <div class="resident-info-block">
                <div class="resident-avatar-small">${initial}</div>
                <div>
                    <div class="resident-name-text">${r.name}</div>
                    <div class="resident-unit-badge">
                        <span>Unit:</span>
                        <span class="resident-unit-pill">${unitLabel}</span>
                        <span>· ${r.phone || r.email}</span>
                    </div>
                </div>
            </div>
            <div class="approval-actions">
                <button class="btn-approve" onclick="handleApproval(${r.userId}, 'approve', this)">
                    <i data-lucide="check" style="width: 14px;"></i>
                    <span>Approve</span>
                </button>
                <button class="btn-reject" onclick="handleApproval(${r.userId}, 'reject', this)">
                    <span>Reject</span>
                </button>
            </div>
        `;
        list.appendChild(div);
    });
    lucide.createIcons({ nodes: [list] });
}

function renderEmptyPending() {
    const list = document.getElementById('pending-residents-list');
    if (!list) return;
    list.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">
                <i data-lucide="check-circle-2"></i>
            </div>
            <h4>No Pending Approvals</h4>
            <p>All resident registrations are up to date! When new residents sign up, they will appear here for verification.</p>
        </div>
    `;
    lucide.createIcons({ nodes: [list] });
}

function renderStructureOverview(blocks) {
    const container = document.getElementById('structure-preview-container');
    if (!container) return;

    if (!blocks || blocks.length === 0) {
        renderEmptyStructure();
        return;
    }

    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--sp-4);">
            ${blocks.map(b => {
                let total = 0;
                let occ = 0;
                (b.floors || []).forEach(f => {
                    (f.units || []).forEach(u => {
                        total++;
                        if (u.status === 'occupied') occ++;
                    });
                });
                const pct = total > 0 ? Math.round((occ / total) * 100) : 0;
                return `
                    <div style="background: var(--clr-surface-dim); border: 1px solid var(--clr-border); border-radius: var(--radius-md); padding: var(--sp-4);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--sp-2);">
                            <span style="font-weight: 700; color: var(--clr-primary);">Block ${b.blockName}</span>
                            <span style="font-size: 11px; color: var(--clr-text-secondary);">${b.floors ? b.floors.length : 0} Floors</span>
                        </div>
                        <div style="font-size: var(--fs-xs); color: var(--clr-text-secondary); margin-bottom: var(--sp-2);">
                            ${occ} / ${total} Units Occupied (${pct}%)
                        </div>
                        <div style="height: 6px; background: rgba(92, 26, 51, 0.1); border-radius: var(--radius-full); overflow: hidden;">
                            <div style="height: 100%; width: ${pct}%; background: var(--clr-primary);"></div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
    lucide.createIcons({ nodes: [container] });
}

function renderEmptyStructure() {
    const container = document.getElementById('structure-preview-container');
    if (!container) return;
    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">
                <i data-lucide="building"></i>
            </div>
            <h4>No Structure Created Yet</h4>
            <p>Setup your society blocks, floors, and units using the guided setup wizard.</p>
            <a href="society-setup.html" class="btn-quick-action" style="margin-top: var(--sp-4); display: inline-flex;">
                <i data-lucide="plus"></i>
                <span>Start Society Setup</span>
            </a>
        </div>
    `;
    lucide.createIcons({ nodes: [container] });
}

/**
 * Approve / Reject resident
 */
async function handleApproval(residentId, action, btn) {
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner" style="display:inline-block; width:14px; height:14px; border-width:2px; vertical-align:middle;"></span> Processing...';

    const res = await Api.post(`/secretary/residents/${residentId}/${action}`);
    if (res.success) {
        Toast.success(action === 'approve' ? 'Resident approved!' : 'Resident rejected.');
        // Refresh list
        const pendingRes = await Api.get('/secretary/residents/pending');
        if (pendingRes.success) renderPendingResidents(pendingRes.data);
    } else {
        Toast.error(res.message || 'Action failed.');
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Expose handleApproval for onclick in dynamic elements
window.handleApproval = handleApproval;
