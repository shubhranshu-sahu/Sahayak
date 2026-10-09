/**
 * Sahayak — Resident Dashboard Page Logic (resident-dashboard.js)
 * Loads resident profile, unit details, society info, and resident AI assistant.
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Guard check: Must be authenticated and have role = 'resident'
    const user = await Router.requireAuth('resident');
    if (!user) return;

    // 2. Initialize Shared Components
    Components.initSidebar('resident-dashboard');
    Components.initTopbar({
        title: 'Resident Portal',
        subtitle: `Flat ${user.unit ? user.unit.displayLabel : '--'} · ${(user.society && user.society.name) || 'My Society'}`,
    });

    // 3. Populate Resident Details
    renderResidentData(user);

    // 4. Setup Event Listeners
    setupEventListeners(user);

    // 5. Load Real Complaints Count
    loadResidentComplaintsCount();

    // 6. Hide Skeleton and Reveal Content
    const skeleton = document.getElementById('resident-skeleton');
    const mainView = document.getElementById('resident-main-view');
    if (skeleton && mainView) {
        skeleton.style.display = 'none';
        mainView.style.display = 'block';
    }

    if (window.lucide) {
        lucide.createIcons();
    }
});

function renderResidentData(user) {
    const unit = user.unit || {};
    const society = user.society || {};

    const unitLabel = unit.displayLabel || 'Pending Allocation';
    const blockName = unit.blockName || unit.block || '--';
    const floorNo = unit.floorNumber !== undefined ? unit.floorNumber : (unit.floor !== undefined ? unit.floor : '--');
    const socName = society.name || 'Sunrise Apartments';
    const socCode = society.societyCode || '--';

    // Banner
    const bannerName = document.getElementById('banner-resident-name');
    if (bannerName) bannerName.textContent = user.name || 'Resident';

    const bannerSoc = document.getElementById('banner-society-name');
    if (bannerSoc) bannerSoc.textContent = socName;

    const flatBadge = document.getElementById('badge-flat-number');
    if (flatBadge) flatBadge.textContent = `Flat ${unitLabel}`;

    const blockFloorBadge = document.getElementById('badge-block-floor');
    if (blockFloorBadge) blockFloorBadge.textContent = `Block ${blockName} · Floor ${floorNo}`;

    // Stat Cards
    const cardUnit = document.getElementById('card-unit-label');
    if (cardUnit) cardUnit.textContent = unitLabel;

    const cardBlock = document.getElementById('card-unit-block');
    if (cardBlock) cardBlock.textContent = `Block ${blockName} · Floor ${floorNo}`;

    const cardSocCode = document.getElementById('card-society-code');
    if (cardSocCode) cardSocCode.textContent = socCode;

    // Residence Profile Grid
    const infoUnit = document.getElementById('info-unit-label');
    if (infoUnit) infoUnit.textContent = unitLabel;

    const infoBlock = document.getElementById('info-block-name');
    if (infoBlock) infoBlock.textContent = `Block ${blockName}`;

    const infoFloor = document.getElementById('info-floor-number');
    if (infoFloor) infoFloor.textContent = `Floor ${floorNo}`;

    const infoPhone = document.getElementById('info-user-phone');
    if (infoPhone) infoPhone.textContent = user.phone || 'Not provided';

    const infoEmail = document.getElementById('info-user-email');
    if (infoEmail) infoEmail.textContent = user.email || 'Not provided';

    // Society Box
    const socDisplayName = document.getElementById('soc-display-name');
    if (socDisplayName) socDisplayName.textContent = socName;

    const socDisplayLocation = document.getElementById('soc-display-location');
    if (socDisplayLocation) socDisplayLocation.textContent = `Society Code: ${socCode}`;
}

function setupEventListeners(user) {
    const socCode = (user.society && user.society.societyCode) || '';

    // Copy Code Button
    const btnCopyCode = document.getElementById('btn-copy-code');
    const btnCopyText = document.getElementById('btn-copy-code-text');
    if (btnCopyCode) {
        btnCopyCode.addEventListener('click', () => {
            if (!socCode) return;
            navigator.clipboard.writeText(socCode).then(() => {
                Toast.success(`Copied society code ${socCode} to clipboard!`);
                if (btnCopyText) btnCopyText.textContent = 'Copied!';
                setTimeout(() => {
                    if (btnCopyText) btnCopyText.textContent = 'Copy Code';
                }, 2000);
            }).catch(() => {
                Toast.info(`Society Code: ${socCode}`);
            });
        });
    }

    // AI Prompt Chips
    document.querySelectorAll('.prompt-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.dataset.prompt;
            const input = document.getElementById('resident-ai-input');
            if (input) {
                input.value = prompt;
                input.focus();
            }
        });
    });

    // AI Form Submit
    const aiForm = document.getElementById('resident-ai-form');
    if (aiForm) {
        aiForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('resident-ai-input');
            const q = input ? input.value.trim() : '';
            if (q) {
                window.location.href = `chat.html?prompt=${encodeURIComponent(q)}`;
            } else {
                window.location.href = 'chat.html';
            }
        });
    }
}

async function loadResidentComplaintsCount() {
    try {
        const res = await Api.getMyComplaints({ limit: 1 });
        if (res.success && res.data) {
            const total = res.data.pagination ? res.data.pagination.total : 0;
            const cardTicketsCount = document.getElementById('card-tickets-count');
            const cardTicketsBadge = document.getElementById('card-tickets-badge');
            const cardTicketsSub = document.getElementById('card-tickets-sub');

            if (cardTicketsCount) cardTicketsCount.textContent = `${total} ${total === 1 ? 'Ticket' : 'Tickets'}`;
            if (cardTicketsBadge) {
                cardTicketsBadge.textContent = total > 0 ? 'Active' : 'All Clear';
                cardTicketsBadge.className = `stat-badge ${total > 0 ? 'amber' : 'positive'}`;
            }
            if (cardTicketsSub) cardTicketsSub.textContent = total > 0 ? 'Tap to view' : 'No issues reported';
        }
    } catch (err) {
        console.warn('Failed to load resident complaints count:', err);
    }
}
