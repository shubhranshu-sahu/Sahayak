import { pool } from '../../config/db.js';

const ALLOWED_CATEGORIES = ['general', 'maintenance', 'security', 'event', 'emergency', 'financial'];
const ALLOWED_PRIORITIES = ['low', 'normal', 'urgent'];
const ALLOWED_TARGET_TYPES = ['all', 'block', 'floor', 'unit', 'user', 'role'];
const ALLOWED_ROLES = ['owner', 'tenant'];

const _validateAndResolveTarget = async (conn, societyId, targetType, targetId, targetRole) => {
  if (targetType === 'all') return { valid: true, label: 'All Residents' };

  if (targetType === 'role') {
    if (!ALLOWED_ROLES.includes(targetRole)) {
      throw { status: 400, message: "target_role must be 'owner' or 'tenant' when target_type is 'role'." };
    }
    return { valid: true, label: `All ${targetRole.charAt(0).toUpperCase() + targetRole.slice(1)}s` };
  }

  if (!targetId || !Number.isInteger(Number(targetId)) || Number(targetId) <= 0) {
    throw { status: 400, message: `target_id is required as a positive integer for target_type '${targetType}'.` };
  }

  const id = Number(targetId);

  if (targetType === 'block') {
    const [rows] = await conn.execute(
      'SELECT id, block_name FROM blocks WHERE id = ? AND society_id = ?', [id, societyId]
    );
    if (!rows.length) throw { status: 404, message: `Block id ${id} not found in this society.` };
    return { valid: true, label: `Block ${rows[0].block_name}` };
  }

  if (targetType === 'floor') {
    const [rows] = await conn.execute(
      `SELECT f.floor_number, b.block_name
       FROM floors f JOIN blocks b ON b.id = f.block_id
       WHERE f.id = ? AND b.society_id = ?`, [id, societyId]
    );
    if (!rows.length) throw { status: 404, message: `Floor id ${id} not found in this society.` };
    return { valid: true, label: `Block ${rows[0].block_name} - Floor ${rows[0].floor_number}` };
  }

  if (targetType === 'unit') {
    const [rows] = await conn.execute(
      `SELECT u.unit_number, b.block_name
       FROM units u JOIN floors fl ON fl.id = u.floor_id JOIN blocks b ON b.id = fl.block_id
       WHERE u.id = ? AND b.society_id = ?`, [id, societyId]
    );
    if (!rows.length) throw { status: 404, message: `Unit id ${id} not found in this society.` };
    return { valid: true, label: `Unit ${rows[0].block_name}-${rows[0].unit_number}` };
  }

  if (targetType === 'user') {
    const [rows] = await conn.execute(
      "SELECT id, name FROM users WHERE id = ? AND society_id = ? AND role = 'resident' AND status = 'active'",
      [id, societyId]
    );
    if (!rows.length) throw { status: 404, message: `Active resident id ${id} not found in this society.` };
    return { valid: true, label: `${rows[0].name} (Personal)` };
  }

  throw { status: 400, message: `Unknown target_type: ${targetType}` };
};

const _getResidentContext = async (conn, unitId) => {
  if (!unitId) return { blockId: null, floorId: null, occupantType: null };
  const [rows] = await conn.execute(
    'SELECT u.floor_id, u.occupant_type, fl.block_id FROM units u JOIN floors fl ON fl.id = u.floor_id WHERE u.id = ?',
    [unitId]
  );
  if (!rows.length) return { blockId: null, floorId: null, occupantType: null };
  return { blockId: rows[0].block_id, floorId: rows[0].floor_id, occupantType: rows[0].occupant_type };
};

const _buildTargetingClause = (userId, unitId, blockId, floorId, occupantType) => ({
  sql: `(
    a.target_type = 'all'
    OR (a.target_type = 'block' AND a.target_id = ?)
    OR (a.target_type = 'floor' AND a.target_id = ?)
    OR (a.target_type = 'unit'  AND a.target_id = ?)
    OR (a.target_type = 'user'  AND a.target_id = ?)
    OR (a.target_type = 'role'  AND a.target_role = ?)
  )`,
  params: [blockId, floorId, unitId, userId, occupantType],
});

