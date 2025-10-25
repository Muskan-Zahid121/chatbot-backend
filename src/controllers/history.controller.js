import Chat from '../models/chat.model.js';

// List chat history
// Query params:
// - userId (optional string)
// - topic (optional string)
// - limit (optional number, default 50)
// - offset (optional number, default 0)
export const listHistory = async (req, res) => {
  try {
    const { userId } = req.query || {};
    const limit = Math.min(parseInt(req.query?.limit, 10) || 50, 200);
    const offset = parseInt(req.query?.offset, 10) || 0;

    const where = {};
    if (userId) where.userId = userId;

    const records = await Chat.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      attributes: ['id', 'role', 'message', 'createdAt'],
    });

    return res.json({ success: true, data: records });
  } catch (err) {
    console.error('List history error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// Delete chat history
// Options:
// - DELETE /api/history/:id            → deletes a single message
// - DELETE /api/history?userId=...     → deletes all messages for a user
// - DELETE /api/history?all=true       → deletes all messages (explicit)
export const deleteHistory = async (req, res) => {
  try {
    const { id } = req.params || {};
    const { userId } = req.query || {};
    const allowDeleteAll = String(req.query?.all).toLowerCase() === 'true';

    let where = null;
    if (id) {
      where = { id };
    } else if (userId) {
      where = { userId };
    } else if (!allowDeleteAll) {
      return res.status(400).json({
        success: false,
        message: 'Provide id, userId, or set all=true to delete all messages.',
      });
    }

    const deleted = await Chat.destroy({ where: where || {} });

    return res.json({ success: true, deleted });
  } catch (err) {
    console.error('Delete history error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};


