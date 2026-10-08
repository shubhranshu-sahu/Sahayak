import { pool } from '../../config/db.js';

const ALLOWED_CATEGORIES = [
  'plumbing',
  'electrical',
  'lift',
  'cleanliness',
  'security',
  'parking',
  'noise',
  'other',
];

/**
 * 1. Create a new complaint (Resident)
 */
export const createComplaint = async (societyId, residentId, unitId, payload) => {
  const { title, category, category_label, description, attachment_url } = payload;

  if (!title || typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 200) {
    throw { status: 400, message: 'Title is required (3 to 200 characters).' };
  }

  if (!description || typeof description !== 'string' || description.trim().length < 10) {
    throw { status: 400, message: 'Description is required (at least 10 characters).' };
  }

  if (!category || !ALLOWED_CATEGORIES.includes(category)) {
    throw { status: 400, message: `Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(', ')}` };
  }

  let finalCategoryLabel = null;
  if (category === 'other') {
    if (!category_label || typeof category_label !== 'string' || category_label.trim().length < 2) {
      throw { status: 400, message: 'category_label is required when category is "other".' };
    }
    finalCategoryLabel = category_label.trim();
  }

  if (!unitId) {
    throw { status: 400, message: 'Resident does not have an assigned unit. Contact your secretary.' };
  }

  const [result] = await pool.execute(
    `INSERT INTO complaints 
      (society_id, unit_id, resident_id, title, category, category_label, description, attachment_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
    [
      societyId,
      unitId,
      residentId,
      title.trim(),
      category,
      finalCategoryLabel,
      description.trim(),
      attachment_url || null,
    ]
  );

  return {
    complaintId: result.insertId,
    title: title.trim(),
    category,
    status: 'open',
  };
};


/**
 * 2. Get resident's complaints with pagination
 */
export const getMyComplaints = async (societyId, residentId, queryParams) => {
  const { status, page = 1, limit = 10 } = queryParams;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;

  let whereClause = 'WHERE c.society_id = ? AND c.resident_id = ?';
  const queryValues = [societyId, residentId];

  if (status) {
    whereClause += ' AND c.status = ?';
    queryValues.push(status);
  }

  // Count total
  const [countResult] = await pool.execute(
    `SELECT COUNT(*) AS total FROM complaints c ${whereClause}`,
    queryValues
  );
  const total = Number(countResult[0].total || 0);

  // Fetch paginated
  const sql = `
    SELECT 
      c.id,
      c.title,
      c.category,
      c.category_label,
      c.description,
      c.attachment_url,
      c.status,
      c.rejection_reason,
      c.closed_at,
      c.created_at,
      c.updated_at,
      u.id AS unit_id,
      u.display_label AS unit_label,
      u.block_name,
      u.floor_number,
      (SELECT COUNT(*) FROM complaint_replies WHERE complaint_id = c.id) AS reply_count
    FROM complaints c
    JOIN units u ON c.unit_id = u.id
    ${whereClause}
    ORDER BY c.created_at DESC
    LIMIT ${limitNum} OFFSET ${offset}
  `;

  const [rows] = await pool.execute(sql, queryValues);

  return {
    complaints: rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      categoryLabel: r.category_label,
      description: r.description,
      attachmentUrl: r.attachment_url,
      status: r.status,
      rejectionReason: r.rejection_reason,
      replyCount: Number(r.reply_count || 0),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      closedAt: r.closed_at,
      unit: {
        id: r.unit_id,
        displayLabel: r.unit_label,
        blockName: r.block_name,
        floorNumber: r.floor_number,
      },
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};

/**
 * 3. Get complaint details with thread (Resident & Secretary)
 */
export const getComplaintById = async (societyId, user, complaintId) => {
  const [complaints] = await pool.execute(
    `SELECT 
      c.id,
      c.society_id,
      c.resident_id,
      c.title,
      c.category,
      c.category_label,
      c.description,
      c.attachment_url,
      c.status,
      c.rejection_reason,
      c.closed_at,
      c.created_at,
      c.updated_at,
      u.id AS resident_user_id,
      u.name AS resident_name,
      u.email AS resident_email,
      u.phone AS resident_phone,
      un.id AS unit_id,
      un.display_label AS unit_label,
      un.block_name,
      un.floor_number
    FROM complaints c
    JOIN users u ON c.resident_id = u.id
    JOIN units un ON c.unit_id = un.id
    WHERE c.id = ? AND c.society_id = ?`,
    [complaintId, societyId]
  );

  if (complaints.length === 0) {
    throw { status: 404, message: 'Complaint not found.' };
  }

  const row = complaints[0];

  // If user is resident, they can only view their own complaint
  if (user.role === 'resident' && row.resident_id !== user.userId) {
    throw { status: 403, message: 'You are not authorized to view this complaint.' };
  }

  // Fetch thread messages
  const [replies] = await pool.execute(
    `SELECT 
      r.id,
      r.sender_id,
      r.sender_role,
      r.message,
      r.attachment_url,
      r.created_at,
      u.name AS sender_name
    FROM complaint_replies r
    LEFT JOIN users u ON r.sender_id = u.id
    WHERE r.complaint_id = ?
    ORDER BY r.created_at ASC`,
    [complaintId]
  );

  return {
    complaint: {
      id: row.id,
      title: row.title,
      category: row.category,
      categoryLabel: row.category_label,
      description: row.description,
      attachmentUrl: row.attachment_url,
      status: row.status,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      resident: {
        id: row.resident_user_id,
        name: row.resident_name,
        email: row.resident_email,
        phone: row.resident_phone,
      },
      unit: {
        id: row.unit_id,
        displayLabel: row.unit_label,
        blockName: row.block_name,
        floorNumber: row.floor_number,
      },
    },
    thread: replies.map((r) => ({
      id: r.id,
      senderId: r.sender_id,
      senderRole: r.sender_role,
      senderName: r.sender_role === 'system' ? 'System' : (r.sender_name || 'User'),
      message: r.message,
      attachmentUrl: r.attachment_url,
      createdAt: r.created_at,
    })),
  };
};

/**
 * 4. Add a reply to complaint thread
 */
export const addReply = async (societyId, user, complaintId, payload) => {
  const { message, attachment_url } = payload;

  const trimmedMessage = message && typeof message === 'string' ? message.trim() : null;
  const validAttachment = attachment_url && typeof attachment_url === 'string' ? attachment_url.trim() : null;

  if (!trimmedMessage && !validAttachment) {
    throw { status: 400, message: 'A reply must have either a message or an attachment.' };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Lock complaint
    const [complaints] = await connection.execute(
      'SELECT id, resident_id, status FROM complaints WHERE id = ? AND society_id = ? FOR UPDATE',
      [complaintId, societyId]
    );

    if (complaints.length === 0) {
      throw { status: 404, message: 'Complaint not found.' };
    }

    const complaint = complaints[0];

    // Resident check
    if (user.role === 'resident' && complaint.resident_id !== user.userId) {
      throw { status: 403, message: 'You can only reply to your own complaint.' };
    }

    // Terminal checks
    if (complaint.status === 'closed') {
      throw { status: 400, message: 'Cannot reply to a closed complaint.' };
    }
    if (complaint.status === 'rejected') {
      throw { status: 400, message: 'Cannot reply to a rejected complaint.' };
    }

    // Auto-advance status if secretary replies to an open complaint
    if (user.role === 'secretary' && complaint.status === 'open') {
      await connection.execute(
        'UPDATE complaints SET status = "in_progress" WHERE id = ?',
        [complaintId]
      );
    }

    // Insert reply
    const [result] = await connection.execute(
      `INSERT INTO complaint_replies (complaint_id, sender_id, sender_role, message, attachment_url)
       VALUES (?, ?, ?, ?, ?)`,
      [complaintId, user.userId, user.role, trimmedMessage, validAttachment]
    );

    await connection.commit();

    return {
      replyId: result.insertId,
      complaintId: Number(complaintId),
      senderRole: user.role,
      message: trimmedMessage,
      attachmentUrl: validAttachment,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * 5. Confirm resolution & close complaint (Resident)
 */
export const confirmResolution = async (societyId, residentId, complaintId, feedback) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [complaints] = await connection.execute(
      'SELECT id, status FROM complaints WHERE id = ? AND society_id = ? AND resident_id = ? FOR UPDATE',
      [complaintId, societyId, residentId]
    );

    if (complaints.length === 0) {
      throw { status: 404, message: 'Complaint not found.' };
    }

    const complaint = complaints[0];

    if (complaint.status === 'closed') {
      throw { status: 400, message: 'Complaint is already closed.' };
    }
    if (complaint.status === 'rejected') {
      throw { status: 400, message: 'Cannot confirm resolution on a rejected complaint.' };
    }
    if (complaint.status === 'open') {
      throw { status: 400, message: 'Complaint has not been addressed yet.' };
    }

    // Update status to closed
    await connection.execute(
      'UPDATE complaints SET status = "closed", closed_at = NOW() WHERE id = ?',
      [complaintId]
    );

    // Insert closure confirmation message
    const msg = feedback && typeof feedback === 'string' && feedback.trim()
      ? `Resident confirmed resolution: "${feedback.trim()}"`
      : 'Resident confirmed resolution. Complaint closed.';

    await connection.execute(
      `INSERT INTO complaint_replies (complaint_id, sender_id, sender_role, message)
       VALUES (?, ?, 'resident', ?)`,
      [complaintId, residentId, msg]
    );

    await connection.commit();

    return { complaintId: Number(complaintId), status: 'closed' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * 6. Reopen complaint (Resident)
 */
export const reopenComplaint = async (societyId, residentId, complaintId, reason) => {
  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    throw { status: 400, message: 'Reason is required to reopen the complaint (min 5 characters).' };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [complaints] = await connection.execute(
      'SELECT id, status FROM complaints WHERE id = ? AND society_id = ? AND resident_id = ? FOR UPDATE',
      [complaintId, societyId, residentId]
    );

    if (complaints.length === 0) {
      throw { status: 404, message: 'Complaint not found.' };
    }

    const complaint = complaints[0];

    if (complaint.status !== 'pending_closure') {
      throw {
        status: 400,
        message: `Only complaints in 'pending_closure' can be reopened. Current status: '${complaint.status}'.`,
      };
    }

    // Move back to in_progress
    await connection.execute(
      'UPDATE complaints SET status = "in_progress" WHERE id = ?',
      [complaintId]
    );

    // Insert reopen message
    await connection.execute(
      `INSERT INTO complaint_replies (complaint_id, sender_id, sender_role, message)
       VALUES (?, ?, 'resident', ?)`,
      [complaintId, residentId, `Reopened by resident: ${reason.trim()}`]
    );

    await connection.commit();

    return { complaintId: Number(complaintId), status: 'in_progress' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