export const createAnnouncement = async (societyId, createdBy, payload) => {
  const { title, content, category, priority = 'normal', target_type, target_id = null, target_role = null, expires_at } = payload;

  if (!title || typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 200)
    throw { status: 400, message: 'Title is required (5-200 characters).' };
  if (!content || typeof content !== 'string' || content.trim().length < 10 || content.trim().length > 5000)
    throw { status: 400, message: 'Content is required (10-5000 characters).' };
  if (!ALLOWED_CATEGORIES.includes(category))
    throw { status: 400, message: `Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(', ')}.` };
  if (!ALLOWED_PRIORITIES.includes(priority))
    throw { status: 400, message: `Invalid priority. Must be one of: ${ALLOWED_PRIORITIES.join(', ')}.` };
  if (!ALLOWED_TARGET_TYPES.includes(target_type))
    throw { status: 400, message: `Invalid target_type. Must be one of: ${ALLOWED_TARGET_TYPES.join(', ')}.` };
  if (!expires_at) throw { status: 400, message: 'expires_at is required.' };

  const expiryDate = new Date(expires_at);
  if (isNaN(expiryDate.getTime())) throw { status: 400, message: 'expires_at must be a valid ISO 8601 datetime.' };
  if (expiryDate <= new Date()) throw { status: 400, message: 'expires_at must be in the future.' };

  if (['all', 'role'].includes(target_type) && target_id != null)
    throw { status: 400, message: `target_id must not be provided when target_type is '${target_type}'.` };
  if (['block', 'floor', 'unit', 'user'].includes(target_type) && target_role != null)
    throw { status: 400, message: `target_role must not be provided when target_type is '${target_type}'.` };

  const conn = await pool.getConnection();
  try {
    const { label: targetLabel } = await _validateAndResolveTarget(conn, societyId, target_type, target_id, target_role);
    const [result] = await conn.execute(
      `INSERT INTO announcements (society_id, created_by, title, content, category, priority, target_type, target_id, target_role, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [societyId, createdBy, title.trim(), content.trim(), category, priority, target_type, target_id || null, target_role || null, expiryDate]
    );
    return { id: result.insertId, title: title.trim(), category, priority, target_type, target_id: target_id || null, target_role: target_role || null, target_label: targetLabel, expires_at: expiryDate, created_at: new Date() };
  } finally {
    conn.release();
  }
};


export const listAnnouncements = async (societyId, query) => {
  const { status = 'active', category, priority, target_type, page = 1, limit = 20 } = query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const conditions = ['a.society_id = ?', 'a.is_deleted = FALSE'];
  const params = [societyId];

  if (status === 'active') conditions.push('a.expires_at > NOW()');
  else if (status === 'expired') conditions.push('a.expires_at <= NOW()');

  if (category && ALLOWED_CATEGORIES.includes(category)) { conditions.push('a.category = ?'); params.push(category); }
  if (priority && ALLOWED_PRIORITIES.includes(priority)) { conditions.push('a.priority = ?'); params.push(priority); }
  if (target_type && ALLOWED_TARGET_TYPES.includes(target_type)) { conditions.push('a.target_type = ?'); params.push(target_type); }

  const whereClause = conditions.join(' AND ');
  const [rows] = await pool.execute(
    `SELECT a.id, a.title, a.category, a.priority, a.target_type, a.target_id, a.target_role,
            a.expires_at, a.created_at, (a.expires_at > NOW()) AS is_active,
            (SELECT COUNT(*) FROM announcement_reads ar WHERE ar.announcement_id = a.id) AS read_count
     FROM announcements a WHERE ${whereClause} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limitNum, offset]
  );

  const [[counts]] = await pool.execute(
    'SELECT SUM(expires_at > NOW()) AS total_active, SUM(expires_at <= NOW()) AS total_expired, COUNT(*) AS total_all FROM announcements WHERE society_id = ? AND is_deleted = FALSE',
    [societyId]
  );
  const [[{ total_count }]] = await pool.execute(`SELECT COUNT(*) AS total_count FROM announcements a WHERE ${whereClause}`, params);

  return {
    summary: { total_active: Number(counts.total_active || 0), total_expired: Number(counts.total_expired || 0), total_all: Number(counts.total_all || 0) },
    announcements: rows.map(r => ({ ...r, is_active: Boolean(r.is_active), read_count: Number(r.read_count) })),
    pagination: { page: pageNum, limit: limitNum, total: Number(total_count), total_pages: Math.ceil(Number(total_count) / limitNum) },
  };
};

