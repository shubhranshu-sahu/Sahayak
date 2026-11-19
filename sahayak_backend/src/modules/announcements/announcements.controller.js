import * as announcementsService from './announcements.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export const createAnnouncement = async (req, res, next) => {
  try {
    const data = await announcementsService.createAnnouncement(req.user.societyId, req.user.userId, req.body);
    return sendSuccess(res, 201, 'Announcement created successfully.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};

export const listAnnouncements = async (req, res, next) => {
  try {
    const data = await announcementsService.listAnnouncements(req.user.societyId, req.query);
    return sendSuccess(res, 200, 'Announcements retrieved successfully.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};

export const getAnnouncementById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = req.user.role === 'secretary'
      ? await announcementsService.getAnnouncementByIdSecretary(req.user.societyId, id)
      : await announcementsService.getAnnouncementByIdResident(req.user.userId, req.user.societyId, req.user.unitId, id);
    return sendSuccess(res, 200, 'Announcement retrieved.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};

export const deleteExpiredAnnouncements = async (req, res, next) => {
  try {
    const data = await announcementsService.deleteExpiredAnnouncements(req.user.societyId);
    return sendSuccess(res, 200, 'All expired announcements deleted successfully.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};

export const deleteAnnouncement = async (req, res, next) => {
  try {
    const data = await announcementsService.deleteAnnouncement(req.user.societyId, parseInt(req.params.id, 10));
    return sendSuccess(res, 200, 'Announcement deleted successfully.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};

export const getMyAnnouncements = async (req, res, next) => {
  try {
    const data = await announcementsService.getMyAnnouncements(req.user.userId, req.user.societyId, req.user.unitId, req.query);
    return sendSuccess(res, 200, 'Announcements fetched successfully.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};

export const markAsRead = async (req, res, next) => {
  try {
    const data = await announcementsService.markAsRead(req.user.userId, req.user.societyId, req.user.unitId, parseInt(req.params.id, 10));
    return sendSuccess(res, 200, 'Announcement marked as read.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};
