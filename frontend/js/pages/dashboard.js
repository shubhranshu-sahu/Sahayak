/**
 * Sahayak — Dashboard Page Script (dashboard.js)
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Authenticate user (Secretary only)
    const user = await Router.requireAuth('secretary');
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

    // 4. Reveal real dashboard content and hide skeleton
    const skeleton = document.getElementById('dashboard-skeleton');
    const mainView = document.getElementById('dashboard-main-view');
    if (skeleton) skeleton.style.display = 'none';
    if (mainView) mainView.style.display = 'block';

    if (window.lucide) lucide.createIcons();

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
    let occupancyRate = 0;
    let totalBlocks = 0;
    let totalFloors = 0;

    // 1. Fetch Fast Dashboard Stats from dedicated Phase 1B API
    try {
        const statsRes = await Api.getDashboardStats();
        if (statsRes.success && statsRes.data) {
            const data = statsRes.data;
            const struct = data.structure || {};
            const resData = data.residents || {};

            totalUnits = struct.totalUnits || 0;
            occupiedUnits = struct.occupiedUnits || 0;
            vacantUnits = struct.vacantUnits || 0;
            occupancyRate = struct.occupancyRate !== undefined ? struct.occupancyRate : 0;
            totalBlocks = struct.totalBlocks || 0;
            totalFloors = struct.totalFloors || 0;

            activeCount = resData.active || 0;
            pendingCount = resData.pending || 0;

            if (Array.isArray(data.recentRegistrations)) {
                renderRecentRegistrations(data.recentRegistrations);
            }
        }
    } catch (err) {
        console.warn('[Dashboard] Could not fetch stats from /dashboard/stats:', err);
    }

    // 2. Fetch Pending Residents Queue for interactive action buttons
    try {
        const pendingRes = await Api.get('/secretary/residents/pending');
        if (pendingRes.success && Array.isArray(pendingRes.data)) {
            // Keep pendingCount aligned if returned
            pendingCount = pendingRes.data.length;
            renderPendingResidents(pendingRes.data);
        } else {
            renderEmptyPending();
        }
    } catch {
        renderEmptyPending();
    }

    // 3. Fetch Society Structure Overview for Block visualization
    try {
        const structRes = await Api.get('/society/structure');
        if (structRes.success && structRes.data && Array.isArray(structRes.data.blocks)) {
            renderStructureOverview(structRes.data.blocks);
        } else {
            renderEmptyStructure();
        }
    } catch {
        renderEmptyStructure();
    }

    // 4. Update Stats UI Cards
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

    const pendBadge = document.getElementById('stat-pending-badge');
    if (pendBadge) {
        pendBadge.textContent = pendingCount > 0 ? `${pendingCount} Needs Review` : 'All Clear';
        pendBadge.className = `stat-badge ${pendingCount > 0 ? 'amber' : 'positive'}`;
    }

    const occRateEl = document.getElementById('stat-occupancy-rate');
    if (occRateEl) occRateEl.textContent = `${occupancyRate}%`;

    const occRateBadge = document.getElementById('stat-occupancy-badge');
    if (occRateBadge) {
        occRateBadge.textContent = occupancyRate >= 70 ? 'High Occupancy' : occupancyRate >= 40 ? 'Moderate' : 'Available';
    }

    const blocksFloorsEl = document.getElementById('stat-blocks-floors');
    if (blocksFloorsEl) blocksFloorsEl.textContent = `· ${totalBlocks} Blocks · ${totalFloors} Floors`;

    // Update pending badge in sidebar if pending > 0
    const sidebarPendingBadge = document.getElementById('sidebar-pending-badge');
    if (sidebarPendingBadge) {
        if (pendingCount > 0) {
            sidebarPendingBadge.textContent = pendingCount;
            sidebarPendingBadge.style.display = 'inline-block';
        } else {
            sidebarPendingBadge.style.display = 'none';
        }
    }

    // Update complaints badge in sidebar
    try {
        const compRes = await Api.getSecretaryComplaints({ limit: 1 });
        if (compRes.success && compRes.data && compRes.data.counts) {
            const openComp = compRes.data.counts.open || 0;
            const compBadge = document.getElementById('sidebar-complaints-badge');
            if (compBadge) {
                if (openComp > 0) {
                    compBadge.textContent = openComp;
                    compBadge.style.display = 'inline-block';
                } else {
                    compBadge.style.display = 'none';
                }
            }
        }
    } catch {
        // Silently handle
    }
}

function renderRecentRegistrations(registrations) {
    const container = document.getElementById('recent-registrations-container');
    if (!container) return;

    if (!registrations || registrations.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: var(--sp-4);">
                <p style="font-size: var(--fs-xs); color: var(--clr-text-secondary); margin: 0;">No resident signups yet.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <ul style="list-style: none; display: flex; flex-direction: column; gap: var(--sp-3); font-size: var(--fs-xs); padding: 0; margin: 0;">
            ${registrations.map(r => {
                const initial = (r.name || 'R').charAt(0).toUpperCase();
                const unitText = r.unitLabel || 'Flat Pending';
                const statusColor = r.status === 'active' ? '#2E7D32' : r.status === 'pending' ? '#E65100' : r.status === 'rejected' ? '#C62828' : '#546E7A';
                const statusBg = r.status === 'active' ? '#E8F5E9' : r.status === 'pending' ? '#FFF3E0' : r.status === 'rejected' ? '#FFEBEE' : '#ECEFF1';
                const dateText = r.registeredAt ? (Utils && Utils.formatDate ? Utils.formatDate(r.registeredAt) : new Date(r.registeredAt).toLocaleDateString()) : 'Recent';

                return `
                    <li style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--clr-border);">
                        <div style="display: flex; gap: var(--sp-3); align-items: center;">
                            <div style="width: 30px; height: 30px; border-radius: 50%; background: var(--clr-surface-dim); border: 1px solid var(--clr-border); color: var(--clr-primary); display: flex; align-items: center; justify-content: center; font-weight: 700;">
                                ${initial}
                            </div>
                            <div>
                                <div style="font-weight: 600; color: var(--clr-text-primary);">${r.name}</div>
                                <div style="color: var(--clr-text-secondary); font-size: 11px;">Flat ${unitText} · ${dateText}</div>
                            </div>
                        </div>
                        <span style="font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 12px; background: ${statusBg}; color: ${statusColor}; text-transform: capitalize;">
                            ${r.status}
                        </span>
                    </li>
                `;
            }).join('')}
        </ul>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [container] });
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