export const getAnnouncementByIdSecretary = async (societyId, announcementId) => {
  const [[ann]] = await pool.execute(
    'SELECT a.*, (a.expires_at > NOW()) AS is_active FROM announcements a WHERE a.id = ? AND a.society_id = ? AND a.is_deleted = FALSE',
    [announcementId, societyId]
  );
  if (!ann) throw { status: 404, message: 'Announcement not found.' };

  let totalTargeted = 0;
  const conn = await pool.getConnection();
  try {
    const countQuery = {
      all: ['SELECT COUNT(*) AS c FROM users WHERE society_id = ? AND role = "resident" AND status = "active"', [societyId]],
      block: ['SELECT COUNT(DISTINCT u.id) AS c FROM users u JOIN units un ON un.id = u.unit_id JOIN floors fl ON fl.id = un.floor_id WHERE fl.block_id = ? AND u.society_id = ? AND u.role = "resident" AND u.status = "active"', [ann.target_id, societyId]],
      floor: ['SELECT COUNT(DISTINCT u.id) AS c FROM users u JOIN units un ON un.id = u.unit_id WHERE un.floor_id = ? AND u.society_id = ? AND u.role = "resident" AND u.status = "active"', [ann.target_id, societyId]],
      unit: ['SELECT COUNT(*) AS c FROM users WHERE unit_id = ? AND society_id = ? AND role = "resident" AND status = "active"', [ann.target_id, societyId]],
      role: ['SELECT COUNT(*) AS c FROM users u JOIN units un ON un.id = u.unit_id WHERE u.society_id = ? AND u.role = "resident" AND u.status = "active" AND un.occupant_type = ?', [societyId, ann.target_role]],
    };

    if (ann.target_type === 'user') {
      totalTargeted = 1;
    } else if (countQuery[ann.target_type]) {
      const [[r]] = await conn.execute(...countQuery[ann.target_type]);
      totalTargeted = Number(r.c);
    }

    const [[readStats]] = await conn.execute('SELECT COUNT(*) AS read_count FROM announcement_reads WHERE announcement_id = ?', [announcementId]);
    const readCount = Number(readStats.read_count);

    const [readers] = await conn.execute(
      `SELECT ar.resident_id, u.name AS resident_name, COALESCE(un.display_label, CONCAT(b.block_name, '-', un.unit_number)) AS unit_label, ar.read_at
       FROM announcement_reads ar
       JOIN users u ON u.id = ar.resident_id
       LEFT JOIN units un ON un.id = u.unit_id
       LEFT JOIN floors fl ON fl.id = un.floor_id
       LEFT JOIN blocks b ON b.id = fl.block_id
       WHERE ar.announcement_id = ? ORDER BY ar.read_at DESC`,
      [announcementId]
    );

    return {
      ...ann,
      is_active: Boolean(ann.is_active),
      read_stats: {
        total_targeted: totalTargeted,
        read_count: readCount,
        unread_count: Math.max(0, totalTargeted - readCount),
        read_percentage: totalTargeted > 0 ? parseFloat(((readCount / totalTargeted) * 100).toFixed(2)) : 0,
      },
      readers,
    };
  } finally {
    conn.release();
  }
};

export const getAnnouncementByIdResident = async (userId, societyId, unitId, announcementId) => {
  const conn = await pool.getConnection();
  try {
    const { blockId, floorId, occupantType } = await _getResidentContext(conn, unitId);
    const targeting = _buildTargetingClause(userId, unitId, blockId, floorId, occupantType);

    const [[ann]] = await conn.execute(
      `SELECT a.id, a.title, a.content, a.category, a.priority, a.expires_at, a.created_at,
              (a.expires_at > NOW()) AS is_active, ar.read_at, (ar.id IS NOT NULL) AS is_read
       FROM announcements a
       LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.resident_id = ?
       WHERE a.id = ? AND a.society_id = ? AND a.is_deleted = FALSE AND ${targeting.sql}`,
      [userId, announcementId, societyId, ...targeting.params]
    );

    if (!ann) {
      const [[exists]] = await conn.execute(
        'SELECT id FROM announcements WHERE id = ? AND society_id = ? AND is_deleted = FALSE',
        [announcementId, societyId]
      );
      if (!exists) throw { status: 404, message: 'Announcement not found.' };
      throw { status: 403, message: 'This announcement is not addressed to you.' };
    }

    return { ...ann, is_active: Boolean(ann.is_active), is_read: Boolean(ann.is_read) };
  } finally {
    conn.release();
  }
};


export const deleteAnnouncement = async (societyId, announcementId) => {
  const [[ann]] = await pool.execute(
    'SELECT id FROM announcements WHERE id = ? AND society_id = ? AND is_deleted = FALSE',
    [announcementId, societyId]
  );
  if (!ann) throw { status: 404, message: 'Announcement not found or already deleted.' };

  const now = new Date();
  await pool.execute('UPDATE announcements SET is_deleted = TRUE, deleted_at = ? WHERE id = ?', [now, announcementId]);
  return { id: announcementId, deleted_at: now };
};

export const deleteExpiredAnnouncements = async (societyId) => {
  const now = new Date();
  const [result] = await pool.execute(
    'UPDATE announcements SET is_deleted = TRUE, deleted_at = ? WHERE society_id = ? AND is_deleted = FALSE AND expires_at <= NOW()',
    [now, societyId]
  );
  return { deleted_count: result.affectedRows };
};


export const getMyAnnouncements = async (userId, societyId, unitId, query) => {
  const { include_expired = 'false', category, page = 1, limit = 20 } = query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const conn = await pool.getConnection();
  try {
    const { blockId, floorId, occupantType } = await _getResidentContext(conn, unitId);
    const targeting = _buildTargetingClause(userId, unitId, blockId, floorId, occupantType);

    const baseConditions = ['a.society_id = ?', 'a.is_deleted = FALSE', targeting.sql];
    const baseParams = [societyId, ...targeting.params];

    if (category && ALLOWED_CATEGORIES.includes(category)) {
      baseConditions.push('a.category = ?');
      baseParams.push(category);
    }

    const [activeRows] = await conn.execute(
      `SELECT a.id, a.title, a.content, a.category, a.priority, a.expires_at, a.created_at,
              ar.read_at, (ar.id IS NOT NULL) AS is_read
       FROM announcements a
       LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.resident_id = ?
       WHERE ${[...baseConditions, 'a.expires_at > NOW()'].join(' AND ')}
       ORDER BY FIELD(a.priority, 'urgent', 'normal', 'low'), a.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, ...baseParams, limitNum, offset]
    );

    const [[{ unread_count }]] = await conn.execute(
      `SELECT COUNT(*) AS unread_count FROM announcements a
       LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.resident_id = ?
       WHERE ${[...baseConditions, 'a.expires_at > NOW()', 'ar.id IS NULL'].join(' AND ')}`,
      [userId, ...baseParams]
    );

    const response = {
      active: activeRows.map(r => ({ ...r, is_read: Boolean(r.is_read) })),
      unread_count: Number(unread_count),
      pagination: { page: pageNum, limit: limitNum },
    };

    if (include_expired === 'true') {
      const [expiredRows] = await conn.execute(
        `SELECT a.id, a.title, a.content, a.category, a.priority, a.expires_at, a.created_at,
                ar.read_at, (ar.id IS NOT NULL) AS is_read
         FROM announcements a
         LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.resident_id = ?
         WHERE ${[...baseConditions, 'a.expires_at <= NOW()'].join(' AND ')}
         ORDER BY a.expires_at DESC LIMIT 20`,
        [userId, ...baseParams]
      );
      response.archived = expiredRows.map(r => ({ ...r, is_read: Boolean(r.is_read) }));
    }

    return response;
  } finally {
    conn.release();
  }
};

export const markAsRead = async (userId, societyId, unitId, announcementId) => {
  const conn = await pool.getConnection();
  try {
    const [[ann]] = await conn.execute(
      'SELECT id FROM announcements WHERE id = ? AND society_id = ? AND is_deleted = FALSE',
      [announcementId, societyId]
    );
    if (!ann) throw { status: 404, message: 'Announcement not found.' };

    const { blockId, floorId, occupantType } = await _getResidentContext(conn, unitId);
    const targeting = _buildTargetingClause(userId, unitId, blockId, floorId, occupantType);

    const [[targeted]] = await conn.execute(
      `SELECT id FROM announcements a WHERE a.id = ? AND ${targeting.sql}`,
      [announcementId, ...targeting.params]
    );
    if (!targeted) throw { status: 403, message: 'This announcement is not addressed to you.' };

    const [[existingRead]] = await conn.execute(
      'SELECT read_at FROM announcement_reads WHERE announcement_id = ? AND resident_id = ?',
      [announcementId, userId]
    );
    if (existingRead) return { announcement_id: announcementId, resident_id: userId, read_at: existingRead.read_at, already_read: true };

    const now = new Date();
    await conn.execute(
      'INSERT IGNORE INTO announcement_reads (announcement_id, resident_id, read_at) VALUES (?, ?, ?)',
      [announcementId, userId, now]
    );
    return { announcement_id: announcementId, resident_id: userId, read_at: now, already_read: false };
  } finally {
    conn.release();
  }
};
